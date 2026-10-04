"""Lessons: a new hire working a case with the tutor (see migrations/003_lessons.sql)."""

from typing import Any, Dict, List, Optional

from psycopg.types.json import Jsonb

from storage.work_maps import _connect


def create(lesson_id: str, work_map_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "insert into lessons (id, work_map_id) values (%s, %s) on conflict (id) do nothing",
            (lesson_id, work_map_id),
        )


def set_conversation(lesson_id: str, conversation_id: str) -> None:
    with _connect() as conn:
        conn.execute("update lessons set conversation_id = %s where id = %s", (conversation_id, lesson_id))


def add_attempt(lesson_id: str, attempt: Dict[str, Any]) -> bool:
    with _connect() as conn:
        return (
            conn.execute(
                "update lessons set attempts = attempts || %s where id = %s",
                (Jsonb([attempt]), lesson_id),
            ).rowcount
            > 0
        )


def finish(lesson_id: str, transcript: List[Dict[str, Any]], report: Dict[str, Any]) -> None:
    with _connect() as conn:
        conn.execute(
            "update lessons set status = 'finished', transcript = %s, report = %s where id = %s",
            (Jsonb(transcript), Jsonb(report), lesson_id),
        )


def get(lesson_id: str) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        row = conn.execute("select * from lessons where id = %s", (lesson_id,)).fetchone()
    if row:
        row["id"], row["work_map_id"] = str(row["id"]), str(row["work_map_id"])
        row["started_at"] = row["started_at"].isoformat()
    return row
