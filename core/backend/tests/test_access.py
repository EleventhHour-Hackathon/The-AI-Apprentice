"""The access key (src/core/access.py) as main.app enforces it, and the CORS around it."""

import os

import pytest

# Config checks these at import; nothing real is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from src.core import access  # noqa: E402

KEY = "s3cret-access-key"
# The token route: refused before it would reach ElevenLabs.
PROTECTED = "/api/v1/agent/token"
# Not a real session, so a request that gets past the check ends in 400 or 404, never 401.
CLIP = "/api/v1/sessions/not-a-uuid/clip"


@pytest.fixture
def client(monkeypatch):
    """client(key) gives a TestClient on main.app started with TACIT_ACCESS_KEY = key."""

    def make(key: str | None) -> TestClient:
        if key is None:
            monkeypatch.delenv(access.ENV_VAR, raising=False)
        else:
            monkeypatch.setenv(access.ENV_VAR, key)
        main.app.middleware_stack = None  # the key is read when the stack is built
        # No `with`: the startup tasks (Storage, purge) would reach for the database.
        return TestClient(main.app, raise_server_exceptions=False)

    yield make
    main.app.middleware_stack = None


def test_open_without_the_env_var(client):
    c = client(None)
    assert c.get("/health").json()["access"] == "open"
    assert c.get("/no-such-route").status_code == 404  # reached the router


def test_missing_or_wrong_key_is_refused(client):
    c = client(KEY)
    for headers in ({}, {access.HEADER: "wrong"}, {access.HEADER: ""}):
        r = c.get("/no-such-route", headers=headers)
        assert r.status_code == 401
        assert r.json() == {"detail": "Missing or wrong access key"}
    assert c.get(PROTECTED).status_code == 401


def test_right_key_passes(client):
    c = client(KEY)
    r = c.get("/no-such-route", headers={access.HEADER: KEY})
    assert r.status_code == 404  # past the check, to the router
    assert c.get("/health", headers={access.HEADER: KEY}).status_code == 200


def test_health_needs_no_key_and_reports_the_mode(client):
    r = client(KEY).get("/health")
    assert r.status_code == 200
    assert r.json()["access"] == "key"


def test_preflight_passes_and_allows_the_key_header(client):
    c = client(KEY)
    r = c.options(
        PROTECTED,
        headers={
            "Origin": "app://tacit",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-tacit-key, content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
    allowed = r.headers["access-control-allow-headers"].lower()
    assert "x-tacit-key" in allowed and "content-type" in allowed


def test_refusal_carries_cors_headers(client):
    """The app has to be able to read the 401 to tell the user the key is wrong."""
    r = client(KEY).get("/no-such-route", headers={"Origin": "app://tacit"})
    assert r.status_code == 401
    assert r.headers["access-control-allow-origin"] == "*"


def test_key_comparison_is_exact():
    mw = access.AccessKeyMiddleware(app=None, key=KEY)
    scope = {"type": "http", "method": "GET", "path": "/x"}
    assert mw._allowed({**scope, "headers": [(b"x-tacit-key", KEY.encode())]})
    assert not mw._allowed({**scope, "headers": [(b"x-tacit-key", KEY.upper().encode())]})
    assert not mw._allowed({**scope, "headers": [(b"x-tacit-key", (KEY + " ").encode())]})
    assert not mw._allowed({**scope, "method": "POST", "path": "/health", "headers": []})


def test_clip_takes_the_key_in_the_query(client):
    """<video src> can't send headers, so the clip route reads ?key= too."""
    c = client(KEY)
    assert c.get(CLIP, params={"at": 1, "key": KEY}).status_code != 401
    assert c.get(CLIP, params={"at": 1, "key": "wrong"}).status_code == 401
    assert c.get(CLIP, params={"at": 1}).status_code == 401


def test_query_key_works_nowhere_else(client):
    c = client(KEY)
    for path in (PROTECTED, "/no-such-route", CLIP + "/extra", "/api/v1/sessions/a/b/clip"):
        assert c.get(path, params={"key": KEY}).status_code == 401
    assert c.post(CLIP, params={"at": 1, "key": KEY}).status_code == 401
