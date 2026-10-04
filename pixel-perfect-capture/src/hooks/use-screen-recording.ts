import { useEffect, useRef } from "react";
import { backendFetch } from "@/lib/backend";
import { loadSettings, type Settings } from "@/lib/settings";

/** Frames per second the screen is captured, shielded and recorded at. */
export const CAPTURE_FPS = 15;
/**
 * What each Video quality setting captures and records: the largest size the shared screen is
 * scaled to, and a bitrate that keeps small text sharp at that size.
 */
export const VIDEO_QUALITY: Record<
  Settings["videoQuality"],
  { width: number; height: number; bitsPerSecond: number }
> = {
  "720p": { width: 1280, height: 800, bitsPerSecond: 3_000_000 },
  "1080p": { width: 1920, height: 1200, bitsPerSecond: 6_000_000 },
  native: { width: 3840, height: 2400, bitsPerSecond: 8_000_000 },
};
/** Hand the recorder's data over every few seconds, so a crash loses little. */
const TIMESLICE_MS = 5000;
/** Each segment is kept under this, with room to spare below the 50 MB Storage limit. */
const SEGMENT_BYTES = 36 * 1024 * 1024;
const MAX_SEGMENT_MS = 120_000;

function upload(sessionId: string, start: number, end: number, chunks: Blob[]) {
  if (!chunks.length || end - start < 1) return;
  const body = new Blob(chunks, { type: "video/webm" });
  const query = `start=${start.toFixed(2)}&end=${end.toFixed(2)}`;
  void backendFetch(`/api/v1/sessions/${sessionId}/recordings?${query}`, {
    method: "POST",
    headers: { "Content-Type": "video/webm" },
    body,
  })
    .then((r) => {
      if (!r.ok) throw new Error(`answered ${r.status}`);
      console.log(`[recording] saved ${start.toFixed(0)}s-${end.toFixed(0)}s`);
    })
    .catch((e) => console.warn("[recording] segment not saved", e));
}

const mimeType = () =>
  ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
    typeof MediaRecorder !== "undefined" ? MediaRecorder.isTypeSupported(type) : false,
  );

/**
 * Records the shared screen while the apprentice watches, so each Work Map
 * step can show a few seconds of the expert actually doing it.
 *
 * Recording runs only while `enabled` (watching, not paused, on the record).
 * Each stretch is cut into segments of under a minute or two (shorter at higher quality), each uploaded when
 * it ends with its start and end on the session clock; the backend stores them
 * in Supabase Storage and cuts the clips from them.
 */
export function useScreenRecording(
  stream: MediaStream | null,
  options: { enabled: boolean; session: { id: string; clock: () => number } | null },
) {
  const session = useRef(options.session);
  session.current = options.session;
  const track = stream?.getVideoTracks()[0];
  const recording = Boolean(track && options.enabled && options.session);

  useEffect(() => {
    const current = session.current;
    const type = mimeType();
    if (!recording || !track || !current || !type) return;
    const { bitsPerSecond } = VIDEO_QUALITY[loadSettings().videoQuality];
    // A new segment as often as the bitrate needs to stay under the Storage limit.
    const segmentMs = Math.min(MAX_SEGMENT_MS, ((SEGMENT_BYTES * 8) / bitsPerSecond) * 1000);

    const segment = () => {
      const recorder = new MediaRecorder(new MediaStream([track]), {
        mimeType: type,
        videoBitsPerSecond: bitsPerSecond,
      });
      const chunks: Blob[] = [];
      const start = current.clock();
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => upload(current.id, start, current.clock(), chunks);
      recorder.start(TIMESLICE_MS);
      return recorder;
    };
    let recorder = segment();
    // A fresh segment every so often keeps each upload under Storage's file limit.
    const rotate = window.setInterval(() => {
      if (recorder.state !== "inactive") recorder.stop();
      if (track.readyState === "live") recorder = segment();
    }, segmentMs);
    return () => {
      clearInterval(rotate);
      // Stopping (also when the track ends) flushes the last data, then onstop uploads.
      if (recorder.state !== "inactive") recorder.stop();
    };
  }, [recording, track]);
}
