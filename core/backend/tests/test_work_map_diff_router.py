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
    assert set(body) == {"a", "b", "diff"}
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
