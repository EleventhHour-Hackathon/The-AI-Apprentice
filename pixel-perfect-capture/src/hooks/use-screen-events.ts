import { useCallback, useEffect, useRef } from "react";
import { BACKEND_URL } from "@/lib/backend";

/** How often we look at the screen. */
const SAMPLE_INTERVAL_MS = 1500;
/** Width we downscale frames to before sending them to the vision model. */
const FRAME_WIDTH = 1024;
/** Width of the thumbnails kept for the debrief. */
const THUMB_WIDTH = 240;
/** Size of the thumbnail used for the cheap "did anything move?" check. */
const DIFF_SIZE = 64;
/**
 * Mean per-pixel difference (0-255) below which we treat two frames as the
 * same screen and skip the vision call entirely. Typing a few characters
 * clears this; a blinking caret or a moving cursor does not.
 */
const DIFF_THRESHOLD = 2.0;

type ScreenEvent = { description: string; event: string | null; changed: boolean };

/**
 * Watches a screen-share stream and reports what changes, so the apprentice
 * knows what the expert is doing without being shown the raw screen.
 *
 * Frames that look identical to the previous one never leave the browser,
 * which keeps cost and latency proportional to actual activity rather than
 * to wall-clock time.
 */
export function useScreenEvents(
  stream: MediaStream | null,
  options: { enabled: boolean; onEvent: (event: string) => void },
) {
  const latest = useRef(options);
  latest.current = options;
  const video = useRef<HTMLVideoElement | null>(null);
  const descriptionRef = useRef<string | null>(null);
  const thumbRef = useRef<Uint8ClampedArray | null>(null);
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
    thumbRef.current = null;

    const frameCanvas = document.createElement("canvas");
    const frameCtx = frameCanvas.getContext("2d");
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = DIFF_SIZE;
    diffCanvas.height = DIFF_SIZE;
    const diffCtx = diffCanvas.getContext("2d", { willReadFrequently: true });
    let cancelled = false;

    /** True when the frame differs enough from the last one to be worth a look. */
    const hasMoved = () => {
      if (!diffCtx) return true;
      diffCtx.drawImage(element, 0, 0, DIFF_SIZE, DIFF_SIZE);
      const current = diffCtx.getImageData(0, 0, DIFF_SIZE, DIFF_SIZE).data;
      const previous = thumbRef.current;
      thumbRef.current = new Uint8ClampedArray(current);
      if (!previous) return true;
      let total = 0;
      // Stride of 4 walks one channel per pixel; luminance is close enough.
      for (let i = 0; i < current.length; i += 4)
        total += Math.abs((current[i] ?? 0) - (previous[i] ?? 0));
      return total / (current.length / 4) > DIFF_THRESHOLD;
    };

    const sample = async () => {
      if (cancelled || inFlightRef.current || !latest.current.enabled) return;
      if (!element.videoWidth || !frameCtx || !hasMoved()) return;
      inFlightRef.current = true;
      try {
        frameCanvas.width = FRAME_WIDTH;
        frameCanvas.height = Math.round(element.videoHeight * (FRAME_WIDTH / element.videoWidth));
        frameCtx.drawImage(element, 0, 0, frameCanvas.width, frameCanvas.height);
        const response = await fetch(`${BACKEND_URL}/api/v1/screen_event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frame: frameCanvas.toDataURL("image/jpeg", 0.7),
            previous: descriptionRef.current,
          }),
        });
        if (!response.ok) return;
        const result: ScreenEvent = await response.json();
        if (result.description) descriptionRef.current = result.description;
        // The apprentice never mentions what it can see, so this console trail
        // is the only way to tell that screen capture is actually working.
        console.log(
          result.changed && result.event
            ? `[screen] EVENT: ${result.event}`
            : `[screen] sees: ${result.description}`,
        );
        if (cancelled || !latest.current.enabled || !result.changed || !result.event) return;
        latest.current.onEvent(result.event);
      } catch {
        // A dropped frame is not worth interrupting the session over.
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
    canvas.width = THUMB_WIDTH;
    canvas.height = Math.round(element.videoHeight * (THUMB_WIDTH / element.videoWidth));
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  }, []);

  return { snapshot };
}
