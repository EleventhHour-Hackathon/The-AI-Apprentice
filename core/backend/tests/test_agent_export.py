"""Exporting a Work Map as instructions an agent can load (Markdown and JSON)."""

import json
import os

import pytest

# Config checks these at import; nothing here is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.router import path_router  # noqa: E402
from src.services import agent_export  # noqa: E402

MAP_ID = "6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f"


def _map(status: str = "confirmed") -> dict:
    return {
        "id": MAP_ID,
        "task": "Code a supplier invoice",
        "status": status,
        "steps": [
            {
                "id": "s1",
                "title": "Open the invoice",
                "decision": "Opened invoice 4711 from the inbox.",
                "reason": "",
                "judgment": False,
                "quote": "Ich mache erst mal die Rechnung auf.",
                "quote_kind": "narration",
                "quote_translation": "First I open the invoice.",
            },
            {
                # No id, no reason, and the older "step" field instead of "title".
                "step": "Code the cost account",
                "decision": "Re-coded from opex 4711 to capex 0400.",
                "judgment": True,
                "quote": "Alles über 5.000 ist Anlagevermögen.",
                "quote_kind": "reason",
                "quote_translation": "Anything over 5,000 is a fixed asset.",
            },
            {
                "id": "s3",
                "title": "Check the VAT",
                "decision": None,
                "reason": "The supplier is in another EU country.",
                "quote": None,
                "quote_kind": "none",
            },
        ],
        "guardrails": [
            {
                "id": "g1",
                "kind": "stop_and_ask",
                "rule": "Ask before posting a large invoice.",
                "applies_when": "the invoice is over 10,000",
                "ask_whom": "the controller",
                "step": "s3",
                "quote": "Über 10.000 frage ich immer Petra.",
                "quote_translation": "Over 10,000 I always ask Petra.",
            },
            {
                # No id, nobody named, no applies_when.
                "kind": "stop_and_ask",
                "rule": "The PO number is missing",
                "applies_when": None,
                "ask_whom": "",
                "step": None,
                "quote": None,
            },
            {
                "id": "g3",
                "kind": "limit",
                "rule": "Never approve more than 25,000 yourself.",
                "applies_when": "",
                "ask_whom": None,
                "step": "s2",
                "quote": "That's my signing limit.",
            },
            {
                "id": "g4",
                "kind": "exception",
                "rule": "Software licences stay opex",
                "applies_when": "the item is a software licence",
                "step": "",
                "quote": "",
            },
        ],
        "open_questions": ["What if the supplier has no VAT id?", None, "  "],
    }


def test_markdown_has_steps_in_order_with_the_experts_words():
    md = agent_export.to_markdown(_map())
    assert md.startswith("# Code a supplier invoice\n")
    order = [md.index(t) for t in ("Open the invoice", "Code the cost account", "Check the VAT")]
    assert order == sorted(order)
    assert "2. **Code the cost account** (judgment call)" in md
    assert "(judgment call)" not in md.split("2. **")[0]
    assert "Decision: Re-coded from opex 4711 to capex 0400." in md
    assert (
        'Why, in the expert\'s words: "Alles über 5.000 ist Anlagevermögen." '
        '(in English: "Anything over 5,000 is a fixed asset.")'
    ) in md
    assert "Why: The supplier is in another EU country." in md


def test_narration_is_context_not_a_reason():
    md = agent_export.to_markdown(_map())
    step1 = md.split("1. **Open the invoice**")[1].split("2. **")[0]
    assert "Why" not in step1
    assert (
        'Said while doing it (context, not a reason): "Ich mache erst mal die Rechnung auf." '
        '(in English: "First I open the invoice.")'
    ) in step1


def test_every_guardrail_is_a_stop_or_hard_rule_line():
    md = agent_export.to_markdown(_map())
    rules = [line for line in md.splitlines() if line.startswith("- **")]
    assert len(rules) == 4
    assert all(r.startswith(("- **STOP and ask", "- **Hard rule")) for r in rules)
    assert rules[0] == (
        "- **STOP and ask the controller** when the invoice is over 10,000. "
        "Rule: Ask before posting a large invoice. (At step 3.)"
    )
    assert rules[1] == "- **STOP and ask the person responsible** when the PO number is missing."
    assert (
        rules[2] == "- **Hard rule (limit):** Never approve more than 25,000 yourself. (At step 2.)"
    )
    assert rules[3] == (
        "- **Hard rule (exception):** Software licences stay opex. "
        "Applies when the item is a software licence."
    )
    assert (
        '  - The expert\'s words: "Über 10.000 frage ich immer Petra." '
        '(in English: "Over 10,000 I always ask Petra.")'
    ) in md
    assert "  - The expert's words: \"That's my signing limit.\"" in md


def test_text_after_when_is_lowercased_except_acronyms():
    guard = {"kind": "exception", "rule": "Hold it", "applies_when": "The supplier is new"}
    md = agent_export.to_markdown({"guardrails": [guard]})
    assert "Applies when the supplier is new." in md
    acronym = {"kind": "stop_and_ask", "rule": "", "applies_when": "VAT id is missing"}
    md = agent_export.to_markdown({"guardrails": [acronym]})
    assert "when VAT id is missing." in md
    single = {"kind": "stop_and_ask", "rule": "X", "applies_when": ""}
    assert "when X." in agent_export.to_markdown({"guardrails": [single]})


