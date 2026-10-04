"""Questions kept for an expert's next session: the helpers, the endpoints and the merge filter."""

import copy
from datetime import datetime, timezone
import os

import pytest

# Config checks these at import; nothing real is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.router import follow_ups_router, path_router  # noqa: E402
from src.services import follow_ups  # noqa: E402

MAP_ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
OTHER_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
URL = f"/api/v1/work_maps/{MAP_ID}/follow_up_questions"
NOW = datetime(2026, 10, 4, 9, 30, tzinfo=timezone.utc)


def _q(question_id, text="Why is the capex threshold 5,000?", **kw):
    return {"id": question_id, "text": text, "from_work_map_id": OTHER_ID, **kw}


def _added(question_id, at="2026-10-04T09:30:00+00:00"):
    return {
        "kind": follow_ups.QUESTION,
        "question_id": question_id,
        "text": "t",
        "quote": "",
        "from": OTHER_ID,
        "added_at": at,
    }


# --- helpers ---------------------------------------------------------------------------------


def test_capture_and_closed_shapes():
    c = follow_ups.capture(
        {"id": "steps:-:s2:only", "text": "Why?", "quote": "Weil."}, OTHER_ID, NOW
    )
    assert c == {
        "kind": "follow_up_question",
        "question_id": "steps:-:s2:only",
        "text": "Why?",
        "quote": "Weil.",
        "from": OTHER_ID,
        "added_at": "2026-10-04T09:30:00+00:00",
    }
    assert follow_ups.closed("q", follow_ups.WITHDRAWN, NOW) == {
        "kind": "follow_up_withdrawn",
        "question_id": "q",
        "at": "2026-10-04T09:30:00+00:00",
    }
    assert follow_ups.closed("q", follow_ups.DELIVERED, NOW, session=MAP_ID) == {
        "kind": "follow_up_delivered",
        "question_id": "q",
        "at": "2026-10-04T09:30:00+00:00",
        "session": MAP_ID,
    }


def test_pending_keeps_order_and_the_first_of_a_double_add():
    captures = [_added("a", "1"), _added("b", "2"), _added("a", "3")]
    assert [(q["question_id"], q["added_at"]) for q in follow_ups.pending(captures)] == [
        ("a", "1"),
        ("b", "2"),
    ]
    assert set(follow_ups.pending(captures)[0]) == {
        "question_id",
        "text",
        "quote",
        "from",
        "added_at",
    }


def test_pending_drops_withdrawn_and_delivered():
    captures = [
        _added("a"),
        _added("b"),
        _added("c"),
        {"kind": follow_ups.WITHDRAWN, "question_id": "a", "at": "x"},
        {"kind": follow_ups.DELIVERED, "question_id": "c", "at": "x", "session": OTHER_ID},
    ]
    assert [q["question_id"] for q in follow_ups.pending(captures)] == ["b"]


def test_a_question_added_again_after_withdrawing_counts_from_its_new_add():
    captures = [
        _added("a", "1"),
        _added("b", "2"),
        {"kind": follow_ups.WITHDRAWN, "question_id": "a", "at": "x"},
        _added("a", "3"),
    ]
    assert [(q["question_id"], q["added_at"]) for q in follow_ups.pending(captures)] == [
        ("b", "2"),
        ("a", "3"),
    ]


def test_pending_ignores_non_dicts_and_other_kinds():
    captures = [
        "junk",
        7,
        None,
        {"kind": "step", "question_id": "a"},
        {"kind": "live_question", "text": "Why?"},
    ]
    assert follow_ups.pending(captures) == []
    assert follow_ups.pending(None) == []


def test_for_merge_drops_exactly_the_five_kinds():
    kept = [
        {"kind": "step"},
        {"kind": "guardrail"},
        {"kind": "correction", "correction": "x"},
        {"t": 3.0},
    ]
    dropped = [
        {"kind": k}
        for k in (
            "live_question",
            "follow_up_question",
            "follow_up_withdrawn",
            "follow_up_delivered",
            "parent",
        )
    ]
    assert follow_ups.for_merge([*dropped, *kept, "junk"]) == kept


# --- endpoints -------------------------------------------------------------------------------


