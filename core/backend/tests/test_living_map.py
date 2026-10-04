"""A repeat session of a confirmed Work Map: the debrief asks only what changed, and the update is
kept on the session until someone applies it to the original map."""

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

from src.router import follow_ups_router, living_map_router, path_router  # noqa: E402
from src.services import follow_ups, living_map, work_map_update  # noqa: E402

PARENT_ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
SESSION_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
OTHER_ID = "0b9e8d7c-6f5a-4b3c-8d2e-1f0a9b8c7d6e"
NOW = datetime(2026, 10, 4, 9, 30, tzinfo=timezone.utc)
START = f"/api/v1/sessions/{SESSION_ID}/start"
MERGE = f"/api/v1/sessions/{SESSION_ID}/merge"
APPLY = f"/api/v1/work_maps/{PARENT_ID}/apply_update?from={SESSION_ID}"

KEPT = "Why is the capex threshold 5,000?"
DRAFT_GAP = "What happens when the PO is missing?"
ADDED_GAP = "This time you 'Matched the invoice against PO 8812'. What made you add that?"
NUMBER_GAP = (
    "Last time the number in 'Ask before posting a large invoice' was 10,000; now it's 5,000."
    " What changed?"
)


def _steps():
    return [
        {
            "id": "s1",
            "title": "Open the invoice",
            "decision": "Opened invoice 4711 from the inbox.",
            "reason": "",
            "judgment": False,
            "at": 4.0,
            "quote": "Ich mache erst mal die Rechnung auf.",
            "quote_translation": "First I open the invoice.",
        },
        {
            "id": "s2",
            "title": "Code the cost account",
            "decision": "Re-coded from opex to capex 0400.",
            "reason": "Anything over 5,000 is a fixed asset.",
            "judgment": True,
            "at": 31.5,
            "quote": "Alles über 5.000 ist Anlagevermögen.",
            "quote_translation": "Anything over 5,000 is a fixed asset.",
        },
    ]


def _guardrails(over="10,000"):
    return [
        {
            "id": "g1",
            "kind": "stop_and_ask",
            "rule": "Ask before posting a large invoice.",
            "applies_when": f"the invoice is over {over}",
            "ask_whom": "the controller",
            "step": "s2",
            "at": 40.0,
            "quote": "",
        }
    ]


def _parent_row():
    """The confirmed invoice map, with one question kept for the expert's next session."""
    return {
        "id": PARENT_ID,
        "status": "confirmed",
        "task": "Code a supplier invoice",
        "steps": _steps(),
        "guardrails": _guardrails(),
        "open_questions": ["Who signs off travel costs?"],
        "transcript": [{"role": "expert", "text": "first session", "t": 1.0}],
        "duration": 90,
        "corrections": [{"action": "change", "item_id": "s1"}],
        "confirmation": {"teach_back": "You open, code, ask.", "said": "Yes.", "t": 88.0},
        "captures": [
            {
                "kind": follow_ups.QUESTION,
                "question_id": "q1",
                "text": KEPT,
                "quote": "",
                "from": OTHER_ID,
                "added_at": "2026-10-04T09:00:00+00:00",
            }
        ],
    }


def _repeat_map(open_questions=None):
    """The same task recorded again: a new purchase-order step and the threshold lowered."""
    steps = _steps()
    for s in steps:
        s["at"] += 100
    steps.append(
        {
            "id": "s3",
            "title": "Check the purchase order",
            "decision": "Matched the invoice against PO 8812.",
            "reason": "No PO, no payment.",
            "judgment": False,
            "at": 150.0,
            "quote": "Ohne Bestellung keine Zahlung.",
        }
    )
    guardrails = _guardrails("5,000")
    guardrails[0]["at"] = 145.0
    return {
        "task": "Code a supplier invoice",
        "steps": steps,
        "guardrails": guardrails,
        "open_questions": list([DRAFT_GAP] if open_questions is None else open_questions),
    }


