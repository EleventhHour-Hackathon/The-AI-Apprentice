"""Record a task again: the new session's debrief asks the questions kept for the expert first."""

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

PARENT_ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
SESSION_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
OTHER_ID = "0b9e8d7c-6f5a-4b3c-8d2e-1f0a9b8c7d6e"
NOW = datetime(2026, 10, 4, 9, 30, tzinfo=timezone.utc)
START = f"/api/v1/sessions/{SESSION_ID}/start"
MERGE = f"/api/v1/sessions/{SESSION_ID}/merge"

Q1 = "Why is the capex threshold 5,000?"
Q2 = "Why do you check the vendor before the amount?"
Q3 = "Who approves an invoice over budget?"
DRAFT_GAP = "What happens when the PO is missing?"


def _added(question_id, text):
    return {
        "kind": follow_ups.QUESTION,
        "question_id": question_id,
        "text": text,
        "quote": "",
        "from": OTHER_ID,
        "added_at": "2026-10-04T09:30:00+00:00",
    }


def _pending(*pairs):
    return [
        {"question_id": i, "text": t, "quote": "", "from": "", "added_at": ""} for i, t in pairs
    ]


# --- helpers ---------------------------------------------------------------------------------


def test_parent_of():
    assert follow_ups.parent_of([]) is None
    assert follow_ups.parent_of(None) is None
    assert follow_ups.parent_of([{"kind": "step", "title": "x"}]) is None
    captures = [
        "junk",
        {"kind": "parent"},
        {"kind": "parent", "work_map_id": 7},
        {"kind": "parent", "work_map_id": PARENT_ID},
        {"kind": "parent", "work_map_id": OTHER_ID},
    ]
    assert follow_ups.parent_of(captures) == PARENT_ID


def test_lead_with_puts_kept_questions_first_without_repeats_or_blanks():
    pending = _pending(("a", Q1), ("b", "  "), ("c", Q2))
    draft = [DRAFT_GAP, "why IS the  capex threshold 5,000? ", "", Q2]
    assert follow_ups.lead_with(pending, draft) == [Q1, Q2, DRAFT_GAP]
    assert follow_ups.lead_with([], [DRAFT_GAP]) == [DRAFT_GAP]
    assert follow_ups.lead_with(_pending(("a", Q1)), []) == [Q1]


def test_delivered_only_for_questions_the_draft_asked():
    pending = _pending(("a", Q1), ("b", Q2), ("c", Q3))
    out = follow_ups.delivered(pending, [f"  {Q2.upper()}", DRAFT_GAP, Q1], SESSION_ID, NOW)
    assert out == [
        {
            "kind": "follow_up_delivered",
            "question_id": "a",
            "at": "2026-10-04T09:30:00+00:00",
            "session": SESSION_ID,
        },
        {
            "kind": "follow_up_delivered",
            "question_id": "b",
            "at": "2026-10-04T09:30:00+00:00",
            "session": SESSION_ID,
        },
    ]
    assert follow_ups.delivered(pending, [], SESSION_ID, NOW) == []
    assert follow_ups.delivered(pending, ["", None], SESSION_ID, NOW) == []


# --- endpoints -------------------------------------------------------------------------------


