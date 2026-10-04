"""The sessions, work_maps and lessons endpoints, with the stores and the tutor's LLM faked."""

import copy
import os
import uuid

import pytest

# Config checks these at import; nothing real is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.router import path_router  # noqa: E402
from src.services import tutor  # noqa: E402

SESSION_ID = "6f1c2b9e-3d4a-4c5b-8e7f-0a1b2c3d4e5f"
OTHER_ID = "0b6c8a1e-2f3d-4a5b-9c7d-1e2f3a4b5c6d"
LESSON_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"

WORK_MAP = {
    "id": SESSION_ID,
    "status": "confirmed",
    "task": "Code a supplier invoice",
    "steps": [
        {"id": "s1", "title": "Open the invoice", "at": 3.0},
        {"id": "s2", "title": "Code the cost account", "decision": "Capex 0400.", "at": 9.5},
    ],
    "guardrails": [{"id": "g1", "kind": "limit", "rule": "Over 5,000 is capex", "step": "s2"}],
    "captures": [
        {"kind": "step", "title": "Open the invoice"},
        {"kind": "live_question", "text": "Why capex?", "t": 9.0, "question_kind": "reason"},
        {"kind": "live_question", "text": "Who approves?", "t": 12.0, "deferred": True},
    ],
}


class FakeStores:
    """The work_maps, lessons and media stores and the recordings service, in memory."""

    def __init__(self):
        self.maps = {}
        self.lessons = {}
        self.calls = []
        self.fail = None  # an exception every store call raises

    def _call(self, name, *args):
        self.calls.append((name, *args))
        if self.fail:
            raise self.fail

    # storage.work_maps
    def start_session(self, session_id, conversation_id):
        self._call("start_session", session_id, conversation_id)
        self.maps.setdefault(session_id, {"id": session_id, "status": "recording", "captures": []})

    def set_task(self, session_id, task):
        self._call("set_task", session_id, task)
        self.maps[session_id]["task"] = task

    def add_capture(self, session_id, capture):
        self._call("add_capture", session_id, capture)
        if session_id not in self.maps:
            return False
        self.maps[session_id].setdefault("captures", []).append(capture)
        return True

    def get(self, work_map_id):
        self._call("get", work_map_id)
        found = self.maps.get(work_map_id)
        return copy.deepcopy(found) if found is not None else None

    def delete(self, work_map_id):
        self._call("delete", work_map_id)
        return self.maps.pop(work_map_id, None) is not None

    def list_summaries(self):
        self._call("list_summaries")
        return [{"id": k, "task": v.get("task")} for k, v in self.maps.items()]

    def screen_events(self, session_id, with_thumbs=False):
        self._call("screen_events", session_id, with_thumbs)
        return [{"t": 3.0, "event": "Opened invoice 4711", "thumb": "data:thumb"}]

    # storage.media
    def recordings(self, session_id):
        self._call("recordings", session_id)
        return []

    # services.recordings
    def delete_recording(self, session_id):
        self._call("delete_recording", session_id)

    # storage.lessons
    def create_lesson(self, lesson_id, work_map_id):
        self._call("create_lesson", lesson_id, work_map_id)
        self.lessons[lesson_id] = {"id": lesson_id, "work_map_id": work_map_id, "attempts": []}

    def set_conversation(self, lesson_id, conversation_id):
        self._call("set_conversation", lesson_id, conversation_id)

    def add_attempt(self, lesson_id, attempt):
        self._call("add_attempt", lesson_id, attempt)
        if lesson_id not in self.lessons:
            return False
        self.lessons[lesson_id]["attempts"].append(attempt)
        return True

    def finish(self, lesson_id, transcript, report):
        self._call("finish", lesson_id, transcript, report)
        self.lessons[lesson_id].update(transcript=transcript, report=report)

    def get_lesson(self, lesson_id):
        self._call("get_lesson", lesson_id)
        found = self.lessons.get(lesson_id)
        return copy.deepcopy(found) if found is not None else None


