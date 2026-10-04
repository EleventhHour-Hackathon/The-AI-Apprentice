"""Autopilot in the practice ERP: post the routine invoices, hand every other one to a person."""

import asyncio
import json
import os

import httpx
import openai
import pytest

# Config checks these at import; nothing real is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.router import autopilot_router  # noqa: E402
from src.services import agent_export, autopilot_decide  # noqa: E402
from src.services.autopilot_decide import (  # noqa: E402
    COULD_NOT_DECIDE,
    NO_GUARDRAILS,
    NOT_CLEAR,
    decide,
    parse,
    prompt,
)

MAP_ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
URL = f"/api/v1/work_maps/{MAP_ID}/decide"
IBAN = "DE89 3704 0044 0532 0130 00"
EMAIL = "j.keller@bauer-hydraulik.de"

WORK_MAP = {
    "id": MAP_ID,
    "task": "Post supplier invoices",
    "status": "confirmed",
    "steps": [
        {
            "id": "s1",
            "title": "Check the cost center",
            "decision": "Opex or capex",
            "judgment": True,
        }
    ],
    "guardrails": [
        {
            "id": "g1",
            "kind": "limit",
            "rule": "Equipment over 5,000 is capex: code it to 0400",
            "applies_when": "invoice total over 5,000 on an opex cost center",
            "ask_whom": "Controller",
            "quote": "Über fünftausend ist das Anlagevermögen.",
            "quote_translation": "Over five thousand, that's a fixed asset.",
        },
        {
            "id": "g2",
            "kind": "stop_and_ask",
            "rule": "Schmidt bills December freight twice: check the history",
            "applies_when": "a second December invoice from Schmidt",
            "ask_whom": "Head of Finance",
            "quote": "Schmidt always sends it twice in December.",
        },
    ],
}
EXPORT = agent_export.to_json(WORK_MAP)

INVOICE = {
    "id": "4471",
    "supplier": "Bauer Hydraulik GmbH",
    "country": "Germany",
    "date": "2026-12-10",
    "due": "2027-01-09",
    "orderRef": "PO-88213",
    "lines": [{"description": "Hydraulic press HP-200", "qty": 1, "unit": 6450}],
    "costCenter": "4711",
    "costCenterName": "Maintenance & small equipment",
    "assetNumber": "",
    "comment": "",
}
HISTORY = [{"id": "4460", "date": "2026-11-21", "amount": 2380, "note": "Paid · spare seals"}]
CONTACT = {"name": "Jonas Keller", "email": EMAIL, "phone": "+49 711 4093 2210", "iban": IBAN}


def run(coro):
    return asyncio.run(coro)


# --- prompt ----------------------------------------------------------------------------------


def test_prompt_has_every_guardrail_and_no_contact():
    messages = prompt({**INVOICE, "contact": CONTACT}, HISTORY, EXPORT)
    assert [m["role"] for m in messages] == ["system", "user"]
    text = messages[1]["content"]
    body = json.loads(text)
    for g in EXPORT["guardrails"]:
        assert g["id"] in [x["id"] for x in body["guardrails"]]
        assert g["rule"] in text
    assert body["guardrails"][0]["expert_words"] == "Over five thousand, that's a fixed asset."
    assert body["guardrails"][1]["expert_words"] == "Schmidt always sends it twice in December."
    assert body["steps"] == [
        {"title": "Check the cost center", "decision": "Opex or capex", "judgment": True}
    ]
    assert body["invoice"]["id"] == "4471"
    assert body["supplier_history"][0]["id"] == "4460"
    assert "contact" not in body["invoice"]
    for secret in (IBAN, EMAIL, "Jonas Keller", "+49 711 4093 2210", "DE89"):
        assert secret not in text


def test_prompt_redacts_free_text():
    messages = prompt({**INVOICE, "comment": f"Pay to {IBAN}"}, [], EXPORT)
    assert "DE89" not in messages[1]["content"]


# --- parse -----------------------------------------------------------------------------------

IDS = ["g1", "g2"]


def test_parse_routine():
    assert parse(json.dumps({"verdict": "routine", "guardrail_id": "", "why": "ok"}), IDS) == {
        "verdict": "routine"
    }


def test_parse_judgment_with_a_known_guardrail():
    text = json.dumps({"verdict": "judgment", "guardrail_id": "g1", "why": "  Over 5,000.  "})
    assert parse(text, IDS) == {"verdict": "judgment", "guardrailId": "g1", "why": "Over 5,000."}


def test_parse_clips_and_redacts_why():
    long = json.dumps({"verdict": "judgment", "guardrail_id": "g1", "why": "x" * 500})
    assert len(parse(long, IDS)["why"]) == 300
    secret = json.dumps({"verdict": "judgment", "guardrail_id": "g2", "why": f"Paid to {IBAN}"})
    assert "DE89" not in parse(secret, IDS)["why"]


@pytest.mark.parametrize(
    "text",
    [
        json.dumps({"verdict": "judgment", "guardrail_id": "g9", "why": "made up"}),
        json.dumps({"verdict": "judgment", "guardrail_id": "", "why": "no id"}),
        json.dumps({"verdict": "judgment", "guardrail_id": "g1"}),
        json.dumps({"verdict": "judgment", "guardrail_id": "g1", "why": "   "}),
        json.dumps({"verdict": "Routine"}),
        json.dumps({"verdict": "post", "guardrail_id": "g1", "why": "x"}),
        json.dumps(["routine"]),
        "routine",
        "not json at all",
        "",
    ],
)
def test_parse_anything_unclear_goes_to_a_person(text):
    assert parse(text, IDS) == {"verdict": "judgment", "guardrailId": None, "why": NOT_CLEAR}


# --- decide ----------------------------------------------------------------------------------


