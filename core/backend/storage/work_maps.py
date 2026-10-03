"""Work Maps in Supabase Postgres (table created by migrations/001_work_maps.sql).

The backend talks to the database directly with SUPABASE_DB_URL, so the
table stays closed to the public Data API.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from src.core.config import Config

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


def _recorded_at(value: Any) -> datetime:
    """Sessions record local time without an offset; pin it to this machine's timezone."""
    when = datetime.fromisoformat(value) if isinstance(value, str) else value or datetime.now()
    return when if when.tzinfo else when.astimezone()


def save(work_map: Dict[str, Any]) -> None:
    """Insert or replace the Work Map for a session."""
    values = {field: Jsonb(work_map.get(field) or []) for field in _JSON_FIELDS}
    with _connect() as conn:
        conn.execute(
            """
            insert into work_maps (id, task, recorded_at, confirmed, steps, guardrails,
                                   open_questions, corrections, transcript)
            values (%(id)s, %(task)s, %(recorded_at)s, %(confirmed)s, %(steps)s, %(guardrails)s,
                    %(open_questions)s, %(corrections)s, %(transcript)s)
            on conflict (id) do update set
                task = excluded.task, recorded_at = excluded.recorded_at,
                confirmed = excluded.confirmed, steps = excluded.steps,
                guardrails = excluded.guardrails, open_questions = excluded.open_questions,
                corrections = excluded.corrections, transcript = excluded.transcript
            """,
            {
                "id": work_map["session_id"],
                "task": work_map.get("task"),
                "recorded_at": _recorded_at(work_map.get("recorded_at")),
                "confirmed": bool(work_map.get("confirmed")),
                **values,
            },
        )


def list_summaries() -> List[Dict[str, Any]]:
    """Every Work Map, newest first, with counts instead of contents."""
    with _connect() as conn:
        rows = conn.execute(
            """
            select id, task, recorded_at, confirmed,
                   jsonb_array_length(steps) as steps,
                   jsonb_array_length(guardrails) as guardrails,
                   jsonb_array_length(open_questions) as open_questions
            from work_maps order by recorded_at desc
            """
        ).fetchall()
    return [_row(r) for r in rows]


def get(work_map_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("select * from work_maps where id = %s", (work_map_id,)).fetchone()
    return _row(row) if row else None


def delete(work_map_id: str) -> bool:
    """Delete a Work Map. Returns False if there was none with that id."""
    with _connect() as conn:
        return conn.execute("delete from work_maps where id = %s", (work_map_id,)).rowcount > 0
