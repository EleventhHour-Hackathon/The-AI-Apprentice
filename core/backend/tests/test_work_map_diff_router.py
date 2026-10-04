"""GET /api/v1/work_map_diff: how two experts' Work Maps of the same task differ."""

import os

# Importing the router loads the app config, which only checks these are set; nothing is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import pytest  # noqa: E402

from src.router import work_map_diff_router  # noqa: E402

ID_A = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
ID_B = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"

# Two experts coding the same supplier invoice. They disagree on the capex threshold, and only
# the second one checks the supplier against the vendor list.
MAP_A = {
    "id": ID_A,
    "task": "Code a supplier invoice",
    "recorded_at": "2026-10-01T09:30:00+00:00",
    "confirmed": True,
    "status": "confirmed",
    "transcript": [{"role": "user", "text": "Ich mache erst mal die Rechnung auf."}],
    "captures": [{"t": 3.0, "event": "opened invoice"}],
    "steps": [
        {
            "id": "s1",
            "title": "Open the invoice",
            "decision": "Opened invoice 4471 from Müller GmbH.",
            "reason": "",
            "quote": "Ich mache erst mal die Rechnung auf.",
            "quote_translation": "First I open the invoice.",
        },
        {
            "id": "s2",
            "title": "Code the cost account",
            "decision": "Coded the laptop to capex account 0400.",
            "reason": "equipment over 5,000 is capex",
            "quote": "Ausrüstung über 5.000 ist immer Anlagevermögen.",
            "quote_translation": "Equipment over 5,000 is always capex.",
        },
        {
            "id": "s3",
            "title": "Approve the invoice for payment",
            "decision": "Approved it for the next payment run.",
            "reason": "",
            "quote": "",
        },
    ],
    "guardrails": [
        {
            "id": "g1",
            "kind": "limit",
            "rule": "Equipment over 5,000 goes to capex account 0400.",
            "applies_when": "the invoice is for equipment",
            "ask_whom": "",
            "step": "s2",
        }
    ],
}

MAP_B = {
    "id": ID_B,
    "task": "Code a supplier invoice",
    "recorded_at": "2026-10-02T14:05:00+00:00",
    "confirmed": False,
    "status": "draft",
    "transcript": [{"role": "user", "text": "First the invoice."}],
    "captures": [],
    "steps": [
        {
            "id": "s1",
            "title": "Open the invoice",
            "decision": "Opened invoice 4471.",
            "reason": "",
            "quote": "First the invoice.",
        },
        {
            "id": "s2",
            "title": "Check the supplier against the approved vendor list",
            "decision": "Found Müller GmbH on the approved vendor list.",
            "reason": "we never pay a vendor that isn't approved",
            "quote": "We never pay a vendor that isn't on the list.",
        },
        {
            "id": "s3",
            "title": "Code the cost account",
            "decision": "Coded the laptop to capex account 0400.",
            "reason": "equipment over 10,000 is capex",
            "quote": "Equipment over 10,000 is always capex.",
        },
        {
            "id": "s4",
            "title": "Approve the invoice for payment",
            "decision": "Approved it for the next payment run.",
            "reason": "",
            "quote": "",
        },
    ],
    "guardrails": [
        {
            "id": "g1",
            "kind": "limit",
            "rule": "Equipment over 10,000 goes to capex account 0400.",
            "applies_when": "the invoice is for equipment",
            "ask_whom": "",
            "step": "s3",
        }
    ],
}

STORE = {ID_A: MAP_A, ID_B: MAP_B}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(work_map_diff_router.work_map_store, "get", STORE.get)
    app = FastAPI()
    app.include_router(work_map_diff_router.router)
    return TestClient(app)


def _get(client, a, b):
    return client.get("/api/v1/work_map_diff", params={"a": a, "b": b})


