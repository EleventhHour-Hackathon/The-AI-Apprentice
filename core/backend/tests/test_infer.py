"""What the apprentice doesn't need to ask (infer.py) and its endpoint, with the LLM faked."""

import os

import pytest

for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.router import path_router  # noqa: E402
from src.services import follow_ups, infer  # noqa: E402

EVENTS = ["Opened invoice 4471 from anna@example.com", "Cost center changed from 4711 to 0400"]
TRANSCRIPT = [
    {"role": "expert", "text": "This one goes to capex, call me on +49 170 1234567 if unsure."},
    {"role": "apprentice", "text": "Why capex?"},
]


def reply(clear=(), unclear=(), skip=False):
    return {"clear": list(clear), "unclear": list(unclear), "skip": skip}


@pytest.mark.asyncio
async def test_only_what_it_is_extremely_sure_of_is_clear(fake_openai):
    fake_openai(
        infer,
        reply(
            clear=[
                {
                    "about": "invoice matched to its order",
                    "answer": "Standard three-way match.",
                    "confidence": 0.95,
                },
                {
                    "about": "cost center changed to 0400",
                    "answer": "Probably capex.",
                    "confidence": 0.7,
                },
            ],
            unclear=["invoice held"],
        ),
    )
    result = await infer.infer(EVENTS, TRANSCRIPT, None)

    assert result["clear"] == [
        {
            "about": "invoice matched to its order",
            "answer": "Standard three-way match.",
            "confidence": 0.95,
        }
    ]
    # Not sure enough to assume: still worth asking.
    assert result["unclear"] == ["invoice held", "cost center changed to 0400"]
    assert result["skip"] is False


@pytest.mark.asyncio
async def test_skip_when_nothing_is_worth_asking(fake_openai):
    fake_openai(
        infer,
        reply(
            clear=[{"about": "opened invoice", "answer": "To work on it.", "confidence": 1.4}],
            skip=True,
        ),
    )
    result = await infer.infer(EVENTS, TRANSCRIPT, None)
    assert result == {
        "clear": [{"about": "opened invoice", "answer": "To work on it.", "confidence": 1.0}],
        "unclear": [],
        "skip": True,
    }


@pytest.mark.asyncio
async def test_never_skips_while_something_is_unclear(fake_openai):
    fake_openai(infer, reply(unclear=["warning ignored"], skip=True))
    assert (await infer.infer(EVENTS, TRANSCRIPT, None))["skip"] is False


@pytest.mark.asyncio
async def test_inputs_are_redacted_before_the_call(fake_openai):
    fake = fake_openai(infer, reply())
    work_map = {
        "steps": [{"id": "s1", "title": "Code the invoice", "reason": "Ask Frau Weber"}],
        "guardrails": [],
        "captures": [{"kind": "step", "reason": "mail bob@example.com"}],
    }
    await infer.infer(EVENTS, TRANSCRIPT, work_map)

    call = fake.calls[0]
    sent = call["messages"][1]["content"]
    for secret in ("anna@example.com", "1234567", "Frau Weber", "bob@example.com"):
        assert secret not in sent
    assert "[email]" in sent and "[phone]" in sent and "[name]" in sent
    assert "Cost center changed from 4711 to 0400" in sent
    assert call["model"] == infer.MODEL
    assert call["response_format"]["json_schema"]["name"] == "inferred_reasons"
    # The caller's map is left as it was.
    assert work_map["steps"][0]["reason"] == "Ask Frau Weber"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["not json", {"unexpected": True, "clear": "nope"}])
async def test_a_failure_never_blocks_asking(fake_openai, bad):
    fake_openai(infer, bad)
    result = await infer.infer(EVENTS, TRANSCRIPT, None)
    assert result["clear"] == [] and result["skip"] is False


@pytest.mark.asyncio
async def test_unreachable_model_falls_back(monkeypatch):
    def broken(**kwargs):  # noqa: ARG001
        raise RuntimeError("no network")

    monkeypatch.setattr(infer, "AsyncOpenAI", broken)
    assert await infer.infer(EVENTS, TRANSCRIPT, None) == {
        "clear": [],
        "unclear": [],
        "skip": False,
    }


@pytest.mark.asyncio
async def test_no_screen_events_no_call(fake_openai):
    fake = fake_openai(infer)
    assert await infer.infer([], TRANSCRIPT, None) == {"clear": [], "unclear": [], "skip": False}
    assert fake.calls == []


# The endpoint

SESSION_ID = "6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f"
PARENT_ID = "0b6c8a1e-2f3d-4a5b-9c7d-1e2f3a4b5c6d"


@pytest.fixture
def client(monkeypatch):
    maps = {
        SESSION_ID: {
            "id": SESSION_ID,
            "status": "recording",
            "captures": [
                {"kind": follow_ups.PARENT, "work_map_id": PARENT_ID},
                {"kind": "step", "step": "coded invoice", "reason": "over 5,000"},
            ],
        },
        PARENT_ID: {
            "id": PARENT_ID,
            "status": "confirmed",
            "steps": [{"id": "s1", "title": "Check the PO"}],
        },
    }
    monkeypatch.setattr(path_router.work_map_store, "get", lambda i: maps.get(i))
    app = FastAPI()
    app.include_router(path_router.router)
    return TestClient(app)


@pytest.fixture
def seen(monkeypatch):
    calls = []

    async def fake_infer(events, transcript, known):
        calls.append({"events": events, "transcript": transcript, "known": known})
        return {
            "clear": [{"about": "x", "answer": "y", "confidence": 0.95}],
            "unclear": [],
            "skip": False,
        }

    monkeypatch.setattr(path_router.infer_service, "infer", fake_infer)
    return calls


def test_endpoint_happy_path(client, seen):
    body = {
        "events": EVENTS + [3],
        "transcript": TRANSCRIPT + [{"role": "system", "text": "x"}, "junk"],
    }
    res = client.post(f"/api/v1/sessions/{SESSION_ID}/infer", json=body)

    assert res.status_code == 200
    assert res.json() == {
        "clear": [{"about": "x", "answer": "y", "confidence": 0.95}],
        "unclear": [],
        "skip": False,
    }
    call = seen[0]
    assert call["events"] == EVENTS
    assert call["transcript"] == TRANSCRIPT
    # What is known: the live records and the map this session was recorded again from.
    assert {"kind": "step", "step": "coded invoice", "reason": "over 5,000"} in call["known"][
        "captures"
    ]
    assert call["known"]["steps"] == [{"id": "s1", "title": "Check the PO"}]


@pytest.mark.parametrize("session", ["9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "not-a-uuid"])
def test_endpoint_unknown_session_is_404(client, seen, session):
    res = client.post(
        f"/api/v1/sessions/{session}/infer", json={"events": EVENTS, "transcript": []}
    )
    assert res.status_code == 404
    assert seen == []
