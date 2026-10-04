"""Screen recordings of a work session, and the short clips the Work Map shows.

The pill records the shared screen while the apprentice watches, in segments:
a new one starts every minute or so and whenever the expert comes back on
the record or resumes, so nothing off the record is ever kept. Each segment is
uploaded when it ends; its start and end are on the session clock, the same
clock as screen events and Work Map moments.

A clip shows one subtask whole: from just before the expert began it to just
after its result appeared on screen (clip_window), cut on first request.

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

# Screen events are noticed just after the action that caused them, so a clip starts a little
# before the subtask's first event and runs on a little after its last, to show the result.
LEAD_S = 2.0
TAIL_S = 1.5
# Without a span (guardrails on their own, older maps) a clip shows the lead-up to the moment.
CONTEXT_S = 4.0
# Long enough to follow, short enough to watch in passing: a second of video says nothing.
MIN_CLIP_S = 6.0
MAX_CLIP_S = 15.0
# The Storage bucket's per-file limit (migrations/004).
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

# Sharp enough to read small text when the clip is enlarged; matches the recording's frame rate.
MAX_CLIP_WIDTH = 2560
CLIP_FPS = 15

FFMPEG = os.getenv("FFMPEG", shutil.which("ffmpeg") or "ffmpeg")
FFPROBE = os.getenv("FFPROBE", shutil.which("ffprobe") or "ffprobe")
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


def _num(value: Any) -> Optional[float]:
    return float(value) if isinstance(value, (int, float)) else None


def clip_window(
    at: float,
    start: Optional[float] = None,
    end: Optional[float] = None,
    floor: Optional[float] = None,
    ceiling: Optional[float] = None,
) -> Tuple[float, float]:
    """The stretch of the session clock that shows one subtask whole, on the session clock.

    at is the decisive moment, start and end the first and last screen events of the subtask,
    floor the end of the subtask before it and ceiling the start of the one after, so a clip
    never shows the neighbouring steps. Always between MIN_CLIP_S and MAX_CLIP_S long.
    """
    first = min(start if start is not None else at - CONTEXT_S, at)
    last = max(end if end is not None else at, at)
    begin, stop = first - LEAD_S, last + TAIL_S
    if floor is not None and floor < first:
        begin = max(begin, floor)
    if ceiling is not None and ceiling > last:
        stop = max(min(stop, ceiling - 0.5), at + 0.5)
    if stop - begin > MAX_CLIP_S:
        # Too long to show whole: keep the result if the decisive moment still fits with its
        # lead-up; else show the subtask from its start, running on past the decisive moment.
        if stop - MAX_CLIP_S <= at - LEAD_S:
            begin = stop - MAX_CLIP_S
        else:
            stop = min(stop, max(begin + MAX_CLIP_S, at + TAIL_S + 2.0))
            begin = stop - MAX_CLIP_S
    if stop - begin < MIN_CLIP_S:
        pad = (MIN_CLIP_S - (stop - begin)) / 2
        begin, stop = begin - pad, stop + pad
    if begin < 0:
        # At the very start of the session: run on further instead.
        begin, stop = 0.0, stop - begin
    return round(begin, 2), round(stop, 2)


def item_windows(work_map: Dict[str, Any]) -> Dict[int, Tuple[float, float]]:
    """The clip window of every step and guardrail, by id() of the item.

    A step runs from its start to its end event, bounded by the steps either side; a guardrail
    tied to a step shows that step around the guardrail's own moment.
    """
    steps = [s for s in work_map.get("steps") or [] if isinstance(s, dict) and _num(s.get("at")) is not None]
    steps.sort(key=lambda s: s["at"])
    spans: Dict[str, Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]] = {}
    windows: Dict[int, Tuple[float, float]] = {}
    for i, step in enumerate(steps):
        before = steps[i - 1] if i else None
        after = steps[i + 1] if i + 1 < len(steps) else None
        span = (
            _num(step.get("start")),
            _num(step.get("end")),
            (_num(before.get("end")) or before["at"]) if before else None,
            (_num(after.get("start")) or after["at"]) if after else None,
        )
        spans[str(step.get("id"))] = span
        windows[id(step)] = clip_window(step["at"], *span)
    for guard in work_map.get("guardrails") or []:
        at = _num(guard.get("at")) if isinstance(guard, dict) else None
        if at is None:
            continue
        start, end, floor, ceiling = spans.get(str(guard.get("step")), (None, None, None, None))
        windows[id(guard)] = clip_window(at, start, end, floor, ceiling)
    return windows


Piece = Tuple[Dict[str, Any], float, float]


def covering(
    segments: List[Dict[str, Any]], at: Optional[float], begin: float, stop: float
) -> Optional[List[Piece]]:
    """The recording that shows a moment: (segment, offset into it, length) pieces, in order.

    The window is read off the recorded footage, joined end to end across segments (a new one
    starts every minute or so and on every resume). Where that leaves less than MIN_CLIP_S (a
    boundary, a pause, a moment off the recording), the clip takes in the recorded footage
    nearest to the moment until it is MIN_CLIP_S long. Every moment of a recorded session has
    a clip; None only when nothing was recorded.
    """
    if not isinstance(at, (int, float)):
        return None
    footage = sorted(
        (s for s in segments if s["end_t"] > s["start_t"]), key=lambda s: s["start_t"]
    )
    if not footage:
        return None

    # Recorded time: seconds of footage before a point on the session clock.
    def recorded(t: float) -> float:
        return sum(max(0.0, min(s["end_t"], t) - s["start_t"]) for s in footage)

    total = recorded(float("inf"))
    first, last = recorded(begin), recorded(stop)
    if last - first < MIN_CLIP_S:
        point = recorded(at)
        first, last = min(first, point), max(last, point)
        # Grow evenly around it, then back inside the footage at either end.
        pad = max(0.0, MIN_CLIP_S - (last - first)) / 2
        first, last = first - pad, last + pad
        if first < 0:
            first, last = 0.0, last - first
        if last > total:
            first, last = max(0.0, first - (last - total)), total
    pieces: List[Piece] = []
    passed = 0.0
    for segment in footage:
        length = segment["end_t"] - segment["start_t"]
        lo, hi = max(first, passed), min(last, passed + length)
        if hi - lo > 0.05:
            pieces.append((segment, lo - passed, hi - lo))
        passed += length
    return pieces or None


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


def _clip_path(session_id: str, at: float, begin: float, stop: float) -> str:
    return f"clips/{session_id}/{at:.2f}_{begin:.2f}-{stop:.2f}.mp4"


async def clip(session_id: str, at: float, begin: float, stop: float) -> Tuple[str, str]:
    """The subtask around a moment: a signed URL to the stored mp4, or the cached file."""
    at, begin, stop = round(at, 2), round(begin, 2), round(stop, 2)
    if not begin <= at <= stop or stop - begin > MAX_CLIP_S + 0.01:
        raise RecordingError("Clip window is out of range")
    existing = await asyncio.to_thread(media.get_clip, session_id, at)
    # A clip cut for another window (an older map, or before the step's span was known) is recut.
    if existing and existing["object_path"] != _clip_path(session_id, at, begin, stop):
        await asyncio.to_thread(_drop, existing["object_path"])
        existing = None
    if existing:
        try:
            return await asyncio.to_thread(_served, existing)
        except (RecordingError, media.StorageError) as e:
            logger.warning(f"[recordings] recutting clip at {at} for {session_id}: {e}")
    # Several cards can ask for the same clip at once; cut it only once.
    key = _clip_path(session_id, at, begin, stop)
    if key not in _cutting:
        _cutting[key] = asyncio.ensure_future(_make_clip(session_id, at, begin, stop))
    try:
        await _cutting[key]
    finally:
        _cutting.pop(key, None)
    made = await asyncio.to_thread(media.get_clip, session_id, at)
    if not made:
        raise RecordingError("Clip was not stored")
    return await asyncio.to_thread(_served, made)


def _drop(path: str) -> None:
    """Remove a superseded clip file; its row is overwritten by the new cut."""
    _local(path).unlink(missing_ok=True)
    if media.configured():
        try:
            media.remove([path])
        except media.StorageError as e:
            logger.warning(f"[recordings] old clip {path} left in Storage: {e}")


async def _make_clip(session_id: str, at: float, begin: float, stop: float) -> None:
    segments = await asyncio.to_thread(media.recordings, session_id)
    pieces = covering(segments, at, begin, stop)
    if not pieces:
        raise RecordingError("This session has no recording")
    sources = [
        (await asyncio.to_thread(_ensure_local, segment["object_path"]), offset, length)
        for segment, offset, length in pieces
    ]
    path = _clip_path(session_id, at, begin, stop)
    await _cut(sources, _local(path))
    await asyncio.to_thread(media.add_clip, session_id, at, path)
    await asyncio.to_thread(_push, path, "video/mp4")


async def _size(source: pathlib.Path) -> Tuple[int, int]:
    """Width and height of a recording's video."""
    process = await asyncio.create_subprocess_exec(
        FFPROBE, "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(source),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await process.communicate()
    try:
        width, height = (int(n) for n in out.decode().strip().split("x")[:2])
    except ValueError as e:
        raise RecordingError(f"Can't read the size of {source.name}") from e
    return width, height


async def _cut(sources: List[Tuple[pathlib.Path, float, float]], out: pathlib.Path) -> None:
    """Cut (file, offset, length) pieces and join them into one mp4 at the recording's size."""
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_suffix(".part.mp4")
    width, height = await _size(sources[0][0])
    scale = min(1.0, MAX_CLIP_WIDTH / width)
    width, height = int(width * scale) // 2 * 2, int(height * scale) // 2 * 2
    inputs: List[str] = []
    filters: List[str] = []
    for i, (source, offset, length) in enumerate(sources):
        inputs += ["-ss", f"{offset:.2f}", "-t", f"{length:.2f}", "-i", str(source)]
        # Every piece at one size (a shared window can be resized between segments), and held
        # on its last frame for its full length: the screen sends frames only when it changes,
        # and a segment's video can end a little before its clock does.
        filters.append(
            f"[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={CLIP_FPS},"
            f"tpad=stop=-1:stop_mode=clone,trim=duration={length:.2f},setpts=PTS-STARTPTS[v{i}]"
        )
    joined = "".join(f"[v{i}]" for i in range(len(sources)))
    filters.append(f"{joined}concat=n={len(sources)}:v=1:a=0,tpad=stop=-1:stop_mode=clone[out]")
    total = max(sum(length for _, _, length in sources), MIN_CLIP_S)
    process = await asyncio.create_subprocess_exec(
        FFMPEG, "-y", "-loglevel", "error", *inputs,
        "-filter_complex", ";".join(filters), "-map", "[out]", "-t", f"{total:.2f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(partial),
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
    elsewhere: List[str] = []
    for row in media.pending():
        path = row["object_path"]
        if not _local(path).exists():
            elsewhere.append(path)
            continue
        pushed += _push(path, row["content_type"])
    if elsewhere:
        # Saved by a backend that couldn't reach Storage (often a local one sharing the database):
        # only that machine can upload them, by running push_pending there.
        logger.warning(
            f"[recordings] {len(elsewhere)} recordings and clips are waiting on another machine's "
            f"disk, e.g. {elsewhere[0]}"
        )
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
