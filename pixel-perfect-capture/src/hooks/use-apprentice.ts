import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceConversation } from "@elevenlabs/client";
import { backendFetch } from "@/lib/backend";
import {
  debriefStatus,
  decideFloor,
  decideWrapUp,
  DEFAULT_POLICY,
  endsWithQuestion,
  isDebriefQuestion,
  isQuestion,
  liveQuestionsMet,
  MAX_EXPLAIN_REFUSALS,
  notYetReply,
  pauseAsk,
  pauseCue,
  policyFrom,
  readInferred,
  SCREEN_QUIET_MS,
  SPEECH_QUIET_MS,
  teachBackStatus,
  wrapUpLimit,
  type Floor,
  type FloorPolicy,
  type Inferred,
  type ScreenKind,
} from "@/lib/floor";
import type { ScreenEvent } from "@/hooks/use-screen-events";
import type { LanguageChoice } from "@/lib/languages";
import { loadSettings } from "@/lib/settings";
import { clearNextSession, parentRefused, peekNextSession, PostError } from "@/lib/next-session";

/** Phases of a session. The agent moves between them by calling client tools. */
export type FlowNode = "session_start" | "observing" | "debrief" | "teach_back" | "end";
/** Where in the work session something happened, and what the screen looked like. */
export type Moment = { time: number; thumb: string | null };
/** One thing the apprentice said, and what the expert said back. */
export type Exchange = Moment & {
  node: FlowNode;
  question: string;
  answer: string;
  captured: boolean;
};
/** Something the agent recorded into the Work Map. */
export type Capture = Moment & {
  kind: "step" | "guardrail" | "open_question" | "correction";
  title: string;
  detail: string;
};
/** A question asked at a pause while the expert worked; the brief asks for 3, one about a guardrail. */
export type LiveQuestion = {
  /** Session clock, seconds. */
  t: number;
  text: string;
  /** Labelled by the backend; "pending" until it answers. */
  kind: "pending" | "guardrail" | "reason" | "other";
  /** Put off for the debrief with Later: it does not count. */
  deferred: boolean;
};
/** One line of what was said, as the Work Map merge reads it. */
type Line = { role: "expert" | "apprentice"; text: string; t: number; phase: "live" | "debrief" };

type ApprenticeState = {
  status: "idle" | "connecting" | "connected" | "closed";
  error: string | null;
  node: FlowNode;
  botSpeaking: boolean;
  userSpeaking: boolean;
  /** The expert's words so far in a turn not yet transcribed. Not provided by ElevenLabs; kept for the UI. */
  partial: string;
  task: string | null;
  /** What the apprentice already knew about this task, from earlier sessions. */
  known: string;
  confirmed: boolean;
  /** Whether the session made it into a Work Map once it ended. */
  saved: "no" | "saving" | "saved" | "empty" | "failed";
  /** The Work Map is being merged (start of the debrief, or after the teach-back). */
  merging: boolean;
  /** Why the apprentice is or isn't asking right now (see lib/floor.ts). */
  floor: Floor;
  exchanges: Exchange[];
  captures: Capture[];
  liveQuestions: LiveQuestion[];
  /** At least the policy's minLive counted, one of them about a guardrail. */
  guardrailAsked: boolean;
  /** End was pressed before that: the apprentice is asking what is missing before the debrief. */
  wrapUp: boolean;
  /** Follow-up questions asked in the debrief; the teach-back waits for minDebrief of them. */
  debriefAsked: number;
  /** Follow-ups required before the teach-back, from Settings for this session. */
  minDebrief: number;
};

const initialState: ApprenticeState = {
  status: "idle",
  error: null,
  node: "session_start",
  known: "",
  botSpeaking: false,
  userSpeaking: false,
  partial: "",
  task: null,
  confirmed: false,
  saved: "no",
  merging: false,
  floor: "quiet",
  exchanges: [],
  captures: [],
  liveQuestions: [],
  guardrailAsked: false,
  wrapUp: false,
  debriefAsked: 0,
  minDebrief: DEFAULT_POLICY.minDebrief,
};

/** After [PAUSE], how long the agent has to start asking before the floor closes again. */
const PAUSE_GRANT_MS = 15_000;
/** After a granted question, room for the expert's answer and a short acknowledgement. */
const ANSWER_WINDOW_MS = 45_000;
/** A direct question from the expert may be answered for this long. */
const DIRECT_QUESTION_MS = 12_000;
/** VAD score above which the expert counts as talking. */
const VAD_SPEECH = 0.6;
/** Typing keeps the agent from starting to speak; ElevenLabs holds it about 2s per signal. */
const USER_ACTIVITY_EVERY_MS = 1000;

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
type Tally = {
  asked: { kind: LiveQuestion["kind"]; deferred: boolean }[];
  guardrailCaptured: boolean;
  policy: FloorPolicy;
};
/** Live questions that count: asked at a pause, not put off with Later. */
const counted = (x: Tally) => x.asked.filter((q) => !q.deferred).length;
const guardrailAsked = (x: Tally) =>
  x.guardrailCaptured || x.asked.some((q) => q.kind === "guardrail" && !q.deferred);