class FakeStore:
    def __init__(self):
        self.maps = {
            PARENT_ID: {
                "id": PARENT_ID,
                "status": "confirmed",
                "captures": [_added("a", Q1), _added("b", Q2), _added("c", Q3)],
            }
        }
        self.calls = []
        self.fail = None
        self.fail_get = set()
        self.fail_add = set()

    def _call(self, name, *args):
        self.calls.append((name, *args))
        if self.fail:
            raise self.fail

    def start_session(self, session_id, conversation_id):
        self._call("start_session", session_id, conversation_id)
        row = self.maps.setdefault(
            session_id,
            {"id": session_id, "status": "recording", "captures": [], "open_questions": []},
        )
        if conversation_id:
            row["conversation_id"] = conversation_id

    def get(self, work_map_id):
        self._call("get", work_map_id)
        if work_map_id in self.fail_get:
            raise RuntimeError("down")
        found = self.maps.get(work_map_id)
        return copy.deepcopy(found) if found is not None else None

    def add_capture(self, session_id, capture):
        self._call("add_capture", session_id, capture)
        if session_id in self.fail_add:
            raise RuntimeError("down")
        if session_id not in self.maps:
            return False
        self.maps[session_id].setdefault("captures", []).append(capture)
        return True

    def screen_events(self, session_id, with_thumbs=False):
        self._call("screen_events", session_id, with_thumbs)
        return []

    def save_map(self, session_id, work_map, status):
        self._call("save_map", session_id, copy.deepcopy(work_map), status)
        self.maps[session_id].update(copy.deepcopy(work_map), status=status)


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    for name in ("start_session", "get", "add_capture", "screen_events", "save_map"):
        monkeypatch.setattr(path_router.work_map_store, name, getattr(fake, name))
    return fake


@pytest.fixture
def client(store):  # noqa: ARG001
    app = FastAPI()
    app.include_router(path_router.router)
    app.include_router(follow_ups_router.router)
    return TestClient(app)


def _merged(open_questions=None):
    return {
        "task": "Code a supplier invoice",
        "steps": [],
        "guardrails": [],
        "open_questions": list(open_questions if open_questions is not None else [DRAFT_GAP]),
    }


@pytest.fixture
def merged(monkeypatch):
    """The LLM merge, faked: returns `merged.map` (a fresh copy each call)."""

    class Merged:
        map = _merged()

    async def merge(**kwargs):  # noqa: ARG001
        return copy.deepcopy(Merged.map)

    monkeypatch.setattr(path_router, "merge", merge)
    return Merged


def _parents(store, session_id=SESSION_ID):
    return [c for c in store.maps[session_id]["captures"] if c.get("kind") == "parent"]


def _delivered(store):
    caps = store.maps[PARENT_ID]["captures"]
    return [c for c in caps if c.get("kind") == follow_ups.DELIVERED]


# start


def test_start_with_a_parent_records_it_once_across_both_calls(client, store):
    assert client.post(START, json={"parent_work_map_id": PARENT_ID}).json() == {"ok": True}
    r = client.post(START, json={"conversation_id": "conv_1", "parent_work_map_id": PARENT_ID})
    assert r.status_code == 200
    assert _parents(store) == [{"kind": "parent", "work_map_id": PARENT_ID}]
    assert store.maps[SESSION_ID]["conversation_id"] == "conv_1"


def test_a_different_parent_on_the_second_call_is_ignored(client, store):
    store.maps[OTHER_ID] = {"id": OTHER_ID, "status": "draft", "captures": []}
    client.post(START, json={"parent_work_map_id": PARENT_ID})
    assert client.post(START, json={"parent_work_map_id": OTHER_ID}).status_code == 200
    assert _parents(store) == [{"kind": "parent", "work_map_id": PARENT_ID}]


def test_the_parent_id_is_stored_canonical(client, store):
    r = client.post(START, json={"parent_work_map_id": PARENT_ID.upper()})
    assert r.status_code == 200
    assert _parents(store) == [{"kind": "parent", "work_map_id": PARENT_ID}]


@pytest.mark.parametrize("parent", ["not-a-uuid", OTHER_ID, "recording"])
def test_a_bad_unknown_or_recording_parent_is_not_found(client, store, parent):
    if parent == "recording":
        parent = OTHER_ID
        store.maps[OTHER_ID] = {"id": OTHER_ID, "status": "recording", "captures": []}
    r = client.post(START, json={"parent_work_map_id": parent})
    assert r.status_code == 404
    assert r.json() == {"detail": "Work Map not found"}
    assert SESSION_ID not in store.maps


def test_a_session_cannot_be_its_own_parent(client, store):
    r = client.post(START, json={"parent_work_map_id": SESSION_ID})
    assert r.status_code == 422
    assert r.json() == {"detail": "A session can't be recorded again from itself"}
    assert store.calls == []