@pytest.fixture
def stores(monkeypatch):
    fake = FakeStores()
    store = path_router.work_map_store
    for name in (
        "start_session",
        "set_task",
        "add_capture",
        "get",
        "delete",
        "list_summaries",
        "screen_events",
    ):
        monkeypatch.setattr(store, name, getattr(fake, name))
    monkeypatch.setattr(path_router.media_store, "recordings", fake.recordings)
    monkeypatch.setattr(path_router.recordings, "delete", fake.delete_recording)
    lessons = path_router.lesson_store
    monkeypatch.setattr(lessons, "create", fake.create_lesson)
    monkeypatch.setattr(lessons, "set_conversation", fake.set_conversation)
    monkeypatch.setattr(lessons, "add_attempt", fake.add_attempt)
    monkeypatch.setattr(lessons, "finish", fake.finish)
    monkeypatch.setattr(lessons, "get", fake.get_lesson)
    monkeypatch.setattr(path_router, "_lesson_maps", {})
    return fake


@pytest.fixture
def client(stores):  # noqa: ARG001
    app = FastAPI()
    app.include_router(path_router.router)
    return TestClient(app)


@pytest.fixture
def checks(monkeypatch):
    """tutor.check returns the next canned result; every call's arguments are kept."""
    calls = []
    results = []

    async def check(work_map, history, event, open_flags):
        calls.append(
            {"work_map": work_map, "history": history, "event": event, "flags": open_flags}
        )
        result = results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(tutor, "check", check)
    return calls, results


# Ids


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/v1/sessions/not-a-uuid/start"),
        ("post", "/api/v1/sessions/not-a-uuid/task"),
        ("post", "/api/v1/sessions/1; drop table work_maps/capture"),
        ("delete", "/api/v1/sessions/not-a-uuid"),
        ("get", "/api/v1/work_maps/not-a-uuid"),
        ("delete", "/api/v1/work_maps/not-a-uuid"),
        ("post", "/api/v1/lessons/not-a-uuid/start"),
        ("post", "/api/v1/lessons/not-a-uuid/check"),
        ("post", "/api/v1/lessons/not-a-uuid/attempt"),
        ("post", "/api/v1/lessons/not-a-uuid/finish"),
        ("get", "/api/v1/lessons/not-a-uuid"),
    ],
)
def test_an_id_that_is_not_a_uuid_is_not_found(client, stores, method, path):
    kwargs = {} if method in ("get", "delete") else {"json": {"event": "x", "task": "x"}}
    res = getattr(client, method)(path, **kwargs)
    assert res.status_code == 404
    assert res.json()["detail"].endswith("not found")
    assert stores.calls == []


def test_an_uppercase_uuid_is_the_same_session(client, stores):
    assert client.post(f"/api/v1/sessions/{SESSION_ID.upper()}/start", json={}).status_code == 200
    assert stores.calls == [("start_session", SESSION_ID, None)]


# Sessions


def test_start_task_and_capture(client, stores):
    base = f"/api/v1/sessions/{SESSION_ID}"
    assert client.post(f"{base}/start", json={"conversation_id": "conv_1"}).json() == {"ok": True}
    long_task = "  Code a supplier invoice " + "x" * 300
    assert client.post(f"{base}/task", json={"task": long_task}).json() == {"ok": True}
    capture = {"kind": "step", "title": "Mail anna.weber@example.com the invoice", "t": 4}
    assert client.post(f"{base}/capture", json=capture).json() == {"ok": True}

    assert stores.calls[0] == ("start_session", SESSION_ID, "conv_1")
    task = stores.calls[1][2]
    assert task.startswith("Code a supplier invoice x") and len(task) == 200
    assert stores.maps[SESSION_ID]["captures"] == [
        {"kind": "step", "title": "Mail [email] the invoice", "t": 4}
    ]


def test_a_task_without_text_is_empty(client, stores):
    client.post(f"/api/v1/sessions/{SESSION_ID}/start", json={})
    assert (
        client.post(f"/api/v1/sessions/{SESSION_ID}/task", json={"task": None}).status_code == 200
    )
    assert stores.maps[SESSION_ID]["task"] == ""


def test_a_capture_for_a_missing_session_is_not_found(client):
    res = client.post(f"/api/v1/sessions/{SESSION_ID}/capture", json={"kind": "step"})
    assert res.status_code == 404
    assert res.json() == {"detail": "Session not found"}