CHANGES = {
    "new": [{"section": "steps", "id": "s3", "title": "Check the purchase order"}],
    "changed": [
        {
            "section": "guardrails",
            "id": "g1",
            "title": "Ask before posting a large invoice.",
            "fields": ["numbers"],
        }
    ],
    "removed": [],
    "unchanged": [
        {"section": "steps", "id": "s1", "title": "Open the invoice"},
        {"section": "steps", "id": "s2", "title": "Code the cost account"},
    ],
}


# --- living_map ------------------------------------------------------------------------------


def test_fingerprint_is_stable_under_key_order_and_changes_with_a_rule():
    a = {"steps": _steps(), "guardrails": _guardrails(), "transcript": "x"}
    b = {
        "guardrails": [dict(reversed(list(g.items()))) for g in _guardrails()],
        "steps": [dict(reversed(list(s.items()))) for s in _steps()],
        "open_questions": ["other"],
    }
    assert living_map.fingerprint(a) == living_map.fingerprint(b)
    assert len(living_map.fingerprint(a)) == 64
    assert living_map.fingerprint({}) == living_map.fingerprint({"steps": None, "guardrails": []})
    changed = copy.deepcopy(a)
    changed["guardrails"][0]["rule"] = "Ask before posting any invoice."
    assert living_map.fingerprint(changed) != living_map.fingerprint(a)


def test_capture_keeps_the_updated_steps_and_rules_only():
    parent = _parent_row()
    new = {**_repeat_map(), "transcript": [{"role": "expert", "text": "second", "t": 2.0}]}
    result = work_map_update.update(parent, new)
    before = copy.deepcopy(result)
    c = living_map.capture(PARENT_ID, parent, result, NOW)
    assert result == before
    assert c == {
        "kind": "living_update",
        "parent_work_map_id": PARENT_ID,
        "parent_fingerprint": living_map.fingerprint(parent),
        "changes": CHANGES,
        "map": {
            "task": "Code a supplier invoice",
            "steps": result["map"]["steps"],
            "guardrails": result["map"]["guardrails"],
        },
        "at": "2026-10-04T09:30:00+00:00",
    }
    c["map"]["steps"][0]["title"] = "changed"
    assert result["map"]["steps"][0]["title"] == "Open the invoice"


def test_latest_is_the_newest_update_for_that_parent():
    first = {"kind": "living_update", "parent_work_map_id": PARENT_ID, "map": {}, "at": "1"}
    second = {**first, "at": "2"}
    other = {**first, "parent_work_map_id": OTHER_ID, "at": "3"}
    captures = ["junk", first, {"kind": "step"}, second, other, {"kind": "living_update"}]
    assert living_map.latest(captures, PARENT_ID) is second
    assert living_map.latest(captures, OTHER_ID) is other
    assert living_map.latest([], PARENT_ID) is None
    assert living_map.latest(None, PARENT_ID) is None


def test_applied_keeps_the_parents_ids_and_its_own_record():
    parent = _parent_row()
    result = work_map_update.update(parent, _repeat_map())
    stored = living_map.capture(PARENT_ID, parent, result, NOW)
    before = (copy.deepcopy(parent), copy.deepcopy(stored))
    out = living_map.applied(parent, stored, SESSION_ID)
    assert (parent, stored) == before
    assert [s["id"] for s in out["steps"]] == ["s1", "s2", "s3"]
    assert [g["id"] for g in out["guardrails"]] == ["g1"]
    s1, s2, s3 = out["steps"]
    assert s1 == {**_steps()[0], "source": "parent"}
    assert "from_session" not in s2
    assert s3["from_session"] == SESSION_ID and s3["added"] is True and s3["source"] == "new"
    g1 = out["guardrails"][0]
    assert g1["from_session"] == SESSION_ID and g1["changed"] == ["numbers"]
    assert g1["applies_when"] == "the invoice is over 5,000"
    for field in (
        "transcript",
        "duration",
        "corrections",
        "confirmation",
        "open_questions",
        "task",
    ):
        assert out[field] == parent[field]


