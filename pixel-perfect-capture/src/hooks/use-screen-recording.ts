import { useEffect, useRef } from "react";
import { backendFetch } from "@/lib/backend";

/** Enough for text on a shared screen to stay readable at 10 fps. */
const BITS_PER_SECOND = 1_500_000;
/** Hand the recorder's data over every few seconds, so a crash loses little. */
const TIMESLICE_MS = 5000;
/** Start a new segment this often: about 22 MB each, under the 50 MB Storage limit. */
const SEGMENT_MS = 120_000;

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
 * Each stretch is cut into segments of at most two minutes, each uploaded when
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

    const segment = () => {
      const recorder = new MediaRecorder(new MediaStream([track]), {
        mimeType: type,
        videoBitsPerSecond: BITS_PER_SECOND,
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
    // A fresh segment every couple of minutes keeps each upload under Storage's file limit.
    const rotate = window.setInterval(() => {
      if (recorder.state !== "inactive") recorder.stop();
      if (track.readyState === "live") recorder = segment();
    }, SEGMENT_MS);
    return () => {
      clearInterval(rotate);
      // Stopping (also when the track ends) flushes the last data, then onstop uploads.
      if (recorder.state !== "inactive") recorder.stop();
    };
  }, [recording, track]);
}
