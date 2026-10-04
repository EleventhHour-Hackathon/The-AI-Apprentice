/**
 * Who has the floor while the expert works: decides when the apprentice may ask.
 *
 * The agent never decides this alone. The pill watches three signals and only
 * sends the agent a [PAUSE] when all of them say the expert has stopped:
 *
 * - talking: voice activity from the microphone (ElevenLabs VAD scores)
 * - typing or scrolling: pixel changes on the shared screen, a few times a second
 * - reading: a new document just opened, so they are taking it in
 *
 * and only after something happened on screen that a question can be about:
 * an *action* (a value changed, something saved, held or sent), or, until the
 * first few questions are asked, a document they opened. There is no upper
 * limit: the apprentice asks at least MIN_LIVE_QUESTIONS and keeps asking at
 * later pauses, spaced the way a colleague sitting next to them would.
 */

/** Quiet this long after the expert stops talking. */
export const SPEECH_QUIET_MS = 2500;
/** No typing, scrolling or clicking on screen for this long. */
export const SCREEN_QUIET_MS = 3000;
/** After a document opens, give them this long to read it. */
export const READING_MS = 8000;
/** Let them settle into the task before the first question. */
export const FIRST_QUESTION_AFTER_MS = 25_000;
/** The apprentice asks at least this many questions while the expert works. */
export const MIN_LIVE_QUESTIONS = 3;
/** Between live questions until the minimum is reached. */
export const EARLY_QUESTION_GAP_MS = 40_000;
/** Between live questions after that: still asking, but less often. */
export const QUESTION_GAP_MS = 75_000;
/** If the agent passed on a pause, wait this long before offering another. */
export const PAUSE_RETRY_MS = 20_000;

export type ScreenKind = "action" | "navigation";

export type FloorInput = {
  now: number;
  /** When watching began. */
  observingSince: number;
  /** The expert is talking right now. */
  speaking: boolean;
  lastSpeechAt: number;
  /** Last pixel change on the shared screen. */
  lastActivityAt: number;
  agentSpeaking: boolean;
  /** Screen events not yet offered to the agent, oldest first. */
  pending: { at: number; kind: ScreenKind }[];
  /** When live questions were actually asked. */
  questionTimes: number[];
  /** When the last [PAUSE] was sent, asked or not. */
  lastPauseAt: number;
};

/**
 * talking / busy / reading: the expert is occupied; stay quiet.
 * waiting: a pause, but too soon after the start or the last question.
 * quiet: nothing new worth asking about.
 * ask: a natural pause after a step; offer the agent one question.
 */
export type Floor = "talking" | "busy" | "reading" | "waiting" | "quiet" | "ask";

export function decideFloor(f: FloorInput): Floor {
  if (f.speaking || f.now - f.lastSpeechAt < SPEECH_QUIET_MS) return "talking";
  if (f.now - f.lastActivityAt < SCREEN_QUIET_MS) return "busy";
  const last = f.pending.at(-1);
  if (last?.kind === "navigation" && f.now - last.at < READING_MS) return "reading";
  const early = f.questionTimes.length < MIN_LIVE_QUESTIONS;
  const worthAsking = f.pending.some((e) => e.kind === "action") || (early && f.pending.length > 0);
  if (f.agentSpeaking || !worthAsking) return "quiet";

  const lastQuestion = f.questionTimes.at(-1) ?? -Infinity;
  if (
    f.now - f.observingSince < FIRST_QUESTION_AFTER_MS ||
    f.now - lastQuestion < (early ? EARLY_QUESTION_GAP_MS : QUESTION_GAP_MS) ||
    f.now - f.lastPauseAt < PAUSE_RETRY_MS
  )
    return "waiting";
  return "ask";
}
