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
 * limit: the apprentice asks at least the policy's minLive (MIN_LIVE_QUESTIONS
 * by default) and keeps asking at later pauses, spaced the way a colleague
 * sitting next to them would. The pace comes from Settings via policyFrom.
 */
import type { Settings } from "./settings";

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

/** How often the apprentice asks: the floor's numbers, from Settings or the defaults. */
export type FloorPolicy = {
  minLive: number;
  earlyGapMs: number;
  gapMs: number;
  minDebrief: number;
};

/** Follow-up questions the apprentice asks in the debrief before the teach-back. */
export const MIN_DEBRIEF_QUESTIONS = 3;

export const DEFAULT_POLICY: FloorPolicy = {
  minLive: MIN_LIVE_QUESTIONS,
  earlyGapMs: EARLY_QUESTION_GAP_MS,
  gapMs: QUESTION_GAP_MS,
  minDebrief: MIN_DEBRIEF_QUESTIONS,
};

/** Curiosity scales the gaps between live questions: shorter gaps, more questions. */
const GAP_SCALE: Record<Settings["curiosity"], number> = { quiet: 1.5, balanced: 1, curious: 0.66 };
// The brief's floor is 3 debrief follow-ups, and "standard" keeps today's 3.
const DEBRIEF_MIN: Record<Settings["debriefDepth"], number> = {
  short: 3,
  standard: 3,
  thorough: 5,
};

/**
 * The question pace for the Settings choices. Unknown values fall back to that field's default,
 * and the live and debrief minimums never drop below the brief's 3.
 */
export function policyFrom(
  s: Pick<Settings, "curiosity" | "minQuestions" | "debriefDepth">,
): FloorPolicy {
  const scale = Object.hasOwn(GAP_SCALE, s.curiosity) ? GAP_SCALE[s.curiosity] : 1;
  const debrief = Object.hasOwn(DEBRIEF_MIN, s.debriefDepth)
    ? DEBRIEF_MIN[s.debriefDepth]
    : MIN_DEBRIEF_QUESTIONS;
  const live = Number(s.minQuestions);
  return {
    minLive: Math.max(MIN_LIVE_QUESTIONS, Number.isInteger(live) ? live : MIN_LIVE_QUESTIONS),
    earlyGapMs: Math.round(EARLY_QUESTION_GAP_MS * scale),
    gapMs: Math.round(QUESTION_GAP_MS * scale),
    minDebrief: Math.max(MIN_DEBRIEF_QUESTIONS, debrief),
  };
}

export function decideFloor(f: FloorInput, policy: FloorPolicy = DEFAULT_POLICY): Floor {
  if (f.speaking || f.now - f.lastSpeechAt < SPEECH_QUIET_MS) return "talking";
  if (f.now - f.lastActivityAt < SCREEN_QUIET_MS) return "busy";
  const last = f.pending.at(-1);
  if (last?.kind === "navigation" && f.now - last.at < READING_MS) return "reading";
  const early = f.questionTimes.length < policy.minLive;
  const worthAsking = f.pending.some((e) => e.kind === "action") || (early && f.pending.length > 0);
  if (f.agentSpeaking || !worthAsking) return "quiet";

  const lastQuestion = f.questionTimes.at(-1) ?? -Infinity;
  if (
    f.now - f.observingSince < FIRST_QUESTION_AFTER_MS ||
    f.now - lastQuestion < (early ? policy.earlyGapMs : policy.gapMs) ||
    f.now - f.lastPauseAt < PAUSE_RETRY_MS
  )
    return "waiting";
  return "ask";
}

/** In the wrap-up, this much silence after an answer before the next question (or the debrief). */
export const WRAP_UP_QUIET_MS = 2500;
/** In the wrap-up, how long to wait for an answer that doesn't come. */
export const WRAP_UP_ANSWER_MS = 20_000;

