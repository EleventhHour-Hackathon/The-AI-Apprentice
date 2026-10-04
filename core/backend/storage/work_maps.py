"""Work Maps and their screen moments in Supabase Postgres (see migrations/).

A session's row is created when it starts (status 'recording'), collects
screen events and live captures while the expert works, gets a merged draft
at the start of the debrief ('draft') and the final map once the expert
confirms the teach-back ('confirmed').

The backend talks to the database directly with SUPABASE_DB_URL, so the
tables stay closed to the public Data API.
"""

from typing import Any, Dict, List, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.core.config import Config
from src.utils.logger import logger

_JSON_FIELDS = ("steps", "guardrails", "open_questions", "corrections", "transcript")


class WorkMapStoreError(Exception):
    pass


def _connect() -> psycopg.Connection:
    if not Config.SUPABASE_DB_URL:
        raise WorkMapStoreError("SUPABASE_DB_URL is not set")
    try:
        # prepare_threshold=None: the Supabase pooler does not keep prepared statements.
        return psycopg.connect(
            Config.SUPABASE_DB_URL, connect_timeout=10, row_factory=dict_row, prepare_threshold=None
        )
    except psycopg.Error as e:
        raise WorkMapStoreError(f"Couldn't connect to Supabase: {e}") from e


def _row(row: Dict[str, Any]) -> Dict[str, Any]:
    row["id"] = str(row["id"])
    if row.get("recorded_at") is not None:
        row["recorded_at"] = row["recorded_at"].isoformat()
    return row


def start_session(session_id: str, conversation_id: Optional[str]) -> None:
    with _connect() as conn:
        conn.execute(
            """
            insert into work_maps (id, conversation_id, status) values (%s, %s, 'recording')
            on conflict (id) do update set conversation_id = excluded.conversation_id
            """,
            (session_id, conversation_id),
        )


def set_task(session_id: str, task: str) -> None:
    with _connect() as conn:
        conn.execute("update work_maps set task = %s where id = %s", (task, session_id))


def add_capture(session_id: str, capture: Dict[str, Any]) -> bool:
    """Append something the agent recorded live. False if the session doesn't exist."""
    with _connect() as conn:
        return (
            conn.execute(
                "update work_maps set captures = captures || %s where id = %s",
                (Jsonb([capture]), session_id),
            ).rowcount
            > 0
        )


def defer_live_question(session_id: str, t: float) -> bool:
    """Mark the live question asked at t as put off for the debrief. False if there is none."""
    with _connect() as conn:
        row = conn.execute("select captures from work_maps where id = %s for update", (session_id,)).fetchone()
        if row is None:
            return False
        captures = row["captures"] or []
        found = False
        for capture in captures:
            if capture.get("kind") == "live_question" and abs((capture.get("t") or 0) - t) < 0.01:
                capture["deferred"] = found = True
        if found:
            conn.execute("update work_maps set captures = %s where id = %s", (Jsonb(captures), session_id))
        return found


def add_screen_event(session_id: str, event: Dict[str, Any]) -> None:
    with _connect() as conn:
        conn.execute(
            """
            insert into screen_events (session_id, t, event, description, kind, thumb)
            values (%(session_id)s, %(t)s, %(event)s, %(description)s, %(kind)s, %(thumb)s)
            """,
            {"session_id": session_id, **event},
        )


def screen_events(session_id: str, with_thumbs: bool = False) -> List[Dict[str, Any]]:
    columns = "t, event, description, kind" + (", thumb" if with_thumbs else "")
    with _connect() as conn:
        return conn.execute(
            f"select {columns} from screen_events where session_id = %s order by t",
            (session_id,),
        ).fetchall()


_has_confirmation: Optional[bool] = None


def _confirmation_column(conn: psycopg.Connection) -> bool:
    """Whether migration 005 (work_maps.confirmation) is applied; checked once per process."""
    global _has_confirmation
    if _has_confirmation is None:
        try:
            found = conn.execute(
                "select 1 from information_schema.columns where table_schema = 'public'"
                " and table_name = 'work_maps' and column_name = 'confirmation'"
            ).fetchone()
        except psycopg.Error as e:
            # Not cached: try again on the next save.
            conn.rollback()
            logger.warning(f"Couldn't check for migration 005, saving without confirmation: {e}")
            return False
        _has_confirmation = found is not None
        if not _has_confirmation:
            logger.info("Migration 005 isn't applied: Work Maps are saved without the confirmation")
    return _has_confirmation


def save_map(session_id: str, work_map: Dict[str, Any], status: str) -> None:
    """Store a merged Work Map (draft or confirmed) over the session's row."""
    with _connect() as conn:
        # Kept when a later save (an edit in the review) doesn't carry it.
        confirmation = (
            ", confirmation = coalesce(%(confirmation)s, confirmation)"
            if _confirmation_column(conn)
            else ""
        )
        confirmed = work_map.get("confirmation")
        conn.execute(
            f"""
            update work_maps set
                task = coalesce(%(task)s, task), status = %(status)s, confirmed = %(confirmed)s,
                duration = %(duration)s, steps = %(steps)s, guardrails = %(guardrails)s,
                open_questions = %(open_questions)s, corrections = %(corrections)s,
                transcript = %(transcript)s{confirmation}
            where id = %(id)s
            """,
            {
                "id": session_id,
                "task": work_map.get("task"),
                "status": status,
                "confirmed": status == "confirmed",
                "duration": work_map.get("duration"),
                **{field: Jsonb(work_map.get(field) or []) for field in _JSON_FIELDS},
                "confirmation": Jsonb(confirmed) if confirmed else None,
            },
        )


def list_summaries() -> List[Dict[str, Any]]:
    """Every Work Map, newest first, with counts instead of contents.

    Sessions still recording, or abandoned before anything was merged, are not Work Maps yet.
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            select id, task, recorded_at, confirmed, status,
                   jsonb_array_length(steps) as steps,
                   jsonb_array_length(guardrails) as guardrails,
                   jsonb_array_length(open_questions) as open_questions
            from work_maps where status <> 'recording' order by recorded_at desc
            """
        ).fetchall()
    return [_row(r) for r in rows]


def confirmed_maps(limit: int = 50) -> List[Dict[str, Any]]:
    """Every Work Map the expert confirmed, newest first: what the apprentice knows.

    Without transcripts or captures, so the whole of a small workspace's memory
    can be held at once (see src/services/brain.py).
    """
    with _connect() as conn:
        rows = conn.execute(
            """
            select id, task, recorded_at, steps, guardrails, open_questions
            from work_maps where status = 'confirmed' order by recorded_at desc limit %s
            """,
            (limit,),
        ).fetchall()
    return [_row(r) for r in rows]


def expired_unconfirmed(days: int) -> List[str]:
    """Sessions never confirmed by the expert and recorded more than `days` days ago."""
    with _connect() as conn:
        rows = conn.execute(
            "select id from work_maps where not confirmed and recorded_at < now() - make_interval(days => %s)",
            (days,),
        ).fetchall()
    return [str(r["id"]) for r in rows]


def get(work_map_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("select * from work_maps where id = %s", (work_map_id,)).fetchone()
    return _row(row) if row else None


def delete(work_map_id: str) -> bool:
    """Delete a Work Map and its screen moments. Returns False if there was none with that id."""
    with _connect() as conn:
        return conn.execute("delete from work_maps where id = %s", (work_map_id,)).rowcount > 0
