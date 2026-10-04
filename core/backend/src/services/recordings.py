"""Screen recordings of a work session, and the short clips the Work Map shows.

The pill records the shared screen while the apprentice watches, in segments:
a new one starts every couple of minutes and whenever the expert comes back on
the record or resumes, so nothing off the record is ever kept. Each segment is
uploaded when it ends; its start and end are on the session clock, the same
clock as screen events and Work Map moments.

A clip is cut on first request, a few seconds either side of a moment.

What exists is recorded in Postgres and the video is kept in Supabase Storage
(storage/media.py). The backend's disk is only a cache, laid out like the
bucket, plus a holding place for uploads that have not gone through yet.
"""

import asyncio
import os
import pathlib
import shutil
import time
from typing import Any, Dict, List, Optional, Tuple

from src.core.config import Config
from src.utils.logger import logger
from storage import media

CACHE = pathlib.Path(Config.UPLOAD_DIR) / "media"
# Uploaded files stay cached this long, so clips can be cut without downloading again.
CACHE_SECONDS = 24 * 3600

# Most of the clip leads up to the moment: the screen event is noticed just after the action.
BEFORE_S = 5.0
AFTER_S = 2.0
# A clip shorter than this is not worth showing over the still.
MIN_CLIP_S = 1.5
# The Storage bucket's per-file limit (migrations/004).
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

FFMPEG = os.getenv("FFMPEG", shutil.which("ffmpeg") or "ffmpeg")
_cutting: Dict[str, "asyncio.Future[Any]"] = {}


class RecordingError(Exception):
    pass


def _local(path: str) -> pathlib.Path:
    return CACHE / path


def _push(path: str, content_type: str) -> bool:
    """Upload a cached file to Storage and mark its row. False if it has to wait."""
    if not media.configured():
        return False
    try:
        media.put(path, _local(path).read_bytes(), content_type)
        media.mark_uploaded(path)
        return True
    except (media.StorageError, OSError) as e:
        logger.warning(f"[recordings] {path} kept on disk for now: {e}")
        return False


def save_segment(session_id: str, start: float, end: float, data: bytes) -> None:
    if not data:
        raise RecordingError("Empty recording")
    if len(data) > MAX_UPLOAD_BYTES:
        raise RecordingError("Recording segment is over 50 MB")
    if not 0 <= start < end:
        raise RecordingError("Recording times are out of order")
    path = f"recordings/{session_id}/{start:.2f}-{end:.2f}.webm"
    local = _local(path)
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_bytes(data)
    try:
        media.add_recording(session_id, start, end, path, len(data))
    except Exception as e:
        # The session is gone (deleted as empty) or the database is down: keep nothing half-known.
        local.unlink(missing_ok=True)
        raise RecordingError(f"Recording not stored: {e}") from e
    _push(path, "video/webm")
    _prune_cache()


def covering(segments: List[Dict[str, Any]], at: Optional[float]) -> Optional[Tuple[Dict[str, Any], float, float]]:
    """The segment that shows a moment, where in it the clip starts, and how long it runs."""
    if not isinstance(at, (int, float)):
        return None
    for segment in segments:
        start, end = segment["start_t"], segment["end_t"]
        if start <= at <= end:
            begin = max(start, at - BEFORE_S)
            length = min(end, at + AFTER_S) - begin
            if length >= MIN_CLIP_S:
                return segment, begin - start, length
    return None


def _ensure_local(path: str) -> pathlib.Path:
    local = _local(path)
    if not local.exists():
        if not media.configured():
            raise RecordingError(f"{path} is not on this backend and Storage is not configured")
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(media.get(path))
    return local


def _served(clip: Dict[str, Any]) -> Tuple[str, str]:
    """("url", signed Storage URL) once uploaded, else ("file", cached path)."""
    path = clip["object_path"]
    if clip.get("uploaded") and media.configured():
        return "url", media.signed_url(path)
    if not _local(path).exists():
        raise RecordingError("Clip file is missing")
    return "file", str(_local(path))


async def clip(session_id: str, at: float) -> Tuple[str, str]:
    """A few seconds around a moment: a signed URL to the stored mp4, or the cached file."""
    at = round(at, 2)
    existing = await asyncio.to_thread(media.get_clip, session_id, at)
    if existing:
        try:
            return await asyncio.to_thread(_served, existing)
        except (RecordingError, media.StorageError) as e:
            logger.warning(f"[recordings] recutting clip at {at} for {session_id}: {e}")
    # Several cards can ask for the same clip at once; cut it only once.
    key = f"{session_id}/{at:.2f}"
    if key not in _cutting:
        _cutting[key] = asyncio.ensure_future(_make_clip(session_id, at))
    try:
        await _cutting[key]
    finally:
        _cutting.pop(key, None)
    made = await asyncio.to_thread(media.get_clip, session_id, at)
    if not made:
        raise RecordingError("Clip was not stored")
    return await asyncio.to_thread(_served, made)


async def _make_clip(session_id: str, at: float) -> None:
    segments = await asyncio.to_thread(media.recordings, session_id)
    found = covering(segments, at)
    if found is None:
        raise RecordingError("No recording covers this moment")
    segment, offset, length = found
    source = await asyncio.to_thread(_ensure_local, segment["object_path"])
    path = f"clips/{session_id}/{at:.2f}.mp4"
    await _cut(source, offset, length, _local(path))
    await asyncio.to_thread(media.add_clip, session_id, at, path)
    await asyncio.to_thread(_push, path, "video/mp4")


async def _cut(source: pathlib.Path, offset: float, length: float, out: pathlib.Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_suffix(".part.mp4")
    process = await asyncio.create_subprocess_exec(
        FFMPEG, "-y", "-loglevel", "error",
        "-ss", f"{offset:.2f}", "-i", str(source), "-t", f"{length:.2f}",
        "-an", "-vf", "scale='min(1280,iw)':-2", "-r", "10",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", str(partial),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await process.communicate()
    if process.returncode != 0 or not partial.exists():
        partial.unlink(missing_ok=True)
        raise RecordingError(f"ffmpeg failed: {err.decode()[-400:]}")
    partial.replace(out)


def delete(session_id: str) -> None:
    """Remove a session's video from Storage and disk. Call before deleting its row."""
    paths = media.object_paths(session_id)
    if paths and media.configured():
        media.remove(paths)
    for folder in ("recordings", "clips"):
        shutil.rmtree(CACHE / folder / session_id, ignore_errors=True)


def push_pending() -> int:
    """Upload whatever is still only on disk. Returns how many went up."""
    if not media.configured():
        return 0
    pushed = 0
    for row in media.pending():
        path = row["object_path"]
        if not _local(path).exists():
            logger.warning(f"[recordings] {path} is in the database but on no disk")
            continue
        pushed += _push(path, row["content_type"])
    return pushed


def _prune_cache() -> None:
    """Drop cached files older than a day; only uploaded ones, the rest still have to go up."""
    if not media.configured() or not CACHE.exists():
        return
    cutoff = time.time() - CACHE_SECONDS
    waiting = {row["object_path"] for row in media.pending()}
    for file in CACHE.rglob("*.*"):
        path = file.relative_to(CACHE).as_posix()
        if file.stat().st_mtime < cutoff and path not in waiting:
            file.unlink(missing_ok=True)