def test_the_diff_with_a_header_for_each_map(client):
    response = _get(client, ID_A, ID_B)
    assert response.status_code == 200
    body = response.json()
    assert list(body) == ["a", "b", "diff", "questions"]
    assert body["a"] == {
        "id": ID_A,
        "task": "Code a supplier invoice",
        "recorded_at": "2026-10-01T09:30:00+00:00",
        "confirmed": True,
        "status": "confirmed",
        "steps": 3,
        "guardrails": 1,
    }
    assert body["b"] == {
        "id": ID_B,
        "task": "Code a supplier invoice",
        "recorded_at": "2026-10-02T14:05:00+00:00",
        "confirmed": False,
        "status": "draft",
        "steps": 4,
        "guardrails": 1,
    }
    rules = body["diff"]["guardrails"]
    assert len(rules["differs"]) == 1
    numbers = [f for f in rules["differs"][0]["fields"] if f["field"] == "numbers"]
    assert numbers and numbers[0]["kind"] == "changed"
    assert "5000" in "".join(numbers[0]["a"]).replace(",", "")
    assert "10000" in "".join(numbers[0]["b"]).replace(",", "")
    steps = body["diff"]["steps"]
    assert [s["id"] for s in steps["only_b"]] == ["s2"]
    assert steps["only_a"] == []


QUESTION_KEYS = {"id", "section", "item", "other", "field", "text", "quote"}


def _ids(body, side, section):
    diff = body["diff"][section]
    ids = {e[side] for e in diff["same"] + diff["differs"]}
    return ids | {e["id"] for e in diff[f"only_{side}"]}


def test_questions_for_each_expert(client):
    body = _get(client, ID_A, ID_B).json()
    questions = body["questions"]
    assert set(questions) == {"a", "b"}
    for side in ("a", "b"):
        assert questions[side], side
        for q in questions[side]:
            assert set(q) == QUESTION_KEYS
            assert q["section"] in ("steps", "guardrails")
            assert q["item"] in _ids(body, side, q["section"])
            assert isinstance(q["text"], str) and q["text"]
    # Each side quotes only its own words.
    said_a = "First I open the invoice. Equipment over 5,000 is always capex."
    said_b = "First the invoice. We never pay a vendor that isn't on the list."
    said_b += " Equipment over 10,000 is always capex."
    for q in questions["a"]:
        assert q["quote"] == "" or q["quote"] in said_a
    for q in questions["b"]:
        assert q["quote"] == "" or q["quote"] in said_b
    # The vendor-list step only B has is asked of B, quoting B.
    [only] = [q for q in questions["b"] if q["field"] == "only"]
    assert only == {**only, "id": "steps:-:s2:only", "item": "s2", "other": None}
    assert only["quote"] == "We never pay a vendor that isn't on the list."
    assert all(q["field"] != "only" for q in questions["a"])
    # The capex threshold is the top question on both sides, paired by id.
    assert questions["a"][0]["id"] == questions["b"][0]["id"] == "guardrails:g1:g1:numbers"


def test_questions_are_capped_by_limit(client, monkeypatch):
    many = {
        **MAP_B,
        "steps": [
            {"id": f"x{i}", "title": f"Unrelated chore number {i}", "decision": f"Did {i}."}
            for i in range(1, 9)
        ],
    }
    monkeypatch.setattr(work_map_diff_router.work_map_store, "get", {ID_A: MAP_A, ID_B: many}.get)
    body = _get(client, ID_A, ID_B).json()
    assert len(body["questions"]["b"]) == 5
    response = client.get("/api/v1/work_map_diff", params={"a": ID_A, "b": ID_B, "limit": 1})
    assert response.status_code == 200
    assert all(len(qs) <= 1 for qs in response.json()["questions"].values())
    response = client.get("/api/v1/work_map_diff", params={"a": ID_A, "b": ID_B, "limit": 10})
    assert len(response.json()["questions"]["b"]) == 9


def test_limit_zero_gives_no_questions_and_the_diff(client):
    response = client.get("/api/v1/work_map_diff", params={"a": ID_A, "b": ID_B, "limit": 0})
    assert response.status_code == 200
    body = response.json()
    assert body["questions"] == {"a": [], "b": []}
    assert len(body["diff"]["guardrails"]["differs"]) == 1


@pytest.mark.parametrize("limit", ["11", "-1", "abc"])
def test_a_bad_limit(client, limit):
    response = client.get("/api/v1/work_map_diff", params={"a": ID_A, "b": ID_B, "limit": limit})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], list)