def test_quotes_and_free_text_are_redacted_again_on_the_way_out():
    work_map = _map()
    work_map["steps"][1]["quote"] = "Send it to petra.k@example.com first."
    work_map["guardrails"][0]["ask_whom"] = "ap-team@example.com"
    md = agent_export.to_markdown(work_map)
    out = agent_export.to_json(work_map)
    assert "example.com" not in md and "example.com" not in json.dumps(out)
    assert '"Send it to [email] first."' in md
    assert "**STOP and ask [email]**" in md
    assert out["steps"][1]["expert_words"] == "Send it to [email] first."
    assert out["guardrails"][0]["ask_whom"] == "[email]"


def test_open_questions_are_listed_without_blanks():
    md = agent_export.to_markdown(_map())
    tail = md.split("## Open questions")[1]
    assert "- What if the supplier has no VAT id?" in tail
    assert "\n- \n" not in tail
    assert "## Open questions" not in agent_export.to_markdown({**_map(), "open_questions": []})


def test_draft_warning_only_when_not_confirmed():
    assert agent_export.DRAFT not in agent_export.to_markdown(_map("confirmed"))
    assert agent_export.DRAFT in agent_export.to_markdown(_map("draft"))
    assert agent_export.DRAFT in agent_export.to_markdown({"task": "x"})


@pytest.mark.parametrize(
    "work_map", [_map(), _map("draft"), {}, {"steps": [{}], "guardrails": [{}]}]
)
def test_never_prints_none_null_or_em_dashes(work_map):
    md = agent_export.to_markdown(work_map)
    assert "None" not in md
    assert "null" not in md
    assert "—" not in md


def test_json_shape_and_defaults():
    out = agent_export.to_json(_map())
    json.dumps(out)
    assert out["work_map_id"] == MAP_ID
    assert out["confirmed"] is True
    assert [s["id"] for s in out["steps"]] == ["s1", "s2", "s3"]
    assert out["steps"][1] == {
        "id": "s2",
        "title": "Code the cost account",
        "decision": "Re-coded from opex 4711 to capex 0400.",
        "reason": "",
        "judgment": True,
        "expert_words": "Alles über 5.000 ist Anlagevermögen.",
        "expert_words_english": "Anything over 5,000 is a fixed asset.",
        "quote_kind": "reason",
    }
    assert out["steps"][0]["quote_kind"] == "narration"
    assert out["steps"][0]["expert_words_english"] == "First I open the invoice."
    assert out["steps"][2]["quote_kind"] == "" and out["steps"][2]["expert_words_english"] == ""
    assert out["guardrails"][0]["expert_words_english"] == "Over 10,000 I always ask Petra."
    assert out["guardrails"][2]["expert_words_english"] == ""
    assert out["steps"][2]["decision"] == "" and out["steps"][2]["expert_words"] == ""
    assert [g["id"] for g in out["guardrails"]] == ["g1", "g2", "g3", "g4"]
    assert [g["action"] for g in out["guardrails"]] == [
        "stop_and_ask",
        "stop_and_ask",
        "enforce",
        "enforce",
    ]
    assert out["guardrails"][1]["applies_when"] == "" and out["guardrails"][1]["step"] == ""
    assert out["open_questions"] == ["What if the supplier has no VAT id?"]
    assert out["instructions"] == agent_export.to_markdown(_map())
    assert agent_export.to_json(_map("draft"))["confirmed"] is False

    empty = agent_export.to_json({})
    json.dumps(empty)
    assert empty["task"] == "" and empty["steps"] == [] and empty["open_questions"] == []
    assert None not in empty.values()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(path_router.router)
    return TestClient(app)


def _stored(monkeypatch, work_map=None, error=None):
    def get(work_map_id):
        if error:
            raise error
        return work_map if work_map_id == MAP_ID else None

    monkeypatch.setattr(path_router.work_map_store, "get", get)


def test_markdown_endpoint_downloads_the_instructions(client, monkeypatch):
    _stored(monkeypatch, _map())
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/agent.md")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/markdown")
    assert (
        res.headers["content-disposition"]
        == 'attachment; filename="code-a-supplier-invoice.agent.md"'
    )
    assert res.text == agent_export.to_markdown(_map())


def test_markdown_filename_falls_back_for_tasks_without_latin_letters(client, monkeypatch):
    _stored(monkeypatch, {**_map(), "task": "发票编码"})
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/agent.md")
    assert res.headers["content-disposition"] == 'attachment; filename="work-map.agent.md"'


def test_json_endpoint(client, monkeypatch):
    _stored(monkeypatch, _map())
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/agent.json")
    assert res.status_code == 200
    assert res.json() == agent_export.to_json(_map())


@pytest.mark.parametrize("fmt", ["md", "json"])
def test_not_a_uuid_is_404(client, monkeypatch, fmt):
    _stored(monkeypatch, _map())
    assert client.get(f"/api/v1/work_maps/not-a-uuid/agent.{fmt}").status_code == 404


@pytest.mark.parametrize("fmt", ["md", "json"])
def test_missing_map_is_404(client, monkeypatch, fmt):
    _stored(monkeypatch, None)
    res = client.get(f"/api/v1/work_maps/{MAP_ID}/agent.{fmt}")
    assert res.status_code == 404
    assert res.json()["detail"] == "Work Map not found"


@pytest.mark.parametrize("fmt", ["md", "json"])
def test_store_failure_is_503(client, monkeypatch, fmt):
    _stored(monkeypatch, error=RuntimeError("database down"))
    assert client.get(f"/api/v1/work_maps/{MAP_ID}/agent.{fmt}").status_code == 503