def test_discard_a_recording_session(client, stores):
    stores.maps[SESSION_ID] = {"id": SESSION_ID, "status": "recording"}
    res = client.delete(f"/api/v1/sessions/{SESSION_ID}")
    assert res.json() == {"deleted": SESSION_ID}
    assert SESSION_ID not in stores.maps
    names = [c[0] for c in stores.calls]
    assert names.index("delete_recording") < names.index("delete")


def test_discard_a_session_that_already_has_a_work_map(client, stores):
    stores.maps[SESSION_ID] = {"id": SESSION_ID, "status": "draft"}
    res = client.delete(f"/api/v1/sessions/{SESSION_ID}")
    assert res.status_code == 409
    assert SESSION_ID in stores.maps
    assert "delete_recording" not in [c[0] for c in stores.calls]


def test_discard_a_missing_session(client, stores):
    assert client.delete(f"/api/v1/sessions/{SESSION_ID}").json() == {"deleted": None}
    assert [c[0] for c in stores.calls] == ["get"]


# Work Maps


def test_list_work_maps(client, stores):
    stores.maps[SESSION_ID] = copy.deepcopy(WORK_MAP)
    assert client.get("/api/v1/work_maps").json() == [
        {"id": SESSION_ID, "task": "Code a supplier invoice"}
    ]


def test_get_a_work_map_with_its_moments_and_live_questions(client, stores):
    stores.maps[SESSION_ID] = copy.deepcopy(WORK_MAP)
    res = client.get(f"/api/v1/work_maps/{SESSION_ID}")
    assert res.status_code == 200
    body = res.json()
    assert "captures" not in body
    assert body["live_questions"] == [
        {"t": 9.0, "text": "Why capex?", "kind": "reason", "deferred": False},
        {"t": 12.0, "text": "Who approves?", "kind": "other", "deferred": True},
    ]
    first, second = body["steps"]
    assert first["event"] == "Opened invoice 4711" and first["thumb"] == "data:thumb"
    assert "event" not in second and "clip" not in second
    assert ("screen_events", SESSION_ID, True) in stores.calls


def test_get_a_missing_work_map(client):
    res = client.get(f"/api/v1/work_maps/{SESSION_ID}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Work Map not found"}


def test_delete_a_work_map_deletes_the_recording_first(client, stores):
    stores.maps[SESSION_ID] = copy.deepcopy(WORK_MAP)
    assert client.delete(f"/api/v1/work_maps/{SESSION_ID}").json() == {"deleted": SESSION_ID}
    assert stores.calls == [("delete_recording", SESSION_ID), ("delete", SESSION_ID)]


def test_delete_a_missing_work_map(client, stores):
    res = client.delete(f"/api/v1/work_maps/{SESSION_ID}")
    assert res.status_code == 404
    assert stores.calls == [("delete_recording", SESSION_ID), ("delete", SESSION_ID)]


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", f"/api/v1/sessions/{SESSION_ID}/start", {}),
        ("post", f"/api/v1/sessions/{SESSION_ID}/task", {"task": "x"}),
        ("post", f"/api/v1/sessions/{SESSION_ID}/capture", {"kind": "step"}),
        ("delete", f"/api/v1/sessions/{SESSION_ID}", None),
        ("get", "/api/v1/work_maps", None),
        ("get", f"/api/v1/work_maps/{SESSION_ID}", None),
        ("delete", f"/api/v1/work_maps/{SESSION_ID}", None),
        ("post", "/api/v1/lessons", {"work_map_id": SESSION_ID}),
        ("post", f"/api/v1/lessons/{LESSON_ID}/start", {"conversation_id": "c"}),
        ("post", f"/api/v1/lessons/{LESSON_ID}/check", {"event": "Saved"}),
        ("post", f"/api/v1/lessons/{LESSON_ID}/attempt", {"type": "done"}),
        ("post", f"/api/v1/lessons/{LESSON_ID}/finish", {}),
        ("get", f"/api/v1/lessons/{LESSON_ID}", None),
    ],
)
def test_a_store_that_fails_is_unavailable(client, stores, method, path, body):
    stores.fail = RuntimeError("connection refused")
    kwargs = {} if body is None else {"json": body}
    res = getattr(client, method)(path, **kwargs)
    assert res.status_code == 503
    assert res.json() == {"detail": "Work Map storage is unavailable"}