def test_applied_takes_the_task_only_when_the_parent_has_none():
    stored = {"map": {"task": "Code an invoice", "steps": [], "guardrails": []}}
    assert living_map.applied({"task": "  "}, stored, SESSION_ID)["task"] == "Code an invoice"
    assert living_map.applied({}, stored, SESSION_ID)["task"] == "Code an invoice"
    assert living_map.applied({"task": "Mine"}, stored, SESSION_ID)["task"] == "Mine"


# --- endpoints -------------------------------------------------------------------------------


class FakeStore:
    def __init__(self):
        self.maps = {PARENT_ID: _parent_row()}
        self.calls = []
        self.fail = None
        self.fail_add = set()

    def _call(self, name, *args):
        self.calls.append((name, *args))
        if self.fail:
            raise self.fail

    def start_session(self, session_id, conversation_id):
        self._call("start_session", session_id, conversation_id)
        self.maps.setdefault(
            session_id,
            {"id": session_id, "status": "recording", "captures": [], "open_questions": []},
        )

    def get(self, work_map_id):
        self._call("get", work_map_id)
        found = self.maps.get(work_map_id)
        return copy.deepcopy(found) if found is not None else None

    def add_capture(self, session_id, capture):
        self._call("add_capture", session_id, capture)
        if session_id in self.fail_add:
            raise RuntimeError("down")
        if session_id not in self.maps:
            return False
        self.maps[session_id].setdefault("captures", []).append(copy.deepcopy(capture))
        return True

    def screen_events(self, session_id, with_thumbs=False):
        self._call("screen_events", session_id, with_thumbs)
        # The parent's screen: a moment at every time its items point at, and the new ones too.
        return [
            {"t": t, "event": f"event at {t}", "thumb": f"thumb-{t}"}
            for t in (4.0, 31.5, 40.0, 145.0, 150.0)
        ]

    def save_map(self, session_id, work_map, status):
        self._call("save_map", session_id, copy.deepcopy(work_map), status)
        self.maps[session_id].update(copy.deepcopy(work_map), status=status)


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    for name in ("start_session", "get", "add_capture", "screen_events", "save_map"):
        monkeypatch.setattr(path_router.work_map_store, name, getattr(fake, name))
    monkeypatch.setattr(path_router.media_store, "recordings", lambda _id: [])
    return fake


@pytest.fixture
def client(store):  # noqa: ARG001
    app = FastAPI()
    app.include_router(path_router.router)
    app.include_router(follow_ups_router.router)
    app.include_router(living_map_router.router)
    return TestClient(app)


@pytest.fixture
def merged(monkeypatch):
    """The LLM merge, faked: returns `merged.map` (a fresh copy each call)."""

    class Merged:
        map = _repeat_map()

    async def merge(**kwargs):  # noqa: ARG001
        return copy.deepcopy(Merged.map)

    monkeypatch.setattr(path_router, "merge", merge)
    return Merged


def _start(client):
    assert client.post(START, json={"parent_work_map_id": PARENT_ID}).status_code == 200


def _updates(store):
    return [c for c in store.maps[SESSION_ID]["captures"] if c.get("kind") == "living_update"]


def _confirmed(client, store):
    """Recorded again, debriefed (the draft asked the kept question), and confirmed."""
    _start(client)
    store.maps[SESSION_ID].update(status="draft", open_questions=[KEPT, ADDED_GAP])
    r = client.post(MERGE, json={"transcript": [], "final": True})
    assert r.status_code == 200
    return r


# draft merge