class FakeStore:
    def __init__(self):
        self.maps = {
            MAP_ID: {"id": MAP_ID, "captures": [{"kind": "step", "title": "Open the invoice"}]}
        }
        self.calls = []
        self.fail = None

    def _call(self, name, *args):
        self.calls.append((name, *args))
        if self.fail:
            raise self.fail

    def get(self, work_map_id):
        self._call("get", work_map_id)
        found = self.maps.get(work_map_id)
        return copy.deepcopy(found) if found is not None else None

    def add_capture(self, session_id, capture):
        self._call("add_capture", session_id, capture)
        if session_id not in self.maps:
            return False
        self.maps[session_id].setdefault("captures", []).append(capture)
        return True

    def screen_events(self, session_id, with_thumbs=False):
        self._call("screen_events", session_id, with_thumbs)
        return []

    def save_map(self, session_id, work_map, status):
        self._call("save_map", session_id, work_map, status)


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    for name in ("get", "add_capture", "screen_events", "save_map"):
        monkeypatch.setattr(follow_ups_router.work_map_store, name, getattr(fake, name))
    return fake


@pytest.fixture
def client(store):  # noqa: ARG001
    app = FastAPI()
    app.include_router(follow_ups_router.router)
    app.include_router(path_router.router)
    return TestClient(app)


def _stored(store, kind=follow_ups.QUESTION):
    return [c for c in store.maps[MAP_ID]["captures"] if c.get("kind") == kind]


def test_post_stores_the_capture_shape(client, store):
    r = client.post(
        URL,
        json={
            "questions": [
                _q(
                    "guardrails:g1:g1:numbers",
                    quote="  Over 5,000 is capex.  ",
                    from_work_map_id=OTHER_ID.upper(),
                )
            ]
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["added"] == ["guardrails:g1:g1:numbers"]
    [c] = _stored(store)
    assert set(c) == {"kind", "question_id", "text", "quote", "from", "added_at"}
    assert c["from"] == OTHER_ID  # canonical, though posted in upper case
    assert c["quote"] == "Over 5,000 is capex."
    assert datetime.fromisoformat(c["added_at"]).tzinfo is not None
    assert body["questions"] == [
        {k: c[k] for k in ("question_id", "text", "quote", "from", "added_at")}
    ]


def test_quote_defaults_to_empty(client, store):
    client.post(URL, json={"questions": [_q("a")]})
    assert _stored(store)[0]["quote"] == ""


def test_post_does_not_add_a_waiting_question_twice(client, store):
    client.post(URL, json={"questions": [_q("a")]})
    r = client.post(URL, json={"questions": [_q("b"), _q("a"), _q("b"), _q("c")]})
    assert r.json()["added"] == ["b", "c"]
    assert [q["question_id"] for q in r.json()["questions"]] == ["a", "b", "c"]
    assert [c["question_id"] for c in _stored(store)] == ["a", "b", "c"]


def test_text_and_quote_are_redacted(client, store):
    r = client.post(
        URL,
        json={
            "questions": [
                _q(
                    "a",
                    text="Why mail anna@example.com first?",
                    quote="Pay GB82WEST12345698765432 now",
                )
            ]
        },
    )
    assert r.status_code == 200
    stored = str(store.maps[MAP_ID]["captures"])
    assert "anna@example.com" not in stored and "GB82WEST12345698765432" not in stored
    assert "[email]" in _stored(store)[0]["text"] and "[iban]" in _stored(store)[0]["quote"]


@pytest.mark.parametrize("work_map_id", ["not-a-uuid", "0b6c8a1e-2f3d-4a5b-9c7d-1e2f3a4b5c6d"])
def test_unknown_or_non_uuid_map_is_not_found(client, store, work_map_id):  # noqa: ARG001
    url = f"/api/v1/work_maps/{work_map_id}/follow_up_questions"
    for r in (
        client.post(url, json={"questions": [_q("a")]}),
        client.get(url),
        client.delete(url, params={"question_id": "a"}),
    ):
        assert r.status_code == 404
        assert r.json() == {"detail": "Work Map not found"}


@pytest.mark.parametrize(
    "body",
    [
        {"questions": []},
        {"questions": [_q(str(i)) for i in range(11)]},
        {"questions": [_q("a", text="x" * 301)]},
        {"questions": [_q("a", text="")]},
        {"questions": [_q("", text="Why?")]},
        {"questions": [_q("a", quote="x" * 301)]},
        {"questions": [{"id": "a", "text": "Why?"}]},
        {},
    ],
)
def test_a_bad_shape_is_fastapis_422(client, store, body):
    r = client.post(URL, json=body)
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], list)
    assert _stored(store) == []


@pytest.mark.parametrize(
    "question, detail",
    [
        (_q("a", text="   "), "A question needs its text"),
        (_q("a", from_work_map_id="not-a-uuid"), "from_work_map_id is not a Work Map id"),
        (_q("a", from_work_map_id=MAP_ID.upper()), "A question can't come from the same Work Map"),
    ],
)
def test_a_bad_question_is_422_with_a_message(client, store, question, detail):
    r = client.post(URL, json={"questions": [_q("ok"), question]})
    assert r.status_code == 422
    assert r.json() == {"detail": detail}
    assert _stored(store) == []