# Lessons


def _start_lesson(client, stores):
    stores.maps[SESSION_ID] = copy.deepcopy(WORK_MAP)
    res = client.post("/api/v1/lessons", json={"work_map_id": SESSION_ID})
    assert res.status_code == 200
    return res.json()


def test_start_a_lesson(client, stores):
    body = _start_lesson(client, stores)
    lesson_id = body["lesson_id"]
    assert str(uuid.UUID(lesson_id)) == lesson_id
    assert set(body) == {"lesson_id", "task", "work_map", "steps", "guardrails"}
    assert body["task"] == "Code a supplier invoice"
    assert body["work_map"] == tutor.work_map_text(WORK_MAP)
    assert [s["id"] for s in body["steps"]] == ["s1", "s2"]
    assert body["steps"][0]["thumb"] == "data:thumb"
    assert [g["id"] for g in body["guardrails"]] == ["g1"]
    assert stores.lessons[lesson_id]["work_map_id"] == SESSION_ID
    assert path_router._lesson_maps[lesson_id]["task"] == "Code a supplier invoice"


def test_a_lesson_without_a_task_name(client, stores):
    stores.maps[SESSION_ID] = {**copy.deepcopy(WORK_MAP), "task": ""}
    body = client.post("/api/v1/lessons", json={"work_map_id": SESSION_ID}).json()
    assert body["task"] == "the task"


def test_a_lesson_for_a_missing_work_map(client, stores):
    res = client.post("/api/v1/lessons", json={"work_map_id": SESSION_ID})
    assert res.status_code == 404
    assert res.json() == {"detail": "Work Map not found"}
    assert stores.lessons == {}


def test_a_lesson_without_a_work_map_id(client):
    res = client.post("/api/v1/lessons", json={})
    assert res.status_code == 404
    assert res.json() == {"detail": "Work Map not found"}


def test_a_lesson_for_a_work_map_with_no_steps(client, stores):
    stores.maps[SESSION_ID] = {**copy.deepcopy(WORK_MAP), "steps": []}
    res = client.post("/api/v1/lessons", json={"work_map_id": SESSION_ID})
    assert res.status_code == 422
    assert stores.lessons == {}


def test_lesson_connected(client, stores):
    res = client.post(f"/api/v1/lessons/{LESSON_ID}/start", json={"conversation_id": 42})
    assert res.json() == {"ok": True}
    assert stores.calls == [("set_conversation", LESSON_ID, "42")]


def test_check_passes_the_tutors_result_through(client, stores, checks):
    calls, results = checks
    lesson_id = _start_lesson(client, stores)["lesson_id"]
    verdict = {
        "verdict": "intervene",
        "step": "s2",
        "guardrail": "g1",
        "what_happened": "Coded 7,200 to opex",
        "expected": "Capex 0400",
        "next_step": "",
    }
    results.append(verdict)
    history = [{"t": 1.0, "event": "Opened invoice 4712"}]
    flags = [{"step": "s1", "what_happened": "x"}]
    res = client.post(
        f"/api/v1/lessons/{lesson_id}/check",
        json={"event": "  Sent it to bob@example.com  ", "history": history, "open_flags": flags},
    )
    assert res.status_code == 200
    assert res.json() == verdict
    (call,) = calls
    assert call["event"] == "Sent it to [email]"
    assert call["history"] == history and call["flags"] == flags
    assert call["work_map"]["task"] == "Code a supplier invoice"


def test_check_loads_the_work_map_once_for_a_lesson_it_has_not_seen(client, stores, checks):
    _, results = checks
    stores.maps[SESSION_ID] = copy.deepcopy(WORK_MAP)
    stores.lessons[LESSON_ID] = {"id": LESSON_ID, "work_map_id": SESSION_ID, "attempts": []}
    results.extend([{"verdict": "none"}, {"verdict": "ok"}])
    for _ in range(2):
        res = client.post(f"/api/v1/lessons/{LESSON_ID}/check", json={"event": "Scrolled"})
        assert res.status_code == 200
    assert [c[0] for c in stores.calls] == ["get_lesson", "get"]


