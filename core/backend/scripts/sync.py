"""Bring the backend's disk, Supabase Storage and the database in line.

    uv run python scripts/sync.py            # do it
    uv run python scripts/sync.py --dry-run  # only report

1. Import Work Maps still saved as JSON in uploads/work_maps/ (from before the
   database), then remove the files.
2. Upload recordings and clips that only reached the backend's disk.
3. Drop rows whose video is nowhere, and video (in Storage or on disk) that no
   row knows about.
4. Discard sessions that never became a Work Map and were abandoned
   (still 'recording' after --stale-hours), with their screen moments and video.

Safe to run again: each step only acts on what is out of line.
"""

import argparse
import datetime
import json
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.config import Config  # noqa: E402
from src.services import recordings  # noqa: E402
from storage import media  # noqa: E402
from storage import work_maps as work_map_store  # noqa: E402
from storage.work_maps import _connect  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

LEGACY = pathlib.Path(Config.UPLOAD_DIR) / "work_maps"


def import_legacy(dry: bool) -> None:
    files = sorted(LEGACY.glob("*.json")) if LEGACY.is_dir() else []
    for file in files:
        data = json.loads(file.read_text())
        map_id = str(data.get("session_id") or file.stem)
        # The pill's [SCREEN] notes were stored as the expert's words back then; they are not.
        transcript = [
            line for line in data.get("transcript") or []
            if not str(line.get("content") or line.get("text") or "").startswith("[")
        ]
        recorded = datetime.datetime.fromisoformat(data["recorded_at"]).astimezone() if data.get("recorded_at") else None
        print(f"import  {map_id}  {data.get('task')!r}: {len(data.get('steps') or [])} steps")
        if dry:
            continue
        with _connect() as conn:
            conn.execute(
                """
                insert into work_maps (id, task, recorded_at, status, confirmed, steps, guardrails,
                                       open_questions, transcript)
                values (%s, %s, coalesce(%s, now()), 'draft', false, %s, %s, %s, %s)
                on conflict (id) do nothing
                """,
                (
                    map_id, data.get("task"), recorded,
                    Jsonb(data.get("steps") or []), Jsonb(data.get("guardrails") or []),
                    Jsonb(data.get("open_questions") or []), Jsonb(transcript),
                ),
            )
        if work_map_store.get(map_id):
            file.unlink()
    if not files:
        print("import  nothing to import")


def push(dry: bool) -> None:
    waiting = media.pending()
    if not waiting:
        print("upload  nothing waiting")
        return
    if not media.configured():
        print(f"upload  {len(waiting)} waiting, but Storage is not configured (set SUPABASE_SECRET_KEY)")
        return
    if dry:
        for row in waiting:
            print(f"upload  {row['object_path']}")
        return
    print(f"upload  {recordings.push_pending()} of {len(waiting)} uploaded")


def reconcile(dry: bool) -> None:
    known = media.known_paths()
    waiting = {row["object_path"] for row in media.pending()}

    # Rows pointing at video that is neither uploaded nor on this disk.
    dead = [p for p in waiting if not recordings._local(p).exists()]
    for path in dead:
        print(f"forget  {path} (in the database, on no disk, never uploaded)")
    if dead and not dry:
        with _connect() as conn:
            conn.execute("delete from screen_recordings where object_path = any(%s)", (dead,))
            conn.execute("delete from screen_clips where object_path = any(%s)", (dead,))

    # Files on disk that no row knows about.
    cache = recordings.CACHE
    for file in sorted(cache.rglob("*.*")) if cache.exists() else []:
        path = file.relative_to(cache).as_posix()
        if path not in known:
            print(f"delete  disk {path}")
            if not dry:
                file.unlink()

    # Objects in Storage that no row knows about.
    if not media.configured():
        print("storage not configured, skipped checking the bucket")
        return
    stray = []
    for folder in ("recordings", "clips"):
        for session in media.list_objects(folder):
            stray += [p for p in media.list_objects(session) if p not in known]
    for path in stray:
        print(f"delete  storage {path}")
    if stray and not dry:
        media.remove(stray)


def discard_stale(hours: float, dry: bool) -> None:
    with _connect() as conn:
        rows = conn.execute(
            """
            select id, task, recorded_at from work_maps
            where status = 'recording' and recorded_at < now() - make_interval(secs => %s)
            """,
            (hours * 3600,),
        ).fetchall()
    for row in rows:
        session_id = str(row["id"])
        print(f"discard {session_id}  {row['task']!r}  started {row['recorded_at']:%Y-%m-%d %H:%M}")
        if not dry:
            recordings.delete(session_id)
            work_map_store.delete(session_id)
    if not rows:
        print(f"discard no abandoned sessions older than {hours:g}h")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="only report what is out of line")
    parser.add_argument("--stale-hours", type=float, default=12, help="age at which a session that never became a Work Map is abandoned")
    args = parser.parse_args()
    import_legacy(args.dry_run)
    push(args.dry_run)
    reconcile(args.dry_run)
    discard_stale(args.stale_hours, args.dry_run)


if __name__ == "__main__":
    main()
