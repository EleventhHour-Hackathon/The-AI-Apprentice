import os

# Importing the router loads the app config, which only checks these are set; nothing is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import pytest  # noqa: E402

from src.router import tutor_kb_router  # noqa: E402
from src.services import tutor_kb  # noqa: E402
import storage.work_maps  # noqa: E402

MAP_ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"

WORK_MAP = {
    "id": MAP_ID,
    "task": "Approve a supplier invoice",
    "status": "confirmed",
    "steps": [
        {
            "id": "s1",
            "title": "Open the invoice",
            "screen": "inbox, invoice 4471",
            "decision": "Opened invoice 4471 from Müller GmbH.",
            "reason": "",
            "judgment": False,
            "quote": "Ich mache erst mal die Rechnung auf.",
            "quote_kind": "narration",
            "quote_translation": "First I open the invoice.",
        },
        {
            "id": "s2",
            "step": "Code the invoice",
            "screen": "invoice 4471, cost center field",
            "decision": "Re-coded from 4711 to 0400.",
            "reason": "",
            "judgment": True,
            "quote": "Ausrüstung über 5.000 ist immer Anlagevermögen.",
            "quote_kind": "reason",
            "quote_translation": "Equipment over 5,000 is always capex.",
        },
        {
            # No id and no screen: it is the third step, so s3, and "when" is its title.
            "title": "Approve the payment",
            "decision": "Approved it for the next payment run.",
            "reason": "The supplier was already checked.",
            "judgment": True,
            "quote": "",
        },
    ],
    "guardrails": [
        {
            "id": "g1",
            "kind": "limit",
            "rule": "Equipment over 5,000 goes to 0400.",
            "applies_when": "the invoice is for equipment",
            "ask_whom": "",
            "step": "s2",
            "quote": "Über 5.000 nie auf 4711.",
            "quote_translation": "Over 5,000 never to 4711.",
        },
        {
            "kind": "stop_and_ask",
            "rule": "Don't approve over 10,000 alone.",
            "applies_when": "the total is over 10,000",
            "ask_whom": "the finance lead",
            "step": "s3",
            "quote": "",
        },
        {
            "id": "g3",
            "kind": "exception",
            "rule": "Utilities can skip the PO match.",
            "applies_when": "",
            "ask_whom": "",
            "step": "",
            "quote": "",
        },
    ],
    "open_questions": ["Who covers when the finance lead is away?"],
}


def test_every_step_and_guardrail_is_in_the_knowledge_base():
    doc = tutor_kb.knowledge_base_document(WORK_MAP)
    assert doc["name"] == "Work Map: Approve a supplier invoice (3f2c9a1e)"
    text = doc["text"]
    for title in ("s1. Open the invoice", "s2. Code the invoice", "s3. Approve the payment"):
        assert title in text
    assert text.index("s1.") < text.index("s2.") < text.index("s3.")
    assert "Re-coded from 4711 to 0400." in text
    assert "The supplier was already checked." in text
    assert (
        '"Ausrüstung über 5.000 ist immer Anlagevermögen." '
        '(in English: "Equipment over 5,000 is always capex.")' in text
    )
    assert "Said while doing it (not a reason)" in text
    assert "g1. Limit: Equipment over 5,000 goes to 0400." in text
    assert "g2. Stop and ask: Don't approve over 10,000 alone." in text
    assert "Ask: the finance lead" in text
    assert "Applies when: the invoice is for equipment" in text
    assert "g3. Exception: Utilities can skip the PO match." in text
    assert '(in English: "Over 5,000 never to 4711.")' in text
    assert "Who covers when the finance lead is away?" in text
    assert "None" not in text and "null" not in text
    assert chr(0x2014) not in text  # no em dashes