export type WrapUpInput = {
  now: number;
  speaking: boolean;
  agentSpeaking: boolean;
  lastSpeechAt: number;
  /** When the agent last stopped speaking. */
  agentDoneAt: number;
  /** "pause": a question was requested; "answer": the agent has replied. */
  grant: "start" | "pause" | "answer" | null;
  /** Until when the requested question may still come. */
  floorOpenUntil: number;
  /** When the last question was requested. */
  lastPauseAt: number;
  /** The last live question counted, if any. */
  last?: { at: number; kind: string } | undefined;
  /** Enough questions, one about a guardrail. */
  met: boolean;
  prompts: number;
  limit: number;
};

/**
 * After End, when the live questions fall short: the expert is waiting, so there is no
 * pause to wait for, only each answer. wait, ask the next missing question, or finish
 * (go to the debrief) once they are asked or the tries run out.
 */
export function decideWrapUp(w: WrapUpInput): "wait" | "ask" | "finish" {
  if (w.speaking || w.agentSpeaking) return "wait";
  const quietSince = Math.max(w.lastSpeechAt, w.agentDoneAt);
  if (w.now - quietSince < WRAP_UP_QUIET_MS) return "wait";
  if (w.last?.kind === "pending") return "wait"; // its label decides whether the guardrail is done
  if (w.grant === "pause" && w.now < w.floorOpenUntil) return "wait"; // the question is coming
  const askedThisTime = w.last !== undefined && w.last.at >= w.lastPauseAt;
  const answered = askedThisTime && w.lastSpeechAt > w.last!.at;
  if (askedThisTime && !answered && w.now - quietSince < WRAP_UP_ANSWER_MS) return "wait";
  return w.met || w.prompts >= w.limit ? "finish" : "ask";
}

/*
 * The debrief and the teach-back, after the task: the agent decides when it moves on, but the
 * pill checks it first. start_teach_back is refused until the apprentice has asked at least
 * the policy's minDebrief follow-ups (MIN_DEBRIEF_QUESTIONS by default), and confirm_work_map
 * until it has explained the task back and the expert has answered.
 */

/** The teach-back has to explain the task, not just say "got it": at least this many words. */
export const MIN_TEACH_BACK_WORDS = 25;

const STOP_WORDS = new Set(
  "about after again also always before could does doing from have into just like more much only should that their them then there these they this those what when where which while will with would your".split(
    " ",
  ),
);
/** Words that carry the meaning: lowercase, four letters or more, not a common word. */
const contentWords = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length >= 4 && !STOP_WORDS.has(w),
  );
/** Words in any language, including those written without spaces (Chinese, Japanese, Thai). */
const words = new Intl.Segmenter(undefined, { granularity: "word" });
const wordCount = (text: string) => [...words.segment(text)].filter((s) => s.isWordLike).length;

/**
 * The heuristics below can't be right in every one of the 72 languages, so the gate gives way:
 * after this many refused start_teach_back calls the teach-back goes ahead, and after this many
 * "explain first" replies to confirm_work_map the explanation counts as given. A clear no from
 * the expert, or no answer at all, is never overridden.
 */
export const MAX_TEACH_BACK_REFUSALS = 3;
export const MAX_EXPLAIN_REFUSALS = 2;

/** A gap counts as asked when more than half of its content words appear in one asked question. */
function alreadyAsked(gap: string, asked: string[]) {
  const words = [...new Set(contentWords(gap))];
  if (words.length === 0) return false;
  return asked.some((q) => {
    const said = new Set(contentWords(q));
    return words.filter((w) => said.has(w)).length * 2 > words.length;
  });
}

export type DebriefStatus = {
  /** Enough follow-ups asked to go on to the teach-back (or refused often enough). */
  met: boolean;
  /** How many more to ask. */
  remaining: number;
  /** Gaps from the draft Work Map to ask about next, at most `remaining`. */
  next: string[];
};

/**
 * asked: the apprentice's debrief questions so far; gaps: the draft Work Map's open questions;
 * refusals: start_teach_back calls refused so far this session; minDebrief: follow-ups required.
 */
export function debriefStatus({
  asked,
  gaps,
  refusals = 0,
  minDebrief = DEFAULT_POLICY.minDebrief,
}: {
  asked: string[];
  gaps: string[];
  refusals?: number;
  minDebrief?: number;
}): DebriefStatus {
  const remaining = Math.max(0, minDebrief - asked.length);
  const next = gaps.filter((g) => g.trim() && !alreadyAsked(g, asked)).slice(0, remaining);
  return { met: remaining === 0 || refusals >= MAX_TEACH_BACK_REFUSALS, remaining, next };
}

