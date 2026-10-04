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
 * and only after an *action* on screen (a value changed, something saved,
 * held or sent): that is the step a question can be about. A budget keeps it
 * to a few questions per ten minutes; everything else waits for the debrief.
 */

/** Quiet this long after the expert stops talking. */
export const SPEECH_QUIET_MS = 2500;
/** No typing, scrolling or clicking on screen for this long. */
export const SCREEN_QUIET_MS = 3000;
/** After a document opens, give them this long to read it. */
export const READING_MS = 8000;
/** Let them settle into the task before the first question. */
export const FIRST_QUESTION_AFTER_MS = 25_000;
/** At least this long between live questions. */
export const QUESTION_GAP_MS = 60_000;
/** If the agent passed on a pause, wait this long before offering another. */
export const PAUSE_RETRY_MS = 20_000;
/** At most this many live questions in any ten minutes (the brief: three to five). */
export const MAX_QUESTIONS_PER_10_MIN = 5;

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
 * waiting: a pause, but the question budget says not yet.
 * quiet: nothing new worth asking about.
 * ask: a natural pause after a step; offer the agent one question.
 */
export type Floor = "talking" | "busy" | "reading" | "waiting" | "quiet" | "ask";

export function decideFloor(f: FloorInput): Floor {
  if (f.speaking || f.now - f.lastSpeechAt < SPEECH_QUIET_MS) return "talking";
  if (f.now - f.lastActivityAt < SCREEN_QUIET_MS) return "busy";
  const last = f.pending.at(-1);
  if (last?.kind === "navigation" && f.now - last.at < READING_MS) return "reading";
  if (f.agentSpeaking || !f.pending.some((e) => e.kind === "action")) return "quiet";

  const lastQuestion = f.questionTimes.at(-1) ?? -Infinity;
  const recent = f.questionTimes.filter((t) => f.now - t < 600_000).length;
  if (
    f.now - f.observingSince < FIRST_QUESTION_AFTER_MS ||
    f.now - lastQuestion < QUESTION_GAP_MS ||
    f.now - f.lastPauseAt < PAUSE_RETRY_MS ||
    recent >= MAX_QUESTIONS_PER_10_MIN
  )
    return "waiting";
  return "ask";
}