@pytest.mark.parametrize("body", [{}, {"parent_work_map_id": None}, {"parent_work_map_id": ""}])
def test_start_without_a_parent_is_as_before(client, store, body):
    assert client.post(START, json=body).json() == {"ok": True}
    assert client.post(START, json={**body, "conversation_id": "conv_1"}).status_code == 200
    assert store.calls == [
        ("start_session", SESSION_ID, None),
        ("start_session", SESSION_ID, "conv_1"),
    ]
    assert _parents(store) == []


def test_start_without_a_body_is_as_before(client, store):
    assert client.post(START).json() == {"ok": True}
    assert store.calls == [("start_session", SESSION_ID, None)]


def test_a_store_that_fails_is_unavailable(client, store):
    store.fail = RuntimeError("down")
    r = client.post(START, json={"parent_work_map_id": PARENT_ID})
    assert r.status_code == 503
    assert client.post(START, json={}).status_code == 503


# draft merge


def _start(client):
    assert client.post(START, json={"parent_work_map_id": PARENT_ID}).status_code == 200


def test_the_draft_leads_with_the_kept_questions(client, store, merged):
    merged.map = _merged([DRAFT_GAP, Q2.lower()])
    _start(client)
    r = client.post(MERGE, json={"transcript": [], "final": False})
    assert r.status_code == 200
    body = r.json()
    assert body["open_questions"] == [Q1, Q2, Q3, DRAFT_GAP]
    gaps = body["brief"].split("GAPS TO ASK ABOUT FIRST")[1]
    assert gaps.index(Q1) < gaps.index(Q2) < gaps.index(Q3) < gaps.index(DRAFT_GAP)
    saved = [c for c in store.calls if c[0] == "save_map"][-1]
    assert saved[2]["open_questions"] == [Q1, Q2, Q3, DRAFT_GAP]
    assert saved[3] == "draft"


def test_a_second_draft_merge_does_not_double_them(client, store, merged):  # noqa: ARG001
    _start(client)
    client.post(MERGE, json={"transcript": [], "final": False})
    merged.map = _merged([DRAFT_GAP, Q1])
    r = client.post(MERGE, json={"transcript": [], "final": False})
    assert r.json()["open_questions"] == [Q1, Q2, Q3, DRAFT_GAP]


def test_kept_questions_are_redacted_again(client, store, merged):  # noqa: ARG001
    store.maps[PARENT_ID]["captures"] = [_added("a", "Why email jane.doe@example.com first?")]
    _start(client)
    r = client.post(MERGE, json={"transcript": [], "final": False})
    assert "jane.doe@example.com" not in r.text
    saved = [c for c in store.calls if c[0] == "save_map"][-1]
    assert "jane.doe@example.com" not in str(saved[2])
    assert len(r.json()["open_questions"]) == 2


def test_a_withdrawn_question_is_not_led_with(client, store, merged):  # noqa: ARG001
    store.maps[PARENT_ID]["captures"].append(follow_ups.closed("b", follow_ups.WITHDRAWN, NOW))
    _start(client)
    r = client.post(MERGE, json={"transcript": [], "final": False})
    assert r.json()["open_questions"] == [Q1, Q3, DRAFT_GAP]


# final merge


def _debriefed(client, store, asked):
    """A session recorded again whose debrief draft listed `asked`."""
    _start(client)
    store.maps[SESSION_ID].update(status="draft", open_questions=list(asked))


def test_the_final_merge_marks_what_the_debrief_asked_delivered(client, store, merged):
    merged.map = _merged([DRAFT_GAP])
    _debriefed(client, store, [Q1, Q3, DRAFT_GAP])
    r = client.post(MERGE, json={"transcript": [], "final": True})
    assert r.status_code == 200
    assert r.json()["open_questions"] == [DRAFT_GAP]
    saved = [c for c in store.calls if c[0] == "save_map"][-1]
    assert saved[2]["open_questions"] == [DRAFT_GAP]
    assert saved[3] == "confirmed"
    delivered = _delivered(store)
    assert [(c["question_id"], c["session"]) for c in delivered] == [
        ("a", SESSION_ID),
        ("c", SESSION_ID),
    ]
    listed = client.get(f"/api/v1/work_maps/{PARENT_ID}/follow_up_questions").json()
    assert [q["question_id"] for q in listed["questions"]] == ["b"]

    # A retried final merge delivers nothing twice.
    assert client.post(MERGE, json={"transcript": [], "final": True}).status_code == 200
    assert len(_delivered(store)) == 2


