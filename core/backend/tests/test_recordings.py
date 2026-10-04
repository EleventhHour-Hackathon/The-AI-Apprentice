"""Clip windows (src/services/recordings.py): never so short a clip says nothing."""

import asyncio
import os
import shutil
import subprocess

import pytest

for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from src.services import recordings  # noqa: E402
from src.services.recordings import MIN_CLIP_S, clip_window, covering  # noqa: E402


def _length(window):
    return round(window[1] - window[0], 2)


def test_a_lone_moment_gets_at_least_the_minimum():
    assert _length(clip_window(30.0, 30.0, 30.0)) >= MIN_CLIP_S


def test_neighbours_squeezing_a_step_still_leave_the_minimum():
    begin, stop = clip_window(30.0, 29.8, 30.2, floor=29.5, ceiling=30.6)
    assert stop - begin >= MIN_CLIP_S - 0.01
    assert begin <= 30.0 <= stop


def test_at_the_session_start_the_clip_runs_on_instead():
    begin, stop = clip_window(0.5, 0.2, 0.6)
    assert begin == 0.0
    assert stop - begin >= MIN_CLIP_S - 0.01


def _segment(start, end):
    return {"start_t": start, "end_t": end, "object_path": f"recordings/s/{start}-{end}.webm"}


def _total(pieces):
    return round(sum(length for _, _, length in pieces), 2)


def test_a_window_across_a_segment_boundary_joins_both_segments():
    segments = [_segment(0.0, 40.0), _segment(40.0, 80.0)]
    pieces = covering(segments, 41.0, 35.0, 43.0)
    assert [(p[0]["start_t"], p[1], p[2]) for p in pieces] == [(0.0, 35.0, 5.0), (40.0, 0.0, 3.0)]


def test_a_short_segment_borrows_the_footage_before_it():
    segments = [_segment(0.0, 120.0), _segment(120.0, 121.5)]
    pieces = covering(segments, 121.0, 120.5, 121.5)
    assert _total(pieces) == MIN_CLIP_S
    assert pieces[-1][0]["start_t"] == 120.0


def test_a_moment_in_a_pause_shows_the_footage_around_it():
    segments = [_segment(0.0, 30.0), _segment(60.0, 90.0)]
    pieces = covering(segments, 45.0, 44.0, 46.0)
    assert _total(pieces) == MIN_CLIP_S
    assert [p[0]["start_t"] for p in pieces] == [0.0, 60.0]


def test_a_recording_shorter_than_the_minimum_is_shown_whole():
    pieces = covering([_segment(0.0, 2.0)], 1.0, 0.0, 6.0)
    assert [(p[1], p[2]) for p in pieces] == [(0.0, 2.0)]


def test_only_a_session_without_recording_has_no_clip():
    assert covering([], 10.0, 5.0, 12.0) is None


def test_a_window_inside_one_segment_is_kept():
    pieces = covering([_segment(10.0, 130.0)], 50.0, 44.0, 52.0)
    assert [(p[1], p[2]) for p in pieces] == [(34.0, 8.0)]


def _webm(path, seconds, size="640x400"):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=10",
         "-t", str(seconds), "-c:v", "libvpx", str(path)],
        check=True,
    )
    return path


def _probe(path, entries):
    return subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", entries,
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")


@needs_ffmpeg
def test_a_cut_runs_its_full_length_past_the_end_of_the_video(tmp_path):
    out = tmp_path / "clip.mp4"
    asyncio.run(recordings._cut([(_webm(tmp_path / "short.webm", 1), 0.0, MIN_CLIP_S)], out))
    assert float(_probe(out, "format=duration")) >= MIN_CLIP_S - 0.2


@needs_ffmpeg
def test_pieces_of_different_sizes_join_into_one_clip_at_full_resolution(tmp_path):
    first = _webm(tmp_path / "a.webm", 4, "1920x1200")
    second = _webm(tmp_path / "b.webm", 4, "1280x800")
    out = tmp_path / "clip.mp4"
    asyncio.run(recordings._cut([(first, 1.0, 3.0), (second, 0.0, 4.0)], out))
    assert _probe(out, "stream=width,height") == "1920,1200"
    assert abs(float(_probe(out, "format=duration")) - 7.0) < 0.3