def test_each_procedure_gets_only_its_own_guardrails():
    procs = tutor_kb.procedures(WORK_MAP)
    assert [p["id"] for p in procs] == [f"{MAP_ID}:s1", f"{MAP_ID}:s2", f"{MAP_ID}:s3"]
    s1, s2, s3 = procs
    assert s1["guardrails"] == [] and s1["stop_and_ask"] == []
    assert s2["guardrails"] == [
        "Limit: Equipment over 5,000 goes to 0400. (applies when the invoice is for equipment)"
    ]
    assert s2["stop_and_ask"] == []
    # "when" is where the step comes up, never a guardrail's condition.
    assert s1["when"] == "inbox, invoice 4471"
    assert s2["when"] == "invoice 4471, cost center field"
    assert s3["when"] == "Approve the payment"
    assert s3["guardrails"] == [
        "Stop and ask: Don't approve over 10,000 alone. (applies when the total is over 10,000)"
    ]
    assert s3["stop_and_ask"] == ["Stop and ask the finance lead when the total is over 10,000"]
    assert [p["judgment"] for p in procs] == [False, True, True]
    assert s2["do"] == "Re-coded from 4711 to 0400."
    assert s3["why"] == "The supplier was already checked."
    assert "Equipment over 5,000 is always capex." in s2["why"]
    assert "Equipment over 5,000 is always capex." in s2["expert_words"]
    assert s3["expert_words"] == ""


def test_narration_is_not_the_reason():
    s1 = tutor_kb.procedures(WORK_MAP)[0]
    assert s1["why"] == ""
    assert "Ich mache" not in s1["why"]
    assert s1["expert_words"].startswith("Said while doing it:")


def test_unattached_guardrail_is_general():
    body = tutor_kb.payload(WORK_MAP)
    assert [g["id"] for g in body["general_guardrails"]] == ["g3"]
    assert body["general_guardrails"][0]["kind"] == "Exception"
    assert all(
        "Utilities can skip the PO match." not in p["guardrails"] for p in body["procedures"]
    )
    assert body["work_map_id"] == MAP_ID
    assert body["task"] == "Approve a supplier invoice"
    assert body["confirmed"] is True


def test_no_none_anywhere_for_a_sparse_map():
    sparse = {
        "id": MAP_ID,
        "task": None,
        "steps": [{"title": "Do it"}],
        "guardrails": [{"rule": "Careful"}],
    }
    body = tutor_kb.payload(sparse)
    assert body["confirmed"] is False
    assert "None" not in body["knowledge_base"]["text"]

    def walk(value):
        assert value is not None
        if isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    walk(body)


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(tutor_kb_router.router)
    return TestClient(app)


def _store(monkeypatch, result):
    def get(work_map_id):  # noqa: ARG001
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(storage.work_maps, "get", get)


def test_endpoint_returns_the_payload(client, monkeypatch):
    _store(monkeypatch, dict(WORK_MAP))
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/tutor_kb")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {
        "work_map_id",
        "task",
        "confirmed",
        "knowledge_base",
        "procedures",
        "general_guardrails",
    }
    assert len(body["procedures"]) == 3
    assert "null" not in res.text


def test_endpoint_404_for_a_non_uuid(client, monkeypatch):
    _store(monkeypatch, dict(WORK_MAP))
    res = client.get("/api/v1/work_maps/not-a-uuid/tutor_kb")
    assert res.status_code == 404
    assert res.json()["detail"] == "Work Map not found"


def test_endpoint_404_for_a_missing_map(client, monkeypatch):
    _store(monkeypatch, None)
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/tutor_kb")
    assert res.status_code == 404
    assert res.json()["detail"] == "Work Map not found"


@pytest.mark.parametrize("steps", [[], None, "abc", [None]])
def test_endpoint_422_without_steps(client, monkeypatch, steps):
    _store(monkeypatch, {**WORK_MAP, "steps": steps})
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/tutor_kb")
    assert res.status_code == 422
    assert res.json()["detail"] == "This Work Map has no steps to teach yet"


def test_endpoint_503_when_the_store_fails(client, monkeypatch):
    _store(monkeypatch, RuntimeError("database down"))
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/tutor_kb")
    assert res.status_code == 503


def test_knowledge_base_shows_the_screen_of_each_step():
    text = tutor_kb.knowledge_base_document(WORK_MAP)["text"]
    assert "- On screen: inbox, invoice 4471" in text
    assert "- On screen: invoice 4471, cost center field" in text
    assert text.count("On screen:") == 2