/** "Is that right?" and the like: checking in, not asking about the task (English and German). */
const CHECK_INS = [
  /^is that (right|correct|ok|okay)$/,
  /^did i get that right$/,
  /^does that make sense$/,
  /^is that how it works$/,
  /^(right|correct|okay|ok)$/,
  /^stimmt das$/,
  /^ist das richtig$/,
  /^passt das$/,
  /^(oder|richtig)$/,
];
const normalized = (sentence: string) =>
  sentence
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Question marks: ? ？ (CJK) ؟ (Arabic, Persian, Urdu) ՞ (Armenian) and the Greek question mark,
 * which is ";" (or U+037E) in Greek script.
 */
const QUESTION_MARKS = "?？؟՞\u037E";
const questionMarks = (text: string) =>
  /\p{Script=Greek}/u.test(text) ? `${QUESTION_MARKS};` : QUESTION_MARKS;
const questionsIn = (text: string) => {
  const marks = questionMarks(text);
  return text.match(new RegExp(`[^.!。！${marks}]*[${marks}]`, "gu")) ?? [];
};

/** Any line that asks something, check-ins included ("Right?" counts). */
export function isQuestion(text: string) {
  return questionsIn(text).some((q) => normalized(q) !== "");
}

/** The line ends on a question mark: someone asked a question and is waiting for the answer. */
export function endsWithQuestion(text: string) {
  const last = text.trim().at(-1);
  return last !== undefined && questionMarks(text).includes(last);
}

/**
 * An apprentice line asks a debrief question: one of its questions is more than a check-in.
 * A check-in tagged onto a statement ("The limit is 5,000, right?") is one too.
 */
export function isDebriefQuestion(text: string) {
  return questionsIn(text).some((q) => {
    const s = normalized(q);
    const tag = normalized(q.split(/[,，،]/).at(-1) ?? "");
    return s !== "" && !CHECK_INS.some((c) => c.test(s) || c.test(tag));
  });
}

/** The expert's answer to the teach-back says no, or yes with a correction (English and German). */
const NOT_YES_START =
  /^(no|nope|not|nein|nee|nicht|but|aber)\b|^(yes|yeah|yep|yup|ja)[\s,.!]*(but|aber)\b/;
const NOT_YES_ANYWHERE =
  /\b(not quite|not really|not exactly|that's wrong|that is wrong|not right|not correct|isn't right|except|nicht ganz|nicht richtig|stimmt nicht|falsch)\b|außer/;
/** "Actually" is a correction only when the answer doesn't start with a clear yes. */
const CLEAR_YES = /^(yes|yeah|yep|yup|exactly|correct|right|ja|genau|richtig|stimmt|passt)\b/;
const SOFT_NO = /\b(actually|eigentlich)\b/;

/**
 * explained: what the apprentice said in the teach-back; confirmedBy: what the expert said after it.
 * explain_first: it hasn't explained the task yet. await_confirmation: the expert hasn't answered.
 * not_confirmed: the expert said no or corrected it. Other languages are never blocked.
 * refusals: "explain first" replies already given this session.
 */
export function teachBackStatus({
  explained,
  confirmedBy,
  refusals = 0,
}: {
  explained: string[];
  confirmedBy: string;
  refusals?: number;
}): "explain_first" | "await_confirmation" | "not_confirmed" | "ok" {
  if (wordCount(explained.join(" ")) < MIN_TEACH_BACK_WORDS && refusals < MAX_EXPLAIN_REFUSALS)
    return "explain_first";
  if (!confirmedBy.trim()) return "await_confirmation";
  const said = confirmedBy.toLowerCase().replace(/[’]/g, "'").trim();
  if (NOT_YES_START.test(said) || NOT_YES_ANYWHERE.test(said)) return "not_confirmed";
  if (SOFT_NO.test(said) && !CLEAR_YES.test(said)) return "not_confirmed";
  return "ok";
}
