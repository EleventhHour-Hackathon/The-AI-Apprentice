"""Screen recordings and clips: rows in Postgres, video in Supabase Storage (see migrations/004).

Every recording segment and every clip has a row, tied to its Work Map, so
deleting the map removes them. The video goes to the private
`screen-recordings` bucket; until an upload succeeds (or while no secret key
is configured) the row says `uploaded = false` and the file waits on the
backend's disk, where `scripts/sync.py` and startup pick it up again.
"""

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from src.core.config import Config
from storage.work_maps import _connect

BUCKET = "screen-recordings"
SIGNED_URL_SECONDS = 3600


class StorageError(Exception):
    pass


def _project_url() -> str:
    """The Supabase project URL, from SUPABASE_URL or else the project ref in SUPABASE_DB_URL."""
    if Config.SUPABASE_URL:
        return Config.SUPABASE_URL.rstrip("/")
    db = Config.SUPABASE_DB_URL
    ref = re.search(r"postgres\.([a-z0-9]{20})[:@]", db) or re.search(r"db\.([a-z0-9]{20})\.supabase\.co", db)
    return f"https://{ref[1]}.supabase.co" if ref else ""


def configured() -> bool:
    return bool(Config.SUPABASE_SECRET_KEY and _project_url())


def _request(method: str, path: str, data: Optional[bytes] = None, headers: Optional[Dict[str, str]] = None):
    if not configured():
        raise StorageError("Supabase Storage is not configured (set SUPABASE_SECRET_KEY)")
    key = Config.SUPABASE_SECRET_KEY
    all_headers = {"apikey": key, **(headers or {})}
    if key.startswith("eyJ"):  # legacy service_role JWT; the new sb_secret_ keys go in apikey only
        all_headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(
        f"{_project_url()}/storage/v1{path}", method=method, data=data, headers=all_headers
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as e:
        raise StorageError(f"Storage {method} {path} failed with {e.code}: {e.read()[:300].decode()}") from e
    except urllib.error.URLError as e:
        raise StorageError(f"Storage {method} {path} failed: {e.reason}") from e


def _object(path: str) -> str:
    return f"/object/{BUCKET}/{urllib.parse.quote(path)}"


def put(path: str, data: bytes, content_type: str) -> None:
    _request("POST", _object(path), data, {"Content-Type": content_type, "x-upsert": "true"})


def get(path: str) -> bytes:
    return _request("GET", _object(path))


def signed_url(path: str) -> str:
    body = json.dumps({"expiresIn": SIGNED_URL_SECONDS}).encode()
    signed = json.loads(
        _request("POST", f"/object/sign/{BUCKET}/{urllib.parse.quote(path)}", body, {"Content-Type": "application/json"})
    )
    return f"{_project_url()}/storage/v1{signed['signedURL']}"


def remove(paths: List[str]) -> None:
    for i in range(0, len(paths), 100):
        body = json.dumps({"prefixes": paths[i : i + 100]}).encode()
        _request("DELETE", f"/object/{BUCKET}", body, {"Content-Type": "application/json"})


def list_objects(prefix: str) -> List[str]:
    """Object paths under a folder (one level), for finding files no row knows about."""
    body = json.dumps({"prefix": prefix, "limit": 1000}).encode()
    items = json.loads(_request("POST", f"/object/list/{BUCKET}", body, {"Content-Type": "application/json"}))
    return [f"{prefix.rstrip('/')}/{item['name']}" for item in items]


# Rows


def add_recording(session_id: str, start: float, end: float, path: str, size: int) -> int:
    with _connect() as conn:
        row = conn.execute(
            """
            insert into screen_recordings (session_id, start_t, end_t, object_path, bytes)
            values (%s, %s, %s, %s, %s)
            on conflict (object_path) do update set bytes = excluded.bytes, uploaded = false
            returning id
            """,
            (session_id, start, end, path, size),
        ).fetchone()
    return row["id"]


def recordings(session_id: str) -> List[Dict[str, Any]]:
    with _connect() as conn:
        return conn.execute(
            "select * from screen_recordings where session_id = %s order by start_t", (session_id,)
        ).fetchall()


def get_clip(session_id: str, at: float) -> Optional[Dict[str, Any]]:
    with _connect() as conn:
        return conn.execute(
            "select * from screen_clips where session_id = %s and at = %s", (session_id, at)
        ).fetchone()


def add_clip(session_id: str, at: float, path: str) -> None:
    with _connect() as conn:
        conn.execute(
            """
            insert into screen_clips (session_id, at, object_path) values (%s, %s, %s)
            on conflict (session_id, at) do update set object_path = excluded.object_path, uploaded = false
            """,
            (session_id, at, path),
        )


def mark_uploaded(path: str) -> None:
    with _connect() as conn:
        conn.execute("update screen_recordings set uploaded = true where object_path = %s", (path,))
        conn.execute("update screen_clips set uploaded = true where object_path = %s", (path,))


def pending() -> List[Dict[str, Any]]:
    """Recordings and clips that exist only on the backend's disk so far."""
    with _connect() as conn:
        return conn.execute(
            """
            select object_path, 'video/webm' as content_type from screen_recordings where not uploaded
            union all
            select object_path, 'video/mp4' from screen_clips where not uploaded
            """
        ).fetchall()


def object_paths(session_id: str) -> List[str]:
    """Every stored object of a session, to remove before its rows cascade away."""
    with _connect() as conn:
        rows = conn.execute(
            """
            select object_path from screen_recordings where session_id = %(id)s
            union all
            select object_path from screen_clips where session_id = %(id)s
            """,
            {"id": session_id},
        ).fetchall()
    return [r["object_path"] for r in rows]


def known_paths() -> set:
    with _connect() as conn:
        rows = conn.execute(
            "select object_path from screen_recordings union all select object_path from screen_clips"
        ).fetchall()
    return {r["object_path"] for r in rows}