def test_the_draft_asks_the_kept_question_then_what_changed(client, store, merged):  # noqa: ARG001
    _start(client)
    r = client.post(MERGE, json={"transcript": [], "final": False})
    assert r.status_code == 200
    body = r.json()
    assert body["open_questions"] == [KEPT, ADDED_GAP, NUMBER_GAP, DRAFT_GAP]
    assert body["living_update"] == {"parent_work_map_id": PARENT_ID, "changes": CHANGES}
    saved = [c for c in store.calls if c[0] == "save_map"][-1]
    assert saved[1:] == (SESSION_ID, saved[2], "draft")
    assert saved[2]["open_questions"] == [KEPT, ADDED_GAP, NUMBER_GAP, DRAFT_GAP]
    # The session's own map is saved, not the updated one.
    assert [s["id"] for s in saved[2]["steps"]] == ["s1", "s2", "s3"]
    assert "source" not in saved[2]["steps"][0]
    gaps = body["brief"].split("GAPS TO ASK ABOUT FIRST")[1]
    assert gaps.index(KEPT) < gaps.index(ADDED_GAP) < gaps.index(NUMBER_GAP) < gaps.index(DRAFT_GAP)
    # Nothing is kept on a draft.
    assert _updates(store) == []


def test_an_identical_repeat_asks_nothing_about_changes(client, store, merged):
    parent = store.maps[PARENT_ID]
    merged.map = {
        "task": parent["task"],
        "steps": copy.deepcopy(parent["steps"]),
        "guardrails": copy.deepcopy(parent["guardrails"]),
        "open_questions": [DRAFT_GAP],
    }
    _start(client)
    body = client.post(MERGE, json={"transcript": [], "final": False}).json()
    assert body["open_questions"] == [KEPT, DRAFT_GAP]
    changes = body["living_update"]["changes"]
    assert changes["new"] == changes["changed"] == changes["removed"] == []
    assert [c["id"] for c in changes["unchanged"]] == ["s1", "s2", "g1"]


def test_a_draft_parent_keeps_the_kept_questions_only(client, store, merged):  # noqa: ARG001
    store.maps[PARENT_ID]["status"] = "draft"
    _start(client)
    body = client.post(MERGE, json={"transcript": [], "final": False}).json()
    assert "living_update" not in body
    assert body["open_questions"] == [KEPT, DRAFT_GAP]


@pytest.fixture
def warnings(monkeypatch):
    said = []
    monkeypatch.setattr(path_router.logger, "warning", said.append)
    return said


@pytest.mark.parametrize("final", [False, True])
def test_an_update_that_fails_still_merges_as_before(
    client,
    store,
    merged,  # noqa: ARG001
    monkeypatch,
    warnings,
    final,
):
    def broken(parent, new):  # noqa: ARG001
        raise ValueError("bad map")

    monkeypatch.setattr(path_router.work_map_update, "update", broken)
    _start(client)
    store.maps[SESSION_ID]["open_questions"] = [KEPT]
    r = client.post(MERGE, json={"transcript": [], "final": final})
    assert r.status_code == 200
    body = r.json()
    assert "living_update" not in body
    assert body["open_questions"] == [DRAFT_GAP] if final else [KEPT, DRAFT_GAP]
    assert store.maps[SESSION_ID]["status"] == ("confirmed" if final else "draft")
    assert _updates(store) == []
    assert warnings == [f"Couldn't update Work Map {PARENT_ID} from session {SESSION_ID}: bad map"]


# final merge


def test_the_final_merge_keeps_one_update_and_returns_it(client, store, merged):  # noqa: ARG001
    r = _confirmed(client, store)
    body = r.json()
    assert body["living_update"] == {"parent_work_map_id": PARENT_ID, "changes": CHANGES}
    assert store.maps[SESSION_ID]["status"] == "confirmed"
    (kept,) = _updates(store)
    assert kept["parent_fingerprint"] == living_map.fingerprint(_parent_row())
    assert kept["changes"] == CHANGES
    assert set(kept["map"]) == {"task", "steps", "guardrails"}
    assert [s["id"] for s in kept["map"]["steps"]] == ["s1", "s2", "s3"]
    # The kept question the draft asked is delivered on the parent, as before.
    caps = store.maps[PARENT_ID]["captures"]
    assert [c["question_id"] for c in caps if c["kind"] == follow_ups.DELIVERED] == ["q1"]
    # The parent itself is untouched until someone applies the update.
    parent = store.maps[PARENT_ID]
    assert (parent["steps"], parent["guardrails"]) == (_steps(), _guardrails())