def test_check_without_an_event(client, checks):
    calls, _ = checks
    res = client.post(f"/api/v1/lessons/{LESSON_ID}/check", json={"event": "   "})
    assert res.status_code == 400
    assert calls == []


def test_check_for_a_missing_lesson(client, checks):  # noqa: ARG001
    res = client.post(f"/api/v1/lessons/{LESSON_ID}/check", json={"event": "Saved"})
    assert res.status_code == 404
    assert res.json() == {"detail": "Lesson not found"}


def test_check_when_the_tutor_fails(client, stores, checks):
    _, results = checks
    lesson_id = _start_lesson(client, stores)["lesson_id"]
    results.append(RuntimeError("OpenAI is down"))
    res = client.post(f"/api/v1/lessons/{lesson_id}/check", json={"event": "Saved"})
    assert res.status_code == 502
    assert res.json() == {"detail": "Couldn't check the step"}


def test_attempt_is_redacted_and_stored(client, stores):
    lesson_id = _start_lesson(client, stores)["lesson_id"]
    attempt = {
        "type": "prediction",
        "step": "s2",
        "answer": "Ask anna@example.com",
        "correct": False,
    }
    assert client.post(f"/api/v1/lessons/{lesson_id}/attempt", json=attempt).json() == {"ok": True}
    assert stores.lessons[lesson_id]["attempts"] == [{**attempt, "answer": "Ask [email]"}]


def test_attempt_for_a_missing_lesson(client):
    res = client.post(f"/api/v1/lessons/{LESSON_ID}/attempt", json={"type": "done"})
    assert res.status_code == 404


def test_finish_reports_from_the_attempts_and_stores_a_redacted_transcript(client, stores):
    lesson_id = _start_lesson(client, stores)["lesson_id"]
    client.post(f"/api/v1/lessons/{lesson_id}/attempt", json={"type": "done", "step": "s1"})
    client.post(
        f"/api/v1/lessons/{lesson_id}/attempt",
        json={"type": "intervention", "step": "s2", "what_happened": "Opex", "expected": "Capex"},
    )
    transcript = [{"role": "new_hire", "text": "Mail it to anna@example.com?", "t": 3}]
    res = client.post(f"/api/v1/lessons/{lesson_id}/finish", json={"transcript": transcript})
    assert res.status_code == 200
    report = res.json()
    expected = tutor.report(WORK_MAP, stores.lessons[lesson_id]["attempts"])
    assert report == expected
    assert [m["step"] for m in report["mastered"]] == ["s1"]
    assert [p["step"] for p in report["practice"]] == ["s2"]
    stored = stores.lessons[lesson_id]
    assert stored["transcript"] == [{"role": "new_hire", "text": "Mail it to [email]?", "t": 3}]
    assert stored["report"] == expected


def test_finish_without_a_transcript(client, stores):
    lesson_id = _start_lesson(client, stores)["lesson_id"]
    res = client.post(f"/api/v1/lessons/{lesson_id}/finish")
    assert res.status_code == 200
    assert stores.lessons[lesson_id]["transcript"] == []
    assert [n["step"] for n in res.json()["not_covered"]] == ["s1", "s2"]


def test_finish_a_missing_lesson(client):
    res = client.post(f"/api/v1/lessons/{LESSON_ID}/finish", json={})
    assert res.status_code == 404
    assert res.json() == {"detail": "Lesson not found"}


def test_finish_a_lesson_whose_work_map_is_gone(client, stores):
    stores.lessons[LESSON_ID] = {"id": LESSON_ID, "work_map_id": OTHER_ID, "attempts": []}
    res = client.post(f"/api/v1/lessons/{LESSON_ID}/finish", json={})
    assert res.status_code == 404
    assert res.json() == {"detail": "Work Map not found"}


def test_get_a_lesson(client, stores):
    lesson_id = _start_lesson(client, stores)["lesson_id"]
    res = client.get(f"/api/v1/lessons/{lesson_id}")
    assert res.json() == {"id": lesson_id, "work_map_id": SESSION_ID, "attempts": []}


def test_get_a_missing_lesson(client):
    res = client.get(f"/api/v1/lessons/{LESSON_ID}")
    assert res.status_code == 404
    assert res.json() == {"detail": "Lesson not found"}