const questionsMet = (x: Tally) => liveQuestionsMet(counted(x), guardrailAsked(x), x.policy);

const live = (node: FlowNode) => node === "session_start" || node === "observing";

/** Resolve to `fallback` if `work` has not finished in `ms`. */
function atMost<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await backendFetch(`/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new PostError(`${path} answered ${response.status}`, response.status);
  return (await response.json()) as T;
}

/** How long a pause waits for /infer before the [PAUSE] goes out as usual. */
const INFER_TIMEOUT_MS = 2500;
/** The last lines of the conversation /infer reads. */
const INFER_LINES = 12;

/** What is already clear at this pause, or null if /infer failed or took too long. */
async function inferPause(
  sessionId: string,
  events: string[],
  transcript: { role: Line["role"]; text: string }[],
): Promise<Inferred | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), INFER_TIMEOUT_MS);
  try {
    const response = await backendFetch(`/api/v1/sessions/${sessionId}/infer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, transcript }),
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`/infer answered ${response.status}`);
    return readInferred(await response.json());
  } catch (e) {
    console.warn("[floor] /infer gave nothing, asking as usual", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a client tool call from the agent into a Work Map capture for the pill. */
function toCapture(kind: Capture["kind"], p: Record<string, unknown>): Omit<Capture, keyof Moment> {
  switch (kind) {
    case "step":
      return {
        kind,
        title: str(p["step"]),
        detail: [str(p["decision"]), str(p["reason"])].filter(Boolean).join(" · "),
      };
    case "guardrail": {
      const ask = str(p["ask_whom"]);
      return {
        kind,
        title: str(p["rule"]),
        detail: [str(p["applies_when"]), ask && `ask ${ask}`].filter(Boolean).join(" · "),
      };
    }
    case "open_question":
      return { kind, title: str(p["question"]), detail: "" };
    case "correction":
      return { kind, title: str(p["correction"]), detail: "" };
  }
}

/**
 * One voice session with the Tacit apprentice agent on ElevenLabs (ElevenAgents).
 *
 * ElevenLabs listens (Scribe), speaks and runs the conversation; this hook
 * decides when the agent may speak while the expert works, feeds it what
 * happens on screen, and turns its client tool calls into the Work Map.
 */
export function useApprentice(options: {
  moment: () => Moment;
  onCapture?: (capture: Capture, node: FlowNode) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const conv = useRef<VoiceConversation | null>(null);
  const [state, setState] = useState(initialState);
  const [level, setLevel] = useState(0);
  const [session, setSession] = useState<{ id: string; clock: () => number } | null>(null);

  // Everything the floor and the tools need, outside React state so callbacks see it immediately.
  const s = useRef({
    sessionId: "",
    startedAt: 0,
    node: "session_start" as FlowNode,
    transcript: [] as Line[],
    offRecord: false,
    observingSince: 0,
    lastSpeechAt: -Infinity,
    lastActivityAt: -Infinity,
    lastUserActivitySent: -Infinity,
    pending: [] as { at: number; kind: ScreenKind; text: string; t: number }[],
    questionTimes: [] as number[],
    lastPauseAt: -Infinity,
    /** A pause is waiting for /infer before its [PAUSE] goes out. */
    inferring: false,
    /** Until when the agent may speak while the expert works, and why. */
    floorOpenUntil: -Infinity,
    grant: null as "start" | "pause" | "answer" | null,
    lastDirectQuestionAt: -Infinity,
    /** The agent's current utterance is muted because it didn't have the floor. */
    muted: false,
    /** The current utterance has been checked against the floor. */
    gated: false,
    agentSpeaking: false,
    /** [TASK DONE] was sent; End can fire more than once (button, shortcut, pill). */
    taskDone: false,
    /** Live questions asked at a pause, with performance.now() of when. */
    asked: [] as (LiveQuestion & { at: number })[],
    /** The agent's current utterance answers a [PAUSE]: if it is a question, it counts. */
    pauseReply: false,
    /** A guardrail was recorded while the expert answered a live question. */
    guardrailCaptured: false,
    agentDoneAt: -Infinity,
    /** Last screen events, for the wrap-up questions once the screen is no longer shared. */
    recent: [] as { t: number; text: string }[],
    wrapUp: false,
    wrapUpPrompts: 0,
    wrapUpLimit: 0,
    /** The draft Work Map's open questions, from start_debrief. */
    gaps: [] as string[],
    /** The apprentice's questions in the debrief. */
    debriefQuestions: [] as string[],
    /** What the apprentice said in the teach-back. */
    teachBack: [] as string[],
    /** The expert's last words after the teach-back began, with the session clock. */
    teachBackReply: null as { text: string; t: number } | null,
    /** Refused start_teach_back calls, and "explain first" replies to confirm_work_map (see floor.ts). */
    teachBackRefusals: 0,
    explainRefusals: 0,
    /** The question pace from Settings, read once when the session starts. */
    policy: DEFAULT_POLICY as FloorPolicy,
  });
  const clock = useCallback(
    () => (s.current.startedAt ? (performance.now() - s.current.startedAt) / 1000 : 0),
    [],
  );

  const setNode = useCallback((node: FlowNode) => {
    s.current.node = node;
    // Leaving the watching phase ends any pending "Go ahead." skip.
    if (node !== "observing" && s.current.grant === "start") s.current.grant = null;
    setState((st) => ({ ...st, node }));
  }, []);

  /** May the agent speak now? Checked once per utterance; mutes it if not. */
  const gate = useCallback(() => {
    const x = s.current;
    if (x.gated) return !x.muted;
    x.gated = true;
    const now = performance.now();
    const allowed =
      x.node !== "observing" ||
      now < x.floorOpenUntil ||
      now - x.lastDirectQuestionAt < DIRECT_QUESTION_MS;
    if (!allowed) {
      x.muted = true;
      conv.current?.setVolume({ volume: 0 });
      console.log("[floor] muted a reply: the expert has the floor");
      return false;
    }
    if (x.node === "observing" && x.grant === "pause") {
      // A reply to a pause: the answer gets a window, and if it is a question it counts.
      x.pauseReply = true;
      x.grant = "answer";
      x.floorOpenUntil = now + ANSWER_WINDOW_MS;
    }
    return true;
  }, []);

  const endUtterance = useCallback(() => {
    const x = s.current;
    if (x.muted) {
      conv.current?.setVolume({ volume: 1 });
      conv.current?.sendContextualUpdate(
        "[NOT HEARD] Your last reply was muted because the expert was busy. Do not repeat it now; ask at the next [PAUSE] if it still matters.",
      );
    }
    x.muted = false;
    x.gated = false;
  }, []);

  /** Copy the live-question tally into state for the pill. */
  const syncQuestions = useCallback(() => {
    const x = s.current;
    const liveQuestions = x.asked.map(({ at: _at, ...q }) => q);
    setState((st) => ({ ...st, liveQuestions, guardrailAsked: guardrailAsked(x) }));
  }, []);

  /** The agent asked a question at a pause: count it, and have the backend label it. */
  const countQuestion = useCallback(
    (text: string) => {
      const x = s.current;
      const q = {
        t: clock(),
        at: performance.now(),
        text,
        kind: "pending" as const,
        deferred: false,
      };
      const entry: (typeof x.asked)[number] = q;
      x.asked.push(entry);
      x.questionTimes.push(q.at);
      syncQuestions();
      const sessionId = x.sessionId;
      post<{ kind: LiveQuestion["kind"] }>(`/sessions/${sessionId}/live_question`, {
        text,
        t: q.t,
      }).then(
        ({ kind }) => {
          if (s.current.sessionId !== sessionId) return;
          entry.kind = kind;
          syncQuestions();
        },
        (e) => {
          console.warn("[apprentice] live question not labelled", e);
          entry.kind = "other";
          syncQuestions();
        },
      );
    },
    [clock, syncQuestions],
  );

  const capture = useCallback(
    (kind: Capture["kind"], params: Record<string, unknown>) => {
      const x = s.current;
      const phase = live(x.node) ? "live" : "debrief";
      if (kind === "guardrail" && x.node === "observing" && x.grant === "answer") {
        x.guardrailCaptured = true;
        syncQuestions();
      }
      void post(`/sessions/${x.sessionId}/capture`, { kind, ...params, t: clock(), phase }).catch(
        (e) => console.warn("[apprentice] capture not saved", e),
      );
      const found = toCapture(kind, params);
      if (!found.title) return "Nothing to record.";
      const item: Capture = { ...found, ...latest.current.moment() };
      latest.current.onCapture?.(item, x.node);
      setState((st) => {
        const last = st.exchanges.at(-1);
        const exchanges =
          last && kind !== "open_question"
            ? [...st.exchanges.slice(0, -1), { ...last, captured: true }]
            : st.exchanges;
        return { ...st, exchanges, captures: [...st.captures, item] };
      });
      return "Recorded.";
    },
    [clock, syncQuestions],
  );

  const merge = useCallback(
    async (final: boolean, extra: Record<string, unknown> = {}) => {
      const x = s.current;
      setState((st) => ({ ...st, merging: true }));
      try {
        return await post<{ brief: string; summary: string; open_questions?: unknown }>(
          `/sessions/${x.sessionId}/merge`,
          { final, transcript: x.transcript, duration: clock(), ...extra },
        );
      } finally {
        setState((st) => ({ ...st, merging: false }));
      }
    },
    [clock],
  );

  /** The session ended without a confirmed map: save what was learned as a draft. */
  const saveDraft = useCallback(() => {
    const x = s.current;
    if (x.node === "end") return; // confirm_work_map already saved it
    if (!x.transcript.some((l) => l.role === "expert")) {
      // Nothing to keep: drop the session, its screen moments and its recording from the database.
      setState((st) => ({ ...st, saved: "empty" }));
      void backendFetch(`/api/v1/sessions/${x.sessionId}`, { method: "DELETE" }).catch((e) =>
        console.warn("[apprentice] empty session not discarded", e),
      );
      return;
    }
    setState((st) => ({ ...st, saved: "saving" }));
    merge(false).then(
      () => setState((st) => ({ ...st, saved: "saved" })),
      (e) => {
        console.warn("[apprentice] draft not saved", e);
        setState((st) => ({ ...st, saved: "failed" }));
      },
    );
  }, [merge]);

  /** The agent's "said" only if the expert really said it lately; it becomes their quote in the map. */
  const spoken = (said: string) => {
    const words = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const recent = words(
      s.current.transcript
        .filter((l) => l.role === "expert")
        .slice(-3)
        .map((l) => l.text)
        .join(" "),
    );
    return said && recent.includes(words(said)) ? said : "";
  };

  // Built once: everything the tools use is a ref or a stable callback.
  const clientTools = useRef({
    begin_observation: async (p: Record<string, unknown>) => {
      const x = s.current;
      const task = str(p["task"]);
      const now = performance.now();
      x.observingSince = now;
      x.floorOpenUntil = now + 10_000; // for "Go ahead."
      x.grant = "start";
      setNode("observing");
      setState((st) => ({ ...st, task: task || null }));
      const go = "Watching now. Say 'Go ahead.' and then stay quiet until a [PAUSE].";
      if (!task) return go;
      // Naming the task is what lets the backend look up what the apprentice
      // already learned about it, so it arrives with the answer to this call.
      try {
        const { known } = await atMost(
          post<{ known?: string }>(`/sessions/${x.sessionId}/task`, { task }),
          4000,
          {},
        );
        if (known) {
          setState((st) => ({ ...st, known }));
          return `${go}\n\n${known}`;
        }
      } catch {
        // A session with no memory is the old behaviour, not a broken one.
      }
      return go;
    },
    record_step: (p: Record<string, unknown>) => capture("step", p),
    record_guardrail: (p: Record<string, unknown>) => capture("guardrail", p),
    note_open_question: (p: Record<string, unknown>) => capture("open_question", p),
    record_correction: (p: Record<string, unknown>) => capture("correction", p),
    start_debrief: async () => {
      setNode("debrief");
      try {
        const result = await merge(false);
        const gaps = result.open_questions;
        s.current.gaps = Array.isArray(gaps) ? gaps.map(str).filter(Boolean) : [];
        return result.brief;
      } catch (e) {
        console.warn("[apprentice] draft merge failed", e);
        return "The draft Work Map could not be built. Ask about the exceptions, limits and the moments to stop and ask that you noticed.";
      }
    },
    start_teach_back: () => {
      const x = s.current;
      if (x.node === "debrief") {
        const status = debriefStatus({
          asked: x.debriefQuestions,
          gaps: x.gaps,
          refusals: x.teachBackRefusals,
          minDebrief: x.policy.minDebrief,
        });
        const asked = x.debriefQuestions.length;
        if (status.met && status.remaining > 0)
          console.info(
            `[debrief] teach-back let through after ${x.teachBackRefusals} refusals: ${asked} of ${x.policy.minDebrief} questions counted`,
          );
        if (!status.met) {
          x.teachBackRefusals += 1;
          console.log(`[debrief] teach-back refused: ${asked} of ${x.policy.minDebrief}`);
          const reply = notYetReply(asked, status, x.policy.minDebrief);
          // The agent doesn't wait for this tool's reply, so it also hears it as a message.
          conv.current?.sendUserMessage(`[NOT YET] ${reply}`);
          return reply;
        }
      }
      if (x.node !== "teach_back") {
        // An explanation spoken before this call landed is part of the teach-back.
        const lastExpert = x.transcript.map((l) => l.role).lastIndexOf("expert");
        x.teachBack = x.transcript.slice(lastExpert + 1).map((l) => l.text);
        x.teachBackReply = null;
      }
      setNode("teach_back");
      return "Explain it back now.";
    },
    confirm_work_map: async () => {
      const x = s.current;
      if (x.node === "end")
        return "The Work Map is already saved. Use edit_work_map for any change the expert asks for.";
      const status =
        x.node === "teach_back"
          ? teachBackStatus({
              explained: x.teachBack,
              confirmedBy: x.teachBackReply?.text ?? "",
              refusals: x.explainRefusals,
            })
          : "explain_first";
      if (
        x.node === "teach_back" &&
        status !== "explain_first" &&
        x.explainRefusals >= MAX_EXPLAIN_REFUSALS
      )
        console.info(`[teach-back] explanation taken as given after ${x.explainRefusals} refusals`);
      if (status === "explain_first") {
        if (x.node === "teach_back") x.explainRefusals += 1;
        return `Not saved: ${x.node === "teach_back" ? "" : "call start_teach_back, then "}sum the task up back first (short is fine), then ask whether that is right; call confirm_work_map only after the expert says yes.`;
      }
      if (status === "await_confirmation")
        return "Not saved: ask the expert whether that is right and wait for their answer.";
      if (status === "not_confirmed")
        return "Not saved: the expert hasn't said yes yet. If they corrected you, call record_correction and say the corrected part back first, then ask again.";
      const reply = x.teachBackReply!;
      const confirmation = { teach_back: x.teachBack.join(" "), said: reply.text, t: reply.t };
      try {
        const result = await merge(true, { confirmation });
        setState((st) => ({ ...st, confirmed: true, saved: "saved" }));
        setNode("end");
        return `Saved. The Work Map as saved (ids are for edit_work_map):\n${result.summary}\n\nTell the expert in one sentence that it is saved, ask whether they would like to change anything, and wait for their answer. Do not call end_call yet.`;
      } catch (e) {
        console.warn("[apprentice] final merge failed", e);
        return "Saving failed. Tell the expert the Work Map could not be saved and ask whether to try again; if they say yes, call confirm_work_map again.";
      }
    },
    edit_work_map: async (p: Record<string, unknown>) => {
      const x = s.current;
      const response = await backendFetch(`/api/v1/sessions/${x.sessionId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, said: spoken(str(p["said"])), t: clock() }),
      }).catch(() => null);
      if (!response)
        return "The edit could not reach the backend. Tell the expert and offer to try again.";
      const body = (await response.json().catch(() => ({}))) as {
        change?: string;
        stale?: string;
        summary?: string;
        detail?: string;
      };
      if (!response.ok)
        return `Not changed: ${body.detail ?? `the backend answered ${response.status}`}. Ask the expert which item they mean, or what it should say.`;
      const item: Capture = {
        kind: "correction",
        title: body.change ?? "Work Map changed",
        detail: str(p["said"]),
        ...latest.current.moment(),
      };
      latest.current.onCapture?.(item, x.node);
      setState((st) => ({ ...st, captures: [...st.captures, item] }));
      const next = body.stale
        ? `These fields still carry the old value: ${body.stale}. Call edit_work_map to change only those fields so the map agrees, then say the new version back in one short sentence and ask if that is right.`
        : "Say the new version back in one short sentence and ask if that is right.";
      return `Done: ${body.change}. The Work Map now:\n${body.summary}\n\n${next}`;
    },
    read_work_map: async () => {
      const x = s.current;
      const response = await backendFetch(`/api/v1/sessions/${x.sessionId}/summary`).catch(
        () => null,
      );
      if (!response?.ok)
        return "The Work Map is not saved yet, or the backend could not be reached. Go on from what you remember.";
      const body = (await response.json()) as { summary: string };
      return `The Work Map as saved (ids are for edit_work_map):\n${body.summary}\n\nRead the items one at a time, starting where the expert asked, and after each ask whether it is right.`;
    },
  });

  const release = useCallback((error?: string) => {
    const c = conv.current;
    conv.current = null;
    if (c?.isOpen()) void c.endSession().catch(() => undefined);
    setLevel(0);
    setState((st) => ({
      ...st,
      status: "closed",
      botSpeaking: false,
      userSpeaking: false,
      merging: false,
      error: error ?? st.error,
    }));
  }, []);

  const start = useCallback(
    async (language: LanguageChoice = "auto") => {
      if (conv.current) return;
      const sessionId = crypto.randomUUID();
      // "Record again" on a Work Map: this session's debrief asks the questions kept there first.
      // Cleared once connected, so a start that fails can be retried with the same link.
      const parent = peekNextSession();
      // Read once per session: changing Settings mid-session doesn't move the goalposts.
      const policy = policyFrom(loadSettings());
      s.current = {
        ...s.current,
        sessionId,
        startedAt: 0,
        node: "session_start",
        transcript: [],
        offRecord: false,
        lastSpeechAt: -Infinity,
        lastActivityAt: -Infinity,
        pending: [],
        questionTimes: [],
        lastPauseAt: -Infinity,
        inferring: false,
        floorOpenUntil: -Infinity,
        grant: null,
        lastDirectQuestionAt: -Infinity,
        muted: false,
        gated: false,
        agentSpeaking: false,
        taskDone: false,
        asked: [],
        pauseReply: false,
        guardrailCaptured: false,
        agentDoneAt: -Infinity,
        recent: [],
        wrapUp: false,
        wrapUpPrompts: 0,
        wrapUpLimit: 0,
        gaps: [],
        debriefQuestions: [],
        teachBack: [],
        teachBackReply: null,
        teachBackRefusals: 0,
        explainRefusals: 0,
        policy,
      };
      setState({ ...initialState, status: "connecting", minDebrief: policy.minDebrief });
      try {
        const [{ token }, known] = await Promise.all([
          backendFetch("/api/v1/agent/token").then((r) => {
            if (!r.ok) throw new Error(`token request answered ${r.status}`);
            return r.json() as Promise<{ token: string }>;
          }),
          // The tasks it has learned before. Never fatal: an apprentice that
          // remembers nothing is the old behaviour, not a broken session.
          atMost(
            backendFetch("/api/v1/brain")
              .then((r) => (r.ok ? (r.json() as Promise<{ known: string }>) : null))
              .then((r) => r?.known ?? "")
              .catch(() => ""),
            4000,
            "",
          ),
        ]);
        try {
          await post(`/sessions/${sessionId}/start`, parent ? { parent_work_map_id: parent } : {});
        } catch (e) {
          if (!parent || !parentRefused(e)) throw e;
          // The map was deleted since "Record again": record a new session instead.
          console.warn(`Recording without the Work Map it was started from: ${String(e)}`);
          clearNextSession();
          await post(`/sessions/${sessionId}/start`, {});
        }
        const c = await VoiceConversation.startSession({
          conversationToken: token,
          connectionType: "webrtc",
          dynamicVariables: { known: known || "You have not learned any task yet." },
          // The expert's language; on Auto the agent starts in English and follows them.
          ...(language !== "auto" && { overrides: { agent: { language } } }),
          clientTools: clientTools.current,
          onConnect({ conversationId }) {
            s.current.startedAt = performance.now();
            setSession({ id: sessionId, clock });
            setState((st) => ({ ...st, status: "connected" }));
            // The first start already linked the parent: the link is used up.
            if (parent) clearNextSession();
            void post(`/sessions/${sessionId}/start`, { conversation_id: conversationId }).catch(
              () => undefined,
            );
          },
          onModeChange({ mode }) {
            const x = s.current;
            if (mode === "speaking") {
              x.agentSpeaking = true;
              gate();
            } else {
              x.agentSpeaking = false;
              x.agentDoneAt = performance.now();
              endUtterance();
            }
            setState((st) => ({ ...st, botSpeaking: mode === "speaking" && !x.muted }));
          },
          onMessage({ message, role }) {
            const x = s.current;
            const text = message.trim();
            if (!text) return;
            const phase = live(x.node) ? "live" : "debrief";
            if (role === "agent") {
              if (!gate()) return; // muted: the expert never heard it, so it is not part of the record
              x.transcript.push({ role: "apprentice", text, t: clock(), phase });
              if (x.node === "debrief" && isDebriefQuestion(text)) {
                x.debriefQuestions.push(text);
                const debriefAsked = x.debriefQuestions.length;
                setState((st) => ({ ...st, debriefAsked }));
              } else if (x.node === "teach_back") {
                x.teachBack.push(text);
                // Asking again (after a correction): the expert's earlier answer no longer counts.
                if (isQuestion(text)) x.teachBackReply = null;
              }
              if (x.grant === "start") {
                // One-shot: only the "Go ahead." right after begin_observation is skipped, so later
                // lines (live questions, the debrief, the teach-back) still reach the pill.
                x.grant = null;
                if (x.node === "observing" && !isQuestion(text)) return;
              }
              if (x.pauseReply) {
                x.pauseReply = false;
                // Only a question counts: "Got it." at a pause is not one.
                if (x.node === "observing" && isQuestion(text)) countQuestion(text);
              }
              const moment = latest.current.moment();
              setState((st) => ({
                ...st,
                exchanges: [
                  ...st.exchanges,
                  { ...moment, node: x.node, question: text, answer: "", captured: false },
                ],
              }));
              return;
            }
            // Messages the pill sent on the expert's behalf ([PAUSE], [SKIP], ...) are not their words.
            if (text.startsWith("[")) return;
            x.transcript.push({ role: "expert", text, t: clock(), phase });
            // What the expert said once the teach-back is under way: their answer to it.
            if (x.node === "teach_back" && x.teachBack.length > 0)
              x.teachBackReply = { text, t: clock() };
            if (x.node === "observing" && endsWithQuestion(text))
              x.lastDirectQuestionAt = performance.now();
            setState((st) => {
              const last = st.exchanges.at(-1);
              if (!last) return st;
              const answer = last.answer ? `${last.answer} ${text}` : text;
              return { ...st, exchanges: [...st.exchanges.slice(0, -1), { ...last, answer }] };
            });
          },
          onVadScore({ vadScore }) {
            if (vadScore >= VAD_SPEECH) s.current.lastSpeechAt = performance.now();
          },
          onDisconnect(details) {
            if (conv.current !== c) return;
            const error =
              details.reason === "error"
                ? `The voice connection dropped: ${details.message}`
                : details.reason === "agent" && s.current.node !== "end"
                  ? "The apprentice ended the call early. Start a new session to retry."
                  : undefined;
            saveDraft();
            release(error);
          },
          onError(message) {
            setState((st) => ({ ...st, error: message || "Voice connection failed." }));
          },
        });
        conv.current = c;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        release(`Could not start the apprentice.${message ? ` ${message}` : ""}`);
      }
    },
    [clock, countQuestion, endUtterance, gate, release, saveDraft],
  );

  /** End the session. Unless the map was confirmed, what was captured is still saved as a draft. */
  const stop = useCallback(() => {
    if (conv.current) saveDraft();
    release();
  }, [saveDraft, release]);

  const reset = useCallback(() => {
    stop();
    setSession(null);
    setState(initialState);
  }, [stop]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    conv.current?.setMicMuted(!enabled);
  }, []);

  /** Off the record: the agent is told to disregard what happens until the expert is back. */
  const setOffRecord = useCallback(
    (off: boolean) => {
      const x = s.current;
      if (x.offRecord === off) return;
      x.offRecord = off;
      x.pending = [];
      conv.current?.sendContextualUpdate(
        off
          ? `[OFF THE RECORD ${mmss(clock())}] The expert went off the record. Ignore what happens until they are back, and never ask about it.`
          : `[BACK ON THE RECORD ${mmss(clock())}] The expert is back on the record.`,
      );
    },
    [clock],
  );

  /** The task is over: hand over to the debrief. */
  const finishWork = useCallback(() => {
    const x = s.current;
    if (x.taskDone) return;
    x.taskDone = true;
    if (x.wrapUp && !questionsMet(x))
      console.log(
        `[floor] debrief with ${counted(x)} of ${x.policy.minLive} live questions, guardrail ${guardrailAsked(x) ? "asked" : "not asked"}`,
      );
    x.wrapUp = false;
    setState((st) => ({ ...st, wrapUp: false }));
    conv.current?.sendUserMessage(
      "[TASK DONE] The expert pressed End: the task is finished. Call start_debrief now.",
    );
  }, []);

  /** Ask one of the questions still missing, about what the expert just did. */
  const askWrapUp = useCallback(() => {
    const x = s.current;
    const need = x.policy.minLive - counted(x);
    const howMany =
      need > 0 ? `${need} more live question${need === 1 ? "" : "s"}` : "one more live question";
    const guardrail = guardrailAsked(x)
      ? ""
      : " Make this one about a guardrail: a limit, an exception or when they would stop and ask someone.";
    const screen = x.recent.map((e) => `[${mmss(e.t)}] ${e.text}`).join("; ") || "(nothing recent)";
    const now = performance.now();
    x.wrapUpPrompts += 1;
    x.lastPauseAt = now;
    x.floorOpenUntil = now + PAUSE_GRANT_MS;
    x.grant = "pause";
    console.log(`[floor] wrap-up ${x.wrapUpPrompts}: ${howMany}${guardrail ? ", guardrail" : ""}`);
    conv.current?.sendUserMessage(
      `[PAUSE] The expert pressed End and is waiting for you. Before the debrief you still need ${howMany}, about what they did on screen: ${screen}.${guardrail} Ask one short question now and wait for the answer. Do not call start_debrief yet.`,
    );
  }, []);

  /** End was pressed before the live questions were asked: ask them now, then debrief. */
  const startWrapUp = useCallback(() => {
    const x = s.current;
    x.wrapUp = true;
    x.wrapUpPrompts = 0;
    x.wrapUpLimit = wrapUpLimit(counted(x), x.policy);
    setState((st) => ({ ...st, wrapUp: true }));
    askWrapUp();
  }, [askWrapUp]);

  /** One of the pill's controls. */
  const send = useCallback(
    (type: "work.end" | "question.later" | "debrief.skip", data: Record<string, unknown> = {}) => {
      const c = conv.current;
      const x = s.current;
      if (!c) return;
      if (type === "work.end" && live(x.node)) {
        if (x.taskDone) return;
        // Pressed again during the wrap-up: the expert wants the debrief now.
        if (x.wrapUp || x.node !== "observing" || questionsMet(x)) finishWork();
        else startWrapUp();
      } else if (type === "question.later" && x.node === "observing") {
        // The question this pause was given no longer counts as asked.
        const q = x.asked.at(-1);
        if (q && !q.deferred && q.at >= x.lastPauseAt) {
          q.deferred = true;
          x.questionTimes = x.questionTimes.filter((at) => at !== q.at);
          syncQuestions();
          void post(`/sessions/${x.sessionId}/live_question/defer`, { t: q.t }).catch(
            () => undefined,
          );
        }
        if (x.agentSpeaking) {
          x.muted = true;
          c.setVolume({ volume: 0 });
        }
        x.floorOpenUntil = -Infinity;
        c.sendContextualUpdate(
          "[NOT NOW] The expert is busy. Keep that question for the debrief and stay quiet.",
        );
        const question = str(data["question"]);
        if (question) capture("open_question", { question, screen_time: mmss(clock()) });
      } else if (type === "debrief.skip" && x.node === "debrief") {
        // A skipped question doesn't count toward the debrief.
        const last = x.transcript.at(-1);
        if (last?.role === "apprentice" && last.text === x.debriefQuestions.at(-1)) {
          x.debriefQuestions.pop();
          const debriefAsked = x.debriefQuestions.length;
          setState((st) => ({ ...st, debriefAsked }));
        }
        c.sendUserMessage("[SKIP] Skip that question and ask your next one.");
      }
    },
    [capture, clock, finishWork, startWrapUp, syncQuestions],
  );

  /** Something changed on screen: tell the agent silently, and note it as a step to maybe ask about. */
  const reportScreen = useCallback(
    (event: ScreenEvent) => {
      const x = s.current;
      if (!conv.current || x.offRecord) return;
      const t = clock();
      conv.current.sendContextualUpdate(`[SCREEN ${mmss(t)}] ${event.event}`);
      x.recent = [...x.recent, { t, text: event.event }].slice(-6);
      if (x.node === "observing")
        x.pending.push({ at: performance.now(), kind: event.kind, text: event.event, t });
    },
    [clock],
  );

  /** The screen is moving (typing, scrolling): keep the agent from starting to speak. */
  const reportActivity = useCallback(() => {
    const x = s.current;
    const now = performance.now();
    x.lastActivityAt = now;
    if (conv.current && now - x.lastUserActivitySent > USER_ACTIVITY_EVERY_MS) {
      x.lastUserActivitySent = now;
      conv.current.sendUserActivity();
    }
  }, []);

  // The floor: while the expert works, offer the agent a question only at a natural pause.
  useEffect(() => {
    if (state.status !== "connected") return;
    const timer = window.setInterval(() => {
      const x = s.current;
      const c = conv.current;
      const now = performance.now();
      const speaking = now - x.lastSpeechAt < 400;
      setState((st) => (st.userSpeaking === speaking ? st : { ...st, userSpeaking: speaking }));
      if (!c || x.node !== "observing" || x.offRecord) return;
      if (x.wrapUp) {
        const next = decideWrapUp({
          now,
          speaking,
          agentSpeaking: x.agentSpeaking,
          lastSpeechAt: x.lastSpeechAt,
          agentDoneAt: x.agentDoneAt,
          grant: x.grant,
          floorOpenUntil: x.floorOpenUntil,
          lastPauseAt: x.lastPauseAt,
          last: x.asked.at(-1),
          met: questionsMet(x),
          prompts: x.wrapUpPrompts,
          limit: x.wrapUpLimit,
        });
        if (next === "ask") askWrapUp();
        else if (next === "finish") finishWork();
        return;
      }
      const floor = decideFloor(
        {
          now,
          observingSince: x.observingSince,
          speaking,
          lastSpeechAt: x.lastSpeechAt,
          lastActivityAt: x.lastActivityAt,
          agentSpeaking: x.agentSpeaking,
          pending: x.pending,
          questionTimes: x.questionTimes,
          lastPauseAt: x.lastPauseAt,
        },
        x.policy,
      );
      setState((st) => (st.floor === floor ? st : { ...st, floor }));
      if (floor !== "ask" || x.inferring) return;
      // Before offering a question, ask the backend what is already clear (lib/floor pauseCue).
      const offered = x.pending;
      const events = offered.slice(-5).map((e) => `[${mmss(e.t)}] ${e.text}`);
      const lines = x.transcript.slice(-INFER_LINES).map(({ role, text }) => ({ role, text }));
      const sessionId = x.sessionId;
      x.inferring = true;
      void inferPause(sessionId, events, lines).then((inferred) => {
        const y = s.current;
        if (y.sessionId !== sessionId) return;
        y.inferring = false;
        const now = performance.now();
        // The moment passed while waiting (End, off the record, talking or typing again):
        // the events stay pending for the next pause.
        if (conv.current !== c || y.node !== "observing" || y.wrapUp || y.offRecord) return;
        if (now - y.lastSpeechAt < SPEECH_QUIET_MS || y.lastActivityAt > now - SCREEN_QUIET_MS)
          return;
        y.pending = y.pending.filter((e) => !offered.includes(e));
        const steps = events.join("; ");
        const asked = counted(y);
        const cue = pauseCue(steps, pauseAsk(asked, guardrailAsked(y), y.policy), inferred);
        if (!cue) {
          // Nothing worth asking: no [PAUSE], nothing counted. The wrap-up still asks the minimum.
          console.log(`[floor] pause skipped, nothing worth asking after: ${steps}`);
          return;
        }
        y.lastPauseAt = now;
        y.floorOpenUntil = now + PAUSE_GRANT_MS;
        y.grant = "pause";
        console.log(`[floor] pause ${asked + 1} after: ${steps}`);
        c.sendUserMessage(cue);
      });
    }, 400);
    return () => clearInterval(timer);
  }, [state.status, askWrapUp, finishWork]);

  // Microphone level for the waveform.
  useEffect(() => {
    if (state.status !== "connected") return;
    const timer = window.setInterval(() => setLevel(conv.current?.getInputVolume() ?? 0), 80);
    return () => clearInterval(timer);
  }, [state.status]);

  useEffect(
    () => () => {
      const c = conv.current;
      conv.current = null;
      if (c?.isOpen()) void c.endSession().catch(() => undefined);
    },
    [],
  );

  return {
    ...state,
    level,
    session,
    start,
    stop,
    reset,
    setMicEnabled,
    setOffRecord,
    send,
    reportScreen,
    reportActivity,
  };
}