def test_draft_line_only_for_an_unconfirmed_map():
    assert (
        "Draft: not confirmed by the expert"
        not in tutor_kb.knowledge_base_document(WORK_MAP)["text"]
    )
    draft = tutor_kb.knowledge_base_document({**WORK_MAP, "status": "draft"})["text"]
    assert draft.splitlines()[2] == "Draft: not confirmed by the expert"


def test_stop_and_ask_without_whom_still_counts():
    work_map = {
        "id": MAP_ID,
        "steps": [{"id": "s1", "title": "Pay"}],
        "guardrails": [
            {"kind": "stop_and_ask", "rule": "Never pay a new supplier alone.", "step": "s1"},
            {
                "kind": "stop_and_ask",
                "rule": "Hold it",
                "applies_when": "the IBAN changed",
                "step": "s1",
            },
        ],
    }
    (proc,) = tutor_kb.procedures(work_map)
    assert proc["stop_and_ask"] == [
        "Stop and ask a person responsible when Never pay a new supplier alone.",
        "Stop and ask a person responsible when the IBAN changed",
    ]


def test_duplicate_step_ids_get_unique_procedures():
    work_map = {
        "id": MAP_ID,
        "steps": [
            {"id": "s1", "title": "A"},
            {"id": "s1", "title": "B"},
            {"id": "s1", "title": "C"},
        ],
        "guardrails": [{"kind": "limit", "rule": "Only on A", "step": "s1"}],
    }
    procs = tutor_kb.procedures(work_map)
    assert [p["id"] for p in procs] == [f"{MAP_ID}:s1", f"{MAP_ID}:s1-2", f"{MAP_ID}:s1-3"]
    assert [len(p["guardrails"]) for p in procs] == [1, 0, 0]
    assert tutor_kb.payload(work_map)["general_guardrails"] == []
    text = tutor_kb.knowledge_base_document(work_map)["text"]
    assert "### s1-2. B" in text and "### s1-3. C" in text


def test_odd_shapes_do_not_raise():
    body = tutor_kb.payload(
        {
            "id": MAP_ID,
            "steps": [None, {"title": "Second"}, "junk"],
            "guardrails": [None, {"rule": "Careful", "step": "s2"}],
            "open_questions": "abc",
        }
    )
    # Default ids count positions, including the items that were skipped.
    assert [p["id"] for p in body["procedures"]] == [f"{MAP_ID}:s2"]
    assert body["procedures"][0]["guardrails"] == ["Rule: Careful"]
    assert "### g2. Rule: Careful" in body["knowledge_base"]["text"]
    assert "- a" not in body["knowledge_base"]["text"]

    for odd in ("abc", 5, None, {"x": 1}):
        body = tutor_kb.payload(
            {"id": MAP_ID, "steps": odd, "guardrails": odd, "open_questions": odd}
        )
        assert body["procedures"] == [] and body["general_guardrails"] == []


def test_personal_data_is_redacted_before_it_leaves():
    work_map = {
        **WORK_MAP,
        "task": "Invoices for anna.schmidt@firma.de",
        "steps": [
            {
                "id": "s1",
                "title": "Code it",
                "quote": "Frag anna.schmidt@firma.de, wenn es unklar ist.",
                "quote_kind": "reason",
                "quote_translation": "Ask anna.schmidt@firma.de if it's unclear.",
            }
        ],
        "guardrails": [
            {"kind": "stop_and_ask", "rule": "Ask", "ask_whom": "anna.schmidt@firma.de"}
        ],
        "open_questions": ["Is anna.schmidt@firma.de the backup?"],
    }
    body = tutor_kb.payload(work_map)
    assert "anna.schmidt@firma.de" not in str(body)
    assert "[email]" in body["knowledge_base"]["text"]
    assert "[email]" in body["procedures"][0]["expert_words"]
    assert body["general_guardrails"][0]["ask_whom"] == "[email]"
    assert body["task"] == "Invoices for [email]"
    assert "[email]" in tutor_kb.knowledge_base_document(work_map)["text"]
    assert "[email]" in tutor_kb.procedures(work_map)[0]["expert_words"]
    # Ids and step references are left alone, and the caller's map isn't changed.
    assert body["procedures"][0]["id"] == f"{MAP_ID}:s1"
    assert work_map["steps"][0]["quote"].startswith("Frag anna.schmidt@firma.de")
