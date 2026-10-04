import { useCallback, useEffect, useRef, useState } from "react";
import { createWorker, type Worker } from "tesseract.js";
import { findPii, type Box, type OcrLine } from "@/lib/pii";

/** Frames per second of the shielded copy (what is recorded and sampled). */
const FPS = 10;
/** Width the screen is scaled to for text recognition: small UI text stays legible. */
const OCR_WIDTH = 1440;
/** Rest between scans, so recognition doesn't take a whole CPU core. */
const SCAN_REST_MS = 300;
/** How often the shield checks whether the screen changed since its last scan. */
const CHANGE_CHECK_MS = 150;
const CHANGE_SIZE = 48;
/** Mean per-pixel difference that counts as a change (caret blink does not). */
const CHANGE_THRESHOLD = 1.5;
/** Room around a hidden word, so no letter edge peeks out. */
const PAD = 4;
/** Longest a sample waits for a scan of the current screen before it is skipped. */
const FRESH_TIMEOUT_MS = 5000;

export type ShieldStatus = "off" | "starting" | "on" | "failed";

// One recognizer for the app: loading it (wasm and English data) takes a few seconds.
let workerPromise: Promise<Worker> | null = null;
const recognizer = () => {
  workerPromise ??= createWorker("eng").catch((e: unknown) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
};

type TesseractBlock = { paragraphs: { lines: OcrLine[] }[] };

/**
 * The privacy shield: personal data on screen is hidden before any frame leaves the machine.
 *
 * Takes the raw screen share and returns a copy in which emails, IBANs, card and phone
 * numbers and labelled personal fields ("Name:", "Contact:") are painted over. Text is
 * read locally (tesseract.js) and nothing raw is sent anywhere: the vision model, the
 * thumbnails and the recording all use the shielded copy.
 *
 * It fails closed: until the first scan has finished, and if text recognition can't
 * start, there is no shielded stream, so nothing is watched, sampled or recorded.
 */
export function usePrivacyShield(raw: MediaStream | null) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState<ShieldStatus>("off");
  const [hidden, setHidden] = useState(0);
  // Scan bookkeeping, read by fresh().
  const clock = useRef({ lastChangeAt: 0, lastScanFrom: -Infinity, alive: false });

  useEffect(() => {
    const track = raw?.getVideoTracks()[0];
    if (!track) {
      setStatus("off");
      setStream(null);
      setHidden(0);
      return;
    }
    setStatus("starting");
    let cancelled = false;
    const state = clock.current;
    state.alive = true;
    state.lastChangeAt = performance.now();
    state.lastScanFrom = -Infinity;

    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    void video.play().catch(() => undefined);

    const out = document.createElement("canvas");
    const outCtx = out.getContext("2d");
    const ocr = document.createElement("canvas");
    const ocrCtx = ocr.getContext("2d", { willReadFrequently: true });
    const diff = document.createElement("canvas");
    diff.width = diff.height = CHANGE_SIZE;
    const diffCtx = diff.getContext("2d", { willReadFrequently: true });
    let boxes: Box[] = [];
    let previous: Uint8ClampedArray | null = null;
    let shielded: MediaStream | null = null;

    // The shielded copy: every frame drawn with the personal data painted over.
    const draw = () => {
      if (!outCtx || !video.videoWidth) return;
      if (out.width !== video.videoWidth || out.height !== video.videoHeight) {
        out.width = video.videoWidth;
        out.height = video.videoHeight;
      }
      outCtx.drawImage(video, 0, 0);
      outCtx.fillStyle = "#c9c9ce";
      for (const b of boxes) {
        outCtx.beginPath();
        outCtx.roundRect(b.x0 - PAD, b.y0 - PAD, b.x1 - b.x0 + 2 * PAD, b.y1 - b.y0 + 2 * PAD, 4);
        outCtx.fill();
      }
    };

    // Note when the screen changes, so a sample can wait for a scan of what is on it now.
    const watch = () => {
      if (!diffCtx || !video.videoWidth) return;
      diffCtx.drawImage(video, 0, 0, CHANGE_SIZE, CHANGE_SIZE);
      const current = diffCtx.getImageData(0, 0, CHANGE_SIZE, CHANGE_SIZE).data;
      if (previous) {
        let total = 0;
        for (let i = 0; i < current.length; i += 4) total += Math.abs(current[i]! - previous[i]!);
        if (total / (current.length / 4) > CHANGE_THRESHOLD) state.lastChangeAt = performance.now();
      }
      previous = new Uint8ClampedArray(current);
    };

    const scan = async (worker: Worker) => {
      if (!ocrCtx || !video.videoWidth) return false;
      const from = performance.now();
      const scale = Math.min(1, OCR_WIDTH / video.videoWidth);
      ocr.width = Math.round(video.videoWidth * scale);
      ocr.height = Math.round(video.videoHeight * scale);
      ocrCtx.drawImage(video, 0, 0, ocr.width, ocr.height);
      const { data } = await worker.recognize(ocr, {}, { blocks: true });
      const blocks = (data.blocks ?? []) as unknown as TesseractBlock[];
      const lines = blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
      boxes = findPii(lines).map(({ box }) => ({
        x0: box.x0 / scale,
        y0: box.y0 / scale,
        x1: box.x1 / scale,
        y1: box.y1 / scale,
      }));
      state.lastScanFrom = from;
      setHidden(boxes.length);
      return true;
    };

    const drawTimer = window.setInterval(draw, 1000 / FPS);
    const watchTimer = window.setInterval(watch, CHANGE_CHECK_MS);
    void (async () => {
      let worker: Worker;
      try {
        worker = await recognizer();
      } catch (e) {
        console.warn("[privacy] text recognition could not start; nothing will be shared", e);
        if (!cancelled) setStatus("failed");
        return;
      }
      while (!cancelled) {
        try {
          const scanned = await scan(worker);
          if (scanned && !shielded && !cancelled) {
            draw();
            shielded = out.captureStream(FPS);
            setStream(shielded);
            setStatus("on");
          }
        } catch (e) {
          console.warn("[privacy] scan failed", e);
        }
        await new Promise((r) => setTimeout(r, SCAN_REST_MS));
      }
    })();

    return () => {
      cancelled = true;
      state.alive = false;
      clearInterval(drawTimer);
      clearInterval(watchTimer);
      shielded?.getTracks().forEach((t) => t.stop());
      video.pause();
      video.srcObject = null;
      setStream(null);
      setHidden(0);
    };
  }, [raw]);

  /**
   * Resolves true once a scan has covered the screen as it is now (begun after its last
   * change), so a frame taken right after hides everything that is on it. False if that
   * takes too long or the shield stopped; then the frame should not be sent.
   */
  const fresh = useCallback(async () => {
    const state = clock.current;
    const deadline = performance.now() + FRESH_TIMEOUT_MS;
    while (state.alive && performance.now() < deadline) {
      if (state.lastScanFrom >= state.lastChangeAt) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }, []);

  return { stream, status, hidden, fresh };
}
