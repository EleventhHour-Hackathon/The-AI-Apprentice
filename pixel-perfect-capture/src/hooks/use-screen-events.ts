import { useCallback, useEffect, useRef } from "react";
import { backendFetch } from "@/lib/backend";
import type { ScreenKind } from "@/lib/floor";

/** How often we look at the screen with the vision model. */
const SAMPLE_INTERVAL_MS = 1500;
/** How often we check, locally, whether anything on screen is moving. */
const ACTIVITY_INTERVAL_MS = 250;
/** Width we downscale frames to before sending them to the vision model. */
const FRAME_WIDTH = 1024;
/** Width of the stills kept as screen moments: sharp enough to read when shown large. */
const THUMB_WIDTH = 1280;
const THUMB_QUALITY = 0.85;
/** Size of the thumbnail used for the cheap "did anything move?" checks. */
const DIFF_SIZE = 64;
/**
 * Mean per-pixel difference (0-255) below which two frames count as the same
 * screen and the vision call is skipped. A blinking caret does not clear it.
 */
const DIFF_THRESHOLD = 2.0;
/**
 * For activity: how many of the 64x64 pixels must change, and by how much.
 * A few typed characters or a cursor moving clears this; caret blink and
 * video compression noise do not.
 */
const ACTIVITY_PIXELS = 3;
const ACTIVITY_DELTA = 28;

export type ScreenEvent = {
  event: string;
  kind: ScreenKind;
  /** Date.now() when the frame was grabbed, before the vision call. */
  capturedAt?: number;
};
type VisionResult = {
  description: string;
  event: string | null;
  changed: boolean;
  kind: ScreenKind | null;
};

function luminanceDiff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let total = 0;
  let moved = 0;
  // Stride of 4 walks one channel per pixel; close enough to luminance.
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    total += d;
    if (d > ACTIVITY_DELTA) moved++;
  }
  return { mean: total / (a.length / 4), moved };
}

/**
 * Watches a screen-share stream and reports what changes, so the apprentice
 * knows what the expert is doing without being shown the raw screen.
 *
 * Two loops: a fast local one that only notices *that* the screen is moving
 * (typing, scrolling, clicking), which keeps the apprentice quiet, and a slower
 * one that asks the vision model *what* changed. Frames that look identical to
 * the previous one never leave the browser.
 */
export function useScreenEvents(
  stream: MediaStream | null,
  options: {
    enabled: boolean;
    /** Session the screen moments belong to, and its clock in seconds. */
    session: { id: string; clock: () => number } | null;
    onEvent: (event: ScreenEvent) => void;
    onActivity: () => void;
    /**
     * Awaited before a frame is taken; false skips the sample. The privacy shield uses it
     * to make sure what is on screen now has been scanned (see use-privacy-shield).
     */
    beforeSample?: () => Promise<boolean>;
    /** How often to look with the vision model; the tutor looks more often, to step in in time. */
    sampleIntervalMs?: number;
  },
) {
  const latest = useRef(options);
  latest.current = options;
  const video = useRef<HTMLVideoElement | null>(null);
  const descriptionRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    const element = document.createElement("video");
    element.srcObject = new MediaStream([track]);
    element.muted = true;
    element.play().catch(() => {
      /* autoplay of a muted off-screen video; nothing to show the user */
    });
    video.current = element;
    descriptionRef.current = null;

    const frameCanvas = document.createElement("canvas");
    const frameCtx = frameCanvas.getContext("2d");
    const grab = () => {
      const canvas = document.createElement("canvas");
      canvas.width = DIFF_SIZE;
      canvas.height = DIFF_SIZE;
      return canvas.getContext("2d", { willReadFrequently: true });
    };
    const activityCtx = grab();
    const sampleCtx = grab();
    let activityPrev: Uint8ClampedArray | null = null;
    let samplePrev: Uint8ClampedArray | null = null;
    let cancelled = false;

    const read = (ctx: CanvasRenderingContext2D) => {
      ctx.drawImage(element, 0, 0, DIFF_SIZE, DIFF_SIZE);
      return new Uint8ClampedArray(ctx.getImageData(0, 0, DIFF_SIZE, DIFF_SIZE).data);
    };

    const watchActivity = () => {
      if (cancelled || !latest.current.enabled || !element.videoWidth || !activityCtx) return;
      const current = read(activityCtx);
      const previous = activityPrev;
      activityPrev = current;
      if (previous && luminanceDiff(current, previous).moved >= ACTIVITY_PIXELS)
        latest.current.onActivity();
    };

    const thumb = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, THUMB_WIDTH / element.videoWidth);
      canvas.width = Math.round(element.videoWidth * scale);
      canvas.height = Math.round(element.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", THUMB_QUALITY);
    };

    const sample = async () => {
      if (cancelled || inFlightRef.current || !latest.current.enabled) return;
      if (!element.videoWidth || !frameCtx || !sampleCtx) return;
      const current = read(sampleCtx);
      const previous = samplePrev;
      samplePrev = current;
      if (previous && luminanceDiff(current, previous).mean <= DIFF_THRESHOLD) return;

      inFlightRef.current = true;
      try {
        const ready = (await latest.current.beforeSample?.()) ?? true;
        if (!ready || cancelled || !latest.current.enabled) return;
        const session = latest.current.session;
        const t = session?.clock() ?? 0;
        frameCanvas.width = FRAME_WIDTH;
        frameCanvas.height = Math.round(element.videoHeight * (FRAME_WIDTH / element.videoWidth));
        const capturedAt = Date.now();
        frameCtx.drawImage(element, 0, 0, frameCanvas.width, frameCanvas.height);
        const response = await backendFetch("/api/v1/screen_event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frame: frameCanvas.toDataURL("image/jpeg", 0.7),
            previous: descriptionRef.current,
            ...(session && { session_id: session.id, t, thumb: thumb() }),
          }),
        });
        if (!response.ok) return;
        const result: VisionResult = await response.json();
        if (result.description) descriptionRef.current = result.description;
        // The apprentice never mentions what it can see, so this console trail
        // is the only way to tell that screen capture is actually working.
        console.log(
          result.changed && result.event
            ? `[screen] EVENT (${result.kind}): ${result.event}`
            : `[screen] sees: ${result.description}`,
        );
        if (cancelled || !latest.current.enabled || !result.changed || !result.event) return;
        latest.current.onEvent({ event: result.event, kind: result.kind ?? "action", capturedAt });
      } catch {
        // A dropped frame is not worth interrupting the session over.
      } finally {
        inFlightRef.current = false;
      }
    };

    const activityTimer = setInterval(watchActivity, ACTIVITY_INTERVAL_MS);
    const sampleTimer = setInterval(
      () => void sample(),
      latest.current.sampleIntervalMs ?? SAMPLE_INTERVAL_MS,
    );
    return () => {
      cancelled = true;
      clearInterval(activityTimer);
      clearInterval(sampleTimer);
      element.pause();
      element.srcObject = null;
      if (video.current === element) video.current = null;
    };
  }, [stream]);

  /** A small still of the screen right now, for tying questions to what was on screen. */
  const snapshot = useCallback(() => {
    const element = video.current;
    if (!element?.videoWidth) return null;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, THUMB_WIDTH / element.videoWidth);
    canvas.width = Math.round(element.videoWidth * scale);
    canvas.height = Math.round(element.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", THUMB_QUALITY);
  }, []);

  return { snapshot };
}
