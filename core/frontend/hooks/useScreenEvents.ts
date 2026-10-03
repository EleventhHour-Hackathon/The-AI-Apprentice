"use client";

import { useEffect, useRef } from "react";
import usePathStore from "@/app/store/PathStore";

/** How often we look at the screen. */
const SAMPLE_INTERVAL_MS = 1500;
/** Width we downscale frames to before sending them to the vision model. */
const FRAME_WIDTH = 1024;
/** Size of the thumbnail used for the cheap "did anything move?" check. */
const DIFF_SIZE = 64;
/**
 * Mean per-pixel difference (0-255) below which we treat two frames as the
 * same screen and skip the vision call entirely. Typing a few characters
 * clears this; a blinking caret or a moving cursor does not.
 */
const DIFF_THRESHOLD = 2.0;

type ScreenEvent = {
  description: string;
  event: string | null;
  changed: boolean;
};

/**
 * Watches a screen-share stream and feeds what changes into the live
 * conversation, so the agent knows what the expert is doing without being
 * shown the raw screen.
 *
 * Frames that look identical to the previous one never leave the browser,
 * which keeps cost and latency proportional to actual activity rather than
 * to wall-clock time.
 */
export function useScreenEvents(
  stream: MediaStream | null,
  options: { enabled?: boolean } = {},
) {
  const { enabled = true } = options;
  const rtviClient = usePathStore((s) => s.rtviClient);

  // Kept in refs so the sampling loop never restarts mid-session.
  const descriptionRef = useRef<string | null>(null);
  const thumbRef = useRef<Uint8ClampedArray | null>(null);
  const inFlightRef = useRef(false);
  const clientRef = useRef<unknown>(null);

  clientRef.current = rtviClient;

  useEffect(() => {
    if (!stream || !enabled) return;

    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.play().catch(() => {
      /* autoplay of a muted off-screen video; nothing to show the user */
    });

    const frameCanvas = document.createElement("canvas");
    const frameCtx = frameCanvas.getContext("2d");
    const diffCanvas = document.createElement("canvas");
    diffCanvas.width = DIFF_SIZE;
    diffCanvas.height = DIFF_SIZE;
    const diffCtx = diffCanvas.getContext("2d", { willReadFrequently: true });

    let cancelled = false;

    /** True when the frame differs enough from the last one to be worth a look. */
    const hasMoved = (): boolean => {
      if (!diffCtx) return true;
      diffCtx.drawImage(video, 0, 0, DIFF_SIZE, DIFF_SIZE);
      const current = diffCtx.getImageData(0, 0, DIFF_SIZE, DIFF_SIZE).data;
      const previous = thumbRef.current;
      thumbRef.current = new Uint8ClampedArray(current);

      if (!previous) return true;

      let total = 0;
      // Stride of 4 walks one channel per pixel; luminance is close enough.
      for (let i = 0; i < current.length; i += 4) {
        total += Math.abs(current[i] - previous[i]);
      }
      return total / (current.length / 4) > DIFF_THRESHOLD;
    };

    const sample = async () => {
      if (cancelled || inFlightRef.current) return;
      if (!video.videoWidth || !frameCtx) return;
      if (!hasMoved()) return;

      inFlightRef.current = true;
      try {
        const scale = FRAME_WIDTH / video.videoWidth;
        frameCanvas.width = FRAME_WIDTH;
        frameCanvas.height = Math.round(video.videoHeight * scale);
        frameCtx.drawImage(video, 0, 0, frameCanvas.width, frameCanvas.height);

        const base = process.env.NEXT_PUBLIC_PIPECAT_BASE_URL || "";
        const response = await fetch(`${base}/api/v1/screen_event`, {
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

        // The agent is told never to mention what it can see, so this console
        // trail is the only way to tell that screen capture is actually working.
        if (result.changed && result.event) {
          console.log("[screen] EVENT:", result.event);
        } else {
          console.log("[screen] sees:", result.description);
        }

        if (!result.changed || !result.event) return;

        const client = clientRef.current as
          | { appendToContext?: (m: unknown) => Promise<boolean> }
          | null;
        await client?.appendToContext?.({
          role: "user",
          content: `[SCREEN] ${result.event}`,
          run_immediately: false,
        });
      } catch {
        // A dropped frame is not worth interrupting the session over.
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = setInterval(sample, SAMPLE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      video.pause();
      video.srcObject = null;
    };
  }, [stream, enabled]);
}

export default useScreenEvents;