def test_the_final_merge_delivers_only_after_saving(client, store, merged):  # noqa: ARG001
    _debriefed(client, store, [Q1])
    client.post(MERGE, json={"transcript": [], "final": True})
    names = [c[0] for c in store.calls]
    assert names.index("save_map") < len(names) - 1 - names[::-1].index("add_capture")


def test_a_draft_merge_delivers_nothing(client, store, merged):  # noqa: ARG001
    _debriefed(client, store, [Q1, Q2, Q3])
    client.post(MERGE, json={"transcript": [], "final": False})
    assert _delivered(store) == []


@pytest.fixture
def warnings(monkeypatch):
    said = []
    monkeypatch.setattr(path_router.logger, "warning", said.append)
    return said


def test_a_deleted_parent_still_merges(client, store, merged, warnings):  # noqa: ARG001
    _debriefed(client, store, [Q1])
    del store.maps[PARENT_ID]
    for final in (False, True):
        r = client.post(MERGE, json={"transcript": [], "final": final})
        assert r.status_code == 200
        assert r.json()["open_questions"] == [DRAFT_GAP]
    assert [c[3] for c in store.calls if c[0] == "save_map"] == ["draft", "confirmed"]
    assert warnings == [f"Work Map {PARENT_ID}, recorded again from, is gone"] * 2


def test_a_parent_that_cannot_be_read_still_merges(client, store, merged, warnings):  # noqa: ARG001
    _debriefed(client, store, [Q1])
    store.fail_get.add(PARENT_ID)
    r = client.post(MERGE, json={"transcript": [], "final": True})
    assert r.status_code == 200
    assert [c[3] for c in store.calls if c[0] == "save_map"] == ["confirmed"]
    assert warnings == [f"Couldn't read Work Map {PARENT_ID}, recorded again from: down"]


def test_failing_to_mark_delivered_still_returns_the_map(client, store, merged):  # noqa: ARG001
    _debriefed(client, store, [Q1])
    store.fail_add.add(PARENT_ID)
    r = client.post(MERGE, json={"transcript": [], "final": True})
    assert r.status_code == 200
    assert store.maps[SESSION_ID]["status"] == "confirmed"


# no parent


@pytest.mark.parametrize("final", [False, True])
def test_a_session_without_a_parent_merges_as_before(client, store, merged, final):
    store.maps[SESSION_ID] = {
        "id": SESSION_ID,
        "status": "draft",
        "captures": [],
        "open_questions": [Q1],
    }
    r = client.post(MERGE, json={"transcript": [], "final": final, "duration": 12})
    expected = {
        **merged.map,
        "transcript": [],
        "duration": 12,
        "corrections": [],
        "task": "Code a supplier invoice",
    }
    assert store.calls == [
        ("get", SESSION_ID),
        ("screen_events", SESSION_ID, False),
        ("save_map", SESSION_ID, expected, "confirmed" if final else "draft"),
    ]
    body = r.json()
    assert body["open_questions"] == [DRAFT_GAP]
    assert body["brief"] == path_router.brief_for_agent(expected)
    assert body["summary"] == path_router.work_map_edit.summary_for_agent(expected)


def test_the_agent_still_cannot_forge_a_parent(client, store):
    store.maps[SESSION_ID] = {"id": SESSION_ID, "status": "recording", "captures": []}
    r = client.post(
        f"/api/v1/sessions/{SESSION_ID}/capture",
        json={"kind": "parent", "work_map_id": PARENT_ID},
    )
    assert r.status_code == 422
    assert _parents(store) == []