def test_the_update_is_kept_only_after_the_session_is_saved(client, store, merged):  # noqa: ARG001
    _confirmed(client, store)
    saved = next(i for i, c in enumerate(store.calls) if c[0] == "save_map")
    kept = next(
        i
        for i, c in enumerate(store.calls)
        if c[0] == "add_capture" and c[2].get("kind") == "living_update"
    )
    assert saved < kept


def test_an_update_that_cannot_be_kept_is_not_returned(client, store, merged, monkeypatch):  # noqa: ARG001
    errors = []
    monkeypatch.setattr(path_router.logger, "error", errors.append)
    _start(client)
    store.fail_add.add(SESSION_ID)
    r = client.post(MERGE, json={"transcript": [], "final": True})
    assert r.status_code == 200
    assert "living_update" not in r.json()
    assert store.maps[SESSION_ID]["status"] == "confirmed"
    assert errors == [f"Couldn't keep the update for Work Map {PARENT_ID} on {SESSION_ID}: down"]


@pytest.mark.parametrize("final", [False, True])
def test_a_session_without_a_parent_has_the_same_response(client, store, merged, final):
    store.maps[SESSION_ID] = {
        "id": SESSION_ID,
        "status": "draft",
        "captures": [],
        "open_questions": [],
    }
    body = client.post(MERGE, json={"transcript": [], "final": final, "duration": 12}).json()
    expected = {
        **merged.map,
        "transcript": [],
        "duration": 12,
        "corrections": [],
    }
    assert body == {
        **expected,
        "brief": path_router.brief_for_agent(expected),
        "summary": path_router.work_map_edit.summary_for_agent(expected),
    }
    assert [c[0] for c in store.calls] == ["get", "screen_events", "save_map"]


@pytest.mark.parametrize("kind", ["living_update", "living_applied"])
def test_the_agent_cannot_forge_an_update(client, store, kind):
    store.maps[SESSION_ID] = {"id": SESSION_ID, "status": "recording", "captures": []}
    r = client.post(
        f"/api/v1/sessions/{SESSION_ID}/capture",
        json={"kind": kind, "parent_work_map_id": PARENT_ID, "map": {}},
    )
    assert r.status_code == 422
    assert store.maps[SESSION_ID]["captures"] == []


def test_the_merge_never_sees_living_captures():
    captures = [{"kind": "living_update"}, {"kind": "living_applied"}, {"kind": "step"}]
    assert follow_ups.for_merge(captures) == [{"kind": "step"}]


def test_with_the_real_merge_the_draft_leads_with_the_kept_question(client, store, merge_llm):  # noqa: ARG001
    llm = _repeat_map()
    for item in [*llm["steps"], *llm["guardrails"]]:
        item["at"] = ""
    merge_llm(llm)
    _start(client)
    body = client.post(MERGE, json={"transcript": [], "final": False}).json()
    assert body["open_questions"][:3] == [KEPT, ADDED_GAP, NUMBER_GAP]
    assert body["living_update"]["changes"]["new"] == CHANGES["new"]
    assert body["living_update"]["changes"]["changed"] == CHANGES["changed"]


# apply