def test_swapping_a_and_b_swaps_the_questions(client):
    forward = _get(client, ID_A, ID_B).json()["questions"]
    back = _get(client, ID_B, ID_A).json()["questions"]
    assert [q["item"] for q in back["a"]] == [q["item"] for q in forward["b"]]
    assert [q["item"] for q in back["b"]] == [q["item"] for q in forward["a"]]
    assert [q["quote"] for q in back["a"]] == [q["quote"] for q in forward["b"]]
    assert [q["field"] for q in back["b"]] == [q["field"] for q in forward["a"]]


def test_the_response_has_no_transcript_captures_or_full_maps(client):
    text = _get(client, ID_A, ID_B).text
    assert "transcript" not in text
    assert "captures" not in text


def test_swapping_a_and_b_mirrors_the_diff(client):
    forward = _get(client, ID_A, ID_B).json()
    back = _get(client, ID_B, ID_A).json()
    assert back["a"] == forward["b"] and back["b"] == forward["a"]
    assert back["diff"]["steps"]["only_a"] == forward["diff"]["steps"]["only_b"]
    assert back["diff"]["steps"]["only_b"] == forward["diff"]["steps"]["only_a"]
    assert len(back["diff"]["guardrails"]["differs"]) == 1


def test_a_map_with_no_steps(client, monkeypatch):
    empty = {"id": ID_B, "task": None, "recorded_at": None, "confirmed": False, "status": "draft"}
    monkeypatch.setattr(work_map_diff_router.work_map_store, "get", {ID_A: MAP_A, ID_B: empty}.get)
    body = _get(client, ID_A, ID_B).json()
    assert body["b"]["steps"] == 0 and body["b"]["guardrails"] == 0
    assert body["b"]["task"] is None and body["b"]["recorded_at"] is None
    assert len(body["diff"]["steps"]["only_a"]) == 3
    assert body["questions"]["b"] == []
    assert [q["item"] for q in body["questions"]["a"]] == ["g1", "s1", "s2", "s3"]


@pytest.mark.parametrize("b", [ID_A, ID_A.upper()])
def test_the_same_map_twice(client, b):
    response = _get(client, ID_A, b)
    assert response.status_code == 422
    assert response.json() == {"detail": "Pick two different Work Maps"}


@pytest.mark.parametrize("a, b", [("not-a-uuid", ID_B), (ID_A, "../work_maps")])
def test_an_id_that_is_not_a_uuid(client, a, b):
    response = _get(client, a, b)
    assert response.status_code == 404
    assert response.json() == {"detail": "Work Map not found"}


def test_a_missing_map_says_which(client):
    unknown = "00000000-0000-4000-8000-000000000000"
    assert _get(client, unknown, ID_B).json() == {"detail": "Work Map a not found"}
    response = _get(client, ID_A, unknown)
    assert response.status_code == 404
    assert response.json() == {"detail": "Work Map b not found"}


def test_a_is_checked_first(client):
    one, two = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
    assert _get(client, one, two).json() == {"detail": "Work Map a not found"}


def test_the_store_failing(client, monkeypatch):
    def broken(_id):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(work_map_diff_router.work_map_store, "get", broken)
    response = _get(client, ID_A, ID_B)
    assert response.status_code == 503
    assert response.json() == {"detail": "Work Map storage is unavailable"}


@pytest.mark.parametrize("params", [{"a": ID_A}, {"b": ID_B}, {}])
def test_a_missing_query_param(client, params):
    assert client.get("/api/v1/work_map_diff", params=params).status_code == 422


def test_the_route_is_in_the_app_next_to_work_maps(monkeypatch):
    import main

    paths = {route.path for route in main.app.routes}
    assert "/api/v1/work_map_diff" in paths
    assert "/api/v1/work_maps/{work_map_id}" in paths

    monkeypatch.setattr(work_map_diff_router.work_map_store, "get", STORE.get)
    client = TestClient(main.app)  # no `with`: the startup tasks stay off
    response = client.get("/api/v1/work_map_diff", params={"a": ID_A, "b": ID_B})
    assert response.status_code == 200
    assert response.json()["a"]["id"] == ID_A
    # /work_maps/{id} still answers for a Work Map id, not swallowed by the diff route.
    assert client.get("/api/v1/work_maps/work_map_diff").json() == {"detail": "Work Map not found"}