def test_decide_with_an_injected_model():
    seen = []

    async def complete(messages):
        seen.append(messages)
        return json.dumps({"verdict": "judgment", "guardrail_id": "g1", "why": "Over 5,000."})

    result = run(decide(INVOICE, HISTORY, EXPORT, complete))
    assert result == {"verdict": "judgment", "guardrailId": "g1", "why": "Over 5,000."}
    assert len(seen) == 1


def test_decide_with_openai(fake_openai):
    fake = fake_openai(autopilot_decide, {"verdict": "routine", "guardrail_id": "", "why": "ok"})
    assert run(decide(INVOICE, HISTORY, EXPORT)) == {"verdict": "routine"}
    (call,) = fake.calls
    assert call["temperature"] == 0
    assert call["model"] == autopilot_decide.MODEL
    assert call["response_format"]["json_schema"]["strict"] is True


def test_decide_without_guardrails_asks_nothing():
    async def complete(messages):  # noqa: ARG001
        raise AssertionError("must not be called")

    export = agent_export.to_json({**WORK_MAP, "guardrails": []})
    result = run(decide(INVOICE, HISTORY, export, complete))
    assert result == {"verdict": "judgment", "guardrailId": None, "why": NO_GUARDRAILS}


def test_decide_fails_closed_when_the_model_breaks():
    async def complete(messages):  # noqa: ARG001
        raise ValueError("boom")

    result = run(decide(INVOICE, HISTORY, EXPORT, complete))
    assert result == {"verdict": "judgment", "guardrailId": None, "why": COULD_NOT_DECIDE}


# --- endpoint --------------------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    stored = {"map": WORK_MAP}

    def get(work_map_id):
        if isinstance(stored["map"], Exception):
            raise stored["map"]
        return stored["map"] if work_map_id == MAP_ID else None

    monkeypatch.setattr(autopilot_router.work_map_store, "get", get)
    app = FastAPI()
    app.include_router(autopilot_router.router)
    c = TestClient(app)
    c.stored = stored
    return c


def body(**invoice):
    return {"invoice": {**INVOICE, **invoice}, "history": HISTORY}


def test_endpoint_routine(client, fake_openai):
    fake_openai(autopilot_decide, {"verdict": "routine", "guardrail_id": "", "why": "ok"})
    r = client.post(URL, json=body())
    assert r.status_code == 200
    assert r.json() == {"verdict": "routine"}


def test_endpoint_judgment(client, fake_openai):
    fake_openai(autopilot_decide, {"verdict": "judgment", "guardrail_id": "g1", "why": "Over."})
    r = client.post(URL, json=body())
    assert r.status_code == 200
    assert r.json() == {"verdict": "judgment", "guardrailId": "g1", "why": "Over."}


def test_endpoint_never_sends_the_contact_to_the_model(client, fake_openai):
    fake = fake_openai(autopilot_decide, {"verdict": "routine", "guardrail_id": "", "why": "ok"})
    r = client.post(URL, json=body(contact=CONTACT))
    assert r.status_code == 200
    sent = json.dumps(fake.calls, ensure_ascii=False)
    for secret in (IBAN, EMAIL, "Jonas Keller", "contact"):
        assert secret not in sent


def test_endpoint_unknown_map(client):
    other = "0b9e8d7c-6f5a-4b3c-8d2e-1f0a9b8c7d6e"
    r = client.post(f"/api/v1/work_maps/{other}/decide", json=body())
    assert r.status_code == 404
    assert r.json() == {"detail": "Work Map not found"}
    assert client.post("/api/v1/work_maps/not-a-uuid/decide", json=body()).status_code == 404


def test_endpoint_bad_body(client):
    assert client.post(URL, json={"history": []}).status_code == 422
    assert client.post(URL, json=body(lines="many")).status_code == 422
    assert client.post(URL, json=body(comment="x" * 5000)).status_code == 422
    too_many = {"invoice": INVOICE, "history": HISTORY * 21}
    assert client.post(URL, json=too_many).status_code == 422


def test_endpoint_store_error(client):
    client.stored["map"] = RuntimeError("db down")
    r = client.post(URL, json=body())
    assert r.status_code == 503
    assert r.json() == {"detail": "Work Map storage is unavailable"}


def test_endpoint_without_a_key(client, monkeypatch, fake_openai):
    fake = fake_openai(autopilot_decide)
    monkeypatch.delenv("OPENAI_API_KEY")
    r = client.post(URL, json=body())
    assert r.status_code == 503
    assert r.json() == {"detail": autopilot_decide.NO_KEY}
    assert "OPENAI_API_KEY" in r.json()["detail"]
    assert fake.calls == []


class _Unreachable:
    def __init__(self, error):
        self.error = error

    def __call__(self, *args, **kwargs):  # noqa: ARG002
        return self

    @property
    def chat(self):
        return self

    @property
    def completions(self):
        return self

    async def create(self, **kwargs):  # noqa: ARG002
        raise self.error


@pytest.mark.parametrize(
    "error",
    [
        openai.APIConnectionError(request=httpx.Request("POST", "https://x")),
        openai.APITimeoutError(request=httpx.Request("POST", "https://x")),
    ],
)
def test_endpoint_openai_unreachable(client, monkeypatch, error):
    monkeypatch.setattr(autopilot_decide, "AsyncOpenAI", _Unreachable(error))
    r = client.post(URL, json=body())
    assert r.status_code == 503
    assert r.json() == {"detail": autopilot_decide.UNREACHABLE}


def test_endpoint_garbage_from_the_model_goes_to_a_person(client, fake_openai):
    fake_openai(autopilot_decide, "I think it's fine")
    r = client.post(URL, json=body())
    assert r.json() == {"verdict": "judgment", "guardrailId": None, "why": NOT_CLEAR}