def test_a_store_that_fails_is_unavailable(client, store):
    store.fail = RuntimeError("db down")
    for r in (
        client.post(URL, json={"questions": [_q("a")]}),
        client.get(URL),
        client.delete(URL, params={"question_id": "a"}),
    ):
        assert r.status_code == 503
        assert r.json() == {"detail": "Work Map storage is unavailable"}


def test_a_map_that_vanishes_mid_post_is_not_found(client, monkeypatch):
    monkeypatch.setattr(follow_ups_router.work_map_store, "add_capture", lambda *_: False)
    r = client.post(URL, json={"questions": [_q("a")]})
    assert r.status_code == 404
    assert r.json() == {"detail": "Work Map not found"}


def test_get_lists_nothing_then_what_was_posted(client, store):  # noqa: ARG001
    assert client.get(URL).json() == {"questions": []}
    client.post(URL, json={"questions": [_q("a"), _q("b")]})
    assert [q["question_id"] for q in client.get(URL).json()["questions"]] == ["a", "b"]


def test_withdraw_then_list(client, store):
    question_id = "guardrails:g1:g1:numbers"
    client.post(URL, json={"questions": [_q(question_id), _q("steps:-:s2:only")]})
    r = client.delete(URL, params={"question_id": question_id})
    assert r.status_code == 200
    assert r.json()["withdrawn"] == question_id
    assert [q["question_id"] for q in r.json()["questions"]] == ["steps:-:s2:only"]
    assert [q["question_id"] for q in client.get(URL).json()["questions"]] == ["steps:-:s2:only"]
    [w] = _stored(store, follow_ups.WITHDRAWN)
    assert set(w) == {"kind", "question_id", "at"} and w["question_id"] == question_id
    # The question itself is still in the list: captures are appended, never rewritten.
    assert len(_stored(store)) == 2


def test_withdrawing_an_unknown_or_withdrawn_question_is_not_found(client, store):  # noqa: ARG001
    client.post(URL, json={"questions": [_q("a")]})
    assert client.delete(URL, params={"question_id": "a"}).status_code == 200
    for question_id in ("a", "nope"):
        r = client.delete(URL, params={"question_id": question_id})
        assert r.status_code == 404
        assert r.json() == {"detail": "No such question waiting"}


def test_delete_needs_a_question_id(client, store):  # noqa: ARG001
    assert client.delete(URL).status_code == 422
    assert client.delete(URL, params={"question_id": ""}).status_code == 422


def test_a_withdrawn_question_can_be_added_again(client, store):  # noqa: ARG001
    client.post(URL, json={"questions": [_q("a"), _q("b")]})
    client.delete(URL, params={"question_id": "a"})
    r = client.post(URL, json={"questions": [_q("a")]})
    assert r.json()["added"] == ["a"]
    assert [q["question_id"] for q in r.json()["questions"]] == ["b", "a"]


# --- path_router -----------------------------------------------------------------------------


def test_the_merge_sees_only_what_the_agent_recorded(client, store, monkeypatch):
    store.maps[MAP_ID]["captures"] = [
        _added("a"),
        {"kind": "parent", "work_map_id": OTHER_ID},
        {"kind": "live_question", "text": "Why capex?", "t": 9.0},
        {"kind": "step", "title": "Open the invoice"},
    ]
    seen = {}

    async def merge(**kwargs):
        seen.update(kwargs)
        return {
            "task": "Code a supplier invoice",
            "steps": [],
            "guardrails": [],
            "open_questions": [],
        }

    monkeypatch.setattr(path_router, "merge", merge)
    r = client.post(f"/api/v1/sessions/{MAP_ID}/merge", json={"transcript": [], "final": False})
    assert r.status_code == 200
    assert seen["captures"] == [{"kind": "step", "title": "Open the invoice"}]


@pytest.mark.parametrize(
    "kind", ["follow_up_question", "follow_up_withdrawn", "follow_up_delivered", "parent"]
)
def test_the_agent_capture_endpoint_cannot_forge_follow_ups(client, store, kind):
    r = client.post(
        f"/api/v1/sessions/{MAP_ID}/capture",
        json={"kind": kind, "question_id": "a", "text": "Why?"},
    )
    assert r.status_code == 422
    assert r.json() == {"detail": "That kind of capture can't be recorded here"}
    assert store.calls == []


def test_the_agent_capture_endpoint_still_records_steps(client, store):
    r = client.post(
        f"/api/v1/sessions/{MAP_ID}/capture", json={"kind": "step", "title": "Check the vendor"}
    )
    assert r.status_code == 200
    assert store.maps[MAP_ID]["captures"][-1] == {"kind": "step", "title": "Check the vendor"}
