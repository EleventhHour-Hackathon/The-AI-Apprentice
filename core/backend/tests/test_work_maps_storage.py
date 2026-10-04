"""save_map writes the teach-back confirmation only once migration 005 is applied (no database)."""

import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
for key, value in {
    "OPENAI_API_KEY": "x",
    "ELEVENLABS_API_KEY": "x",
    "SUPABASE_DB_URL": "postgresql://x@localhost/x",
}.items():
    os.environ.setdefault(key, value)

import psycopg  # noqa: E402
import pytest  # noqa: E402

from storage import work_maps  # noqa: E402

CONFIRMATION = {"teach_back": "You check the amount first.", "said": "Yes, that's it.", "t": 312.4}


class FakeConnection:
    def __init__(self, has_column: bool, check_fails: bool = False):
        self.has_column = has_column
        self.check_fails = check_fails
        self.queries = []
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        if self.check_fails and "information_schema" in sql:
            raise psycopg.errors.InsufficientPrivilege("permission denied")
        self.queries.append((sql, params))
        return self

    def rollback(self):
        self.rolled_back = True

    def fetchone(self):
        return {"?column?": 1} if self.has_column else None


@pytest.fixture
def connect(monkeypatch):
    def make(has_column: bool, check_fails: bool = False) -> FakeConnection:
        conn = FakeConnection(has_column, check_fails)
        monkeypatch.setattr(work_maps, "_connect", lambda: conn)
        monkeypatch.setattr(work_maps, "_has_confirmation", None)
        return conn

    return make


def _update(conn: FakeConnection):
    return next((sql, params) for sql, params in conn.queries if "update work_maps" in sql)


def test_saves_the_confirmation_when_the_column_exists(connect):
    conn = connect(True)
    work_maps.save_map("id", {"task": "Invoices", "confirmation": CONFIRMATION}, "confirmed")
    sql, params = _update(conn)
    assert "confirmation = coalesce(%(confirmation)s, confirmation)" in sql
    assert params["confirmation"].obj == CONFIRMATION


def test_keeps_a_saved_confirmation_when_the_map_has_none(connect):
    conn = connect(True)
    work_maps.save_map("id", {"task": "Invoices"}, "confirmed")
    _, params = _update(conn)
    assert params["confirmation"] is None


def test_saves_as_before_without_migration_005(connect):
    conn = connect(False)
    work_maps.save_map("id", {"task": "Invoices", "confirmation": CONFIRMATION}, "confirmed")
    sql, _ = _update(conn)
    assert "confirmation" not in sql
    assert params_ok(conn)


def test_checks_for_the_column_once(connect):
    conn = connect(True)
    work_maps.save_map("id", {}, "draft")
    work_maps.save_map("id", {}, "draft")
    assert sum("information_schema" in sql for sql, _ in conn.queries) == 1


def params_ok(conn: FakeConnection) -> bool:
    """The steps and the rest are still written."""
    _, params = _update(conn)
    return all(field in params for field in work_maps._JSON_FIELDS)


def test_saves_without_confirmation_when_the_check_fails(connect):
    conn = connect(True, check_fails=True)
    work_maps.save_map("id", {"task": "Invoices", "confirmation": CONFIRMATION}, "confirmed")
    sql, _ = _update(conn)
    assert "confirmation" not in sql
    assert conn.rolled_back
    assert work_maps._has_confirmation is None  # not cached: checked again next time