def test_apply_writes_the_update_over_the_parent(client, store, merged):  # noqa: ARG001
    _confirmed(client, store)
    r = client.post(APPLY)
    assert r.status_code == 200
    assert r.json() == {"work_map_id": PARENT_ID, "applied_from": SESSION_ID, "changes": CHANGES}

    parent = store.maps[PARENT_ID]
    assert parent["status"] == "confirmed"
    assert [(s["id"], s["source"]) for s in parent["steps"]] == [
        ("s1", "parent"),
        ("s2", "parent"),
        ("s3", "new"),
    ]
    assert parent["steps"][2]["from_session"] == SESSION_ID
    assert parent["steps"][2]["added"] is True
    assert "from_session" not in parent["steps"][0]
    assert parent["guardrails"][0]["applies_when"] == "the invoice is over 5,000"
    assert parent["guardrails"][0]["from_session"] == SESSION_ID
    # The parent's own record stays.
    original = _parent_row()
    for field in (
        "transcript",
        "duration",
        "corrections",
        "confirmation",
        "open_questions",
        "task",
    ):
        assert parent[field] == original[field]
    applied = [c for c in parent["captures"] if c["kind"] == "living_applied"]
    assert len(applied) == 1
    assert applied[0]["from_session"] == SESSION_ID and applied[0]["changes"] == CHANGES


def test_items_from_the_repeat_session_get_no_moment_of_the_parent(client, store, merged):  # noqa: ARG001
    _confirmed(client, store)
    assert client.post(APPLY).status_code == 200
    body = client.get(f"/api/v1/work_maps/{PARENT_ID}").json()
    s1, _s2, s3 = body["steps"]
    assert s1["thumb"] == "thumb-4.0"
    assert "thumb" not in s3 and "event" not in s3 and "clip" not in s3
    g1 = body["guardrails"][0]
    assert "thumb" not in g1 and "clip" not in g1


def test_a_second_apply_is_refused(client, store, merged):  # noqa: ARG001
    _confirmed(client, store)
    assert client.post(APPLY).status_code == 200
    r = client.post(APPLY)
    assert r.status_code == 409
    assert r.json() == {
        "detail": "The Work Map changed since this update was made. Record it again to update it."
    }
    assert len([c for c in store.maps[PARENT_ID]["captures"] if c["kind"] == "living_applied"]) == 1


def test_a_stale_parent_is_refused(client, store, merged):  # noqa: ARG001
    _confirmed(client, store)
    store.maps[PARENT_ID]["guardrails"][0]["ask_whom"] = "Petra"
    assert client.post(APPLY).status_code == 409
    assert store.maps[PARENT_ID]["guardrails"][0]["ask_whom"] == "Petra"


@pytest.mark.parametrize(
    "url, detail",
    [
        (f"/api/v1/work_maps/not-a-uuid/apply_update?from={SESSION_ID}", "Work Map not found"),
        (f"/api/v1/work_maps/{PARENT_ID}/apply_update?from=nope", "Session not found"),
        (f"/api/v1/work_maps/{OTHER_ID}/apply_update?from={SESSION_ID}", "Work Map not found"),
        (f"/api/v1/work_maps/{PARENT_ID}/apply_update?from={OTHER_ID}", "Session not found"),
    ],
)
def test_apply_unknown_ids_are_not_found(client, store, merged, url, detail):  # noqa: ARG001
    _confirmed(client, store)
    r = client.post(url)
    assert r.status_code == 404
    assert r.json() == {"detail": detail}


def test_apply_needs_the_from_session(client, store):  # noqa: ARG001
    assert client.post(f"/api/v1/work_maps/{PARENT_ID}/apply_update").status_code == 422


def test_a_session_without_an_update_has_nothing_to_apply(client, store):
    store.maps[SESSION_ID] = {"id": SESSION_ID, "status": "confirmed", "captures": []}
    r = client.post(APPLY)
    assert r.status_code == 422
    assert r.json() == {"detail": "This session has no update for that Work Map"}
    assert [c[0] for c in store.calls] == ["get", "get"]


def test_apply_when_the_store_fails_is_unavailable(client, store, merged, monkeypatch):  # noqa: ARG001
    monkeypatch.setattr(path_router.logger, "error", lambda *_: None)
    _confirmed(client, store)
    store.fail = RuntimeError("down")
    r = client.post(APPLY)
    assert r.status_code == 503
    assert r.json() == {"detail": "Work Map storage is unavailable"}
