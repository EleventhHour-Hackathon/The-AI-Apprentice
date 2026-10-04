import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceConversation } from "@elevenlabs/client";
import { BACKEND_URL } from "@/lib/backend";
import { decideFloor, type Floor, type ScreenKind } from "@/lib/floor";
import type { ScreenEvent } from "@/hooks/use-screen-events";

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
  /** The Work Map is being merged (start of the debrief, or after the teach-back). */
  merging: boolean;
  /** Why the apprentice is or isn't asking right now (see lib/floor.ts). */
  floor: Floor;
  exchanges: Exchange[];
  captures: Capture[];
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
  merging: false,
  floor: "quiet",
  exchanges: [],
  captures: [],
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
const live = (node: FlowNode) => node === "session_start" || node === "observing";

/** Resolve to `fallback` if `work` has not finished in `ms`. */
function atMost<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
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
 * One voice session with the AI Apprentice agent on ElevenLabs (ElevenAgents).
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
  });
  const clock = useCallback(
    () => (s.current.startedAt ? (performance.now() - s.current.startedAt) / 1000 : 0),
    [],
  );

  const setNode = useCallback((node: FlowNode) => {
    s.current.node = node;
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
      // A live question at a pause: it counts against the budget, and the answer gets a window.
      x.questionTimes.push(now);
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

  const capture = useCallback(
    (kind: Capture["kind"], params: Record<string, unknown>) => {
      const x = s.current;
      const phase = live(x.node) ? "live" : "debrief";
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
    [clock],
  );

  const merge = useCallback(
    async (final: boolean) => {
      const x = s.current;
      setState((st) => ({ ...st, merging: true }));
      try {
        return await post<{ brief: string }>(`/sessions/${x.sessionId}/merge`, {
          final,
          transcript: x.transcript,
          duration: clock(),
        });
      } finally {
        setState((st) => ({ ...st, merging: false }));
      }
    },
    [clock],
  );

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
        return result.brief;
      } catch (e) {
        console.warn("[apprentice] draft merge failed", e);
        return "The draft Work Map could not be built. Ask about the exceptions, limits and the moments to stop and ask that you noticed.";
      }
    },
    start_teach_back: () => {
      setNode("teach_back");
      return "Explain it back now.";
    },
    confirm_work_map: async () => {
      try {
        await merge(true);
        setState((st) => ({ ...st, confirmed: true }));
        setNode("end");
        return "Saved. Thank them in one sentence, then call end_call.";
      } catch (e) {
        console.warn("[apprentice] final merge failed", e);
        return "Saving failed. Tell the expert the Work Map could not be saved, then call end_call.";
      }
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

  const start = useCallback(async () => {
    if (conv.current) return;
    const sessionId = crypto.randomUUID();
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
      floorOpenUntil: -Infinity,
      grant: null,
      lastDirectQuestionAt: -Infinity,
      muted: false,
      gated: false,
      agentSpeaking: false,
      taskDone: false,
    };
    setState({ ...initialState, status: "connecting" });
    try {
      const [{ token }, known] = await Promise.all([
        fetch(`${BACKEND_URL}/api/v1/agent/token`).then((r) => {
          if (!r.ok) throw new Error(`token request answered ${r.status}`);
          return r.json() as Promise<{ token: string }>;
        }),
        // The tasks it has learned before. Never fatal: an apprentice that
        // remembers nothing is the old behaviour, not a broken session.
        atMost(
          fetch(`${BACKEND_URL}/api/v1/brain`)
            .then((r) => (r.ok ? (r.json() as Promise<{ known: string }>) : null))
            .then((r) => r?.known ?? "")
            .catch(() => ""),
          4000,
          "",
        ),
      ]);
      await post(`/sessions/${sessionId}/start`, {});
      const c = await VoiceConversation.startSession({
        conversationToken: token,
        connectionType: "webrtc",
        dynamicVariables: { known: known || "You have not learned any task yet." },
        clientTools: clientTools.current,
        onConnect({ conversationId }) {
          s.current.startedAt = performance.now();
          setSession({ id: sessionId, clock });
          setState((st) => ({ ...st, status: "connected" }));
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
            if (x.grant === "start") return; // "Go ahead." is not a question
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
          if (x.node === "observing" && text.endsWith("?"))
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
  }, [clock, endUtterance, gate, release]);

  /** End the session. Unless the map was confirmed, what was captured is still saved as a draft. */
  const stop = useCallback(() => {
    const x = s.current;
    if (conv.current && x.node !== "end" && x.transcript.some((l) => l.role === "expert"))
      void merge(false).catch(() => undefined);
    release();
  }, [merge, release]);

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

  /** One of the pill's controls. */
  const send = useCallback(
    (type: "work.end" | "question.later" | "debrief.skip", data: Record<string, unknown> = {}) => {
      const c = conv.current;
      const x = s.current;
      if (!c) return;
      if (type === "work.end" && live(x.node)) {
        if (x.taskDone) return;
        x.taskDone = true;
        c.sendUserMessage(
          "[TASK DONE] The expert pressed End: the task is finished. Call start_debrief now.",
        );
      } else if (type === "question.later" && x.node === "observing") {
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
        c.sendUserMessage("[SKIP] Skip that question and ask your next one.");
      }
    },
    [capture, clock],
  );

  /** Something changed on screen: tell the agent silently, and note it as a step to maybe ask about. */
  const reportScreen = useCallback(
    (event: ScreenEvent) => {
      const x = s.current;
      if (!conv.current || x.offRecord) return;
      const t = clock();
      conv.current.sendContextualUpdate(`[SCREEN ${mmss(t)}] ${event.event}`);
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
      const floor = decideFloor({
        now,
        observingSince: x.observingSince,
        speaking,
        lastSpeechAt: x.lastSpeechAt,
        lastActivityAt: x.lastActivityAt,
        agentSpeaking: x.agentSpeaking,
        pending: x.pending,
        questionTimes: x.questionTimes,
        lastPauseAt: x.lastPauseAt,
      });
      setState((st) => (st.floor === floor ? st : { ...st, floor }));
      if (floor !== "ask") return;
      const steps = x.pending
        .slice(-5)
        .map((e) => `[${mmss(e.t)}] ${e.text}`)
        .join("; ");
      x.pending = [];
      x.lastPauseAt = now;
      x.floorOpenUntil = now + PAUSE_GRANT_MS;
      x.grant = "pause";
      console.log(`[floor] pause after: ${steps}`);
      c.sendUserMessage(
        `[PAUSE] The expert has stopped after: ${steps}. If one of these hides a reason, a limit or a moment to stop and ask, ask one short question about it now. Otherwise call skip_turn.`,
      );
    }, 400);
    return () => clearInterval(timer);
  }, [state.status]);

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
