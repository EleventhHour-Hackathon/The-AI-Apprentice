import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceConversation } from "@elevenlabs/client";
import { BACKEND_URL } from "@/lib/backend";
import type { ScreenEvent } from "@/hooks/use-screen-events";

/** A step of the Work Map, as the tutor teaches it (with the expert's screen moment). */
export type LessonStep = {
  id: string;
  title: string;
  decision: string;
  reason: string;
  quote: string;
  judgment: boolean;
  at: number | null;
  thumb: string | null;
  event: string | null;
};
type Lesson = { lesson_id: string; task: string; work_map: string; steps: LessonStep[] };

/** What the tutor is doing about the new hire's work right now. */
export type Cue =
  | { type: "predict"; step: string }
  | { type: "stop"; step: string; guardrail: string; what: string; expected: string }
  | { type: "fixed"; step: string }
  | null;

type ReportItem = {
  step: string;
  title: string;
  why?: string;
  expected?: string;
  expert_words?: string;
};
export type LessonReport = {
  mastered: ReportItem[];
  practice: ReportItem[];
  not_covered: ReportItem[];
  summary: string;
};

type CheckResult = {
  verdict: "intervene" | "fixed" | "ok" | "none";
  step: string;
  guardrail: string;
  what_happened: string;
  expected: string;
  next_step: string;
};
type Line = { role: "learner" | "tutor"; text: string; t: number };

type TutorState = {
  status: "idle" | "connecting" | "connected" | "closed";
  error: string | null;
  task: string | null;
  steps: LessonStep[];
  botSpeaking: boolean;
  userSpeaking: boolean;
  /** The tutor's latest words, and the new hire's reply to them. */
  said: string;
  heard: string;
  cue: Cue;
  /** The expert's screen moment being replayed. */
  replay: LessonStep | null;
  report: LessonReport | null;
  finishing: boolean;
};

const initialState: TutorState = {
  status: "idle",
  error: null,
  task: null,
  steps: [],
  botSpeaking: false,
  userSpeaking: false,
  said: "",
  heard: "",
  cue: null,
  replay: null,
  report: null,
  finishing: false,
};

/** Quiet this long (no speech, no screen movement) before asking for a prediction or explaining. */
const QUIET_MS = 2500;
/** At least this long between cues the tutor wasn't forced to give. */
const CUE_GAP_MS = 15_000;
const VAD_SPEECH = 0.6;

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function post<T = unknown>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${BACKEND_URL}/api/v1${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((b: { detail?: string }) => b.detail)
      .catch(() => undefined);
    throw new Error(detail ?? `${path} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * A lesson: the new hire works a case on their own screen while the tutor
 * agent (ElevenLabs) watches, taught from one Work Map.
 *
 * Each action on screen is checked against the expert's steps and guardrails
 * (backend /lessons/{id}/check). A wrong decision makes the tutor step in at
 * once, before it is saved, with the expert's screen moment replayed; a
 * judgment call coming up gets a prediction question at the next pause.
 */
export function useTutor() {
  const conv = useRef<VoiceConversation | null>(null);
  const [state, setState] = useState(initialState);
  const [level, setLevel] = useState(0);
  const [session, setSession] = useState<{ id: string; clock: () => number } | null>(null);
  const s = useRef({
    lessonId: "",
    startedAt: 0,
    steps: [] as LessonStep[],
    transcript: [] as Line[],
    history: [] as { t: number; event: string }[],
    flags: [] as { step: string; what_happened: string }[],
    checking: Promise.resolve() as Promise<void>,
    /** Cues that wait for a pause: predictions and explanations. */
    queued: [] as { kind: "predict" | "done"; step: string }[],
    predicted: new Set<string>(),
    explained: new Set<string>(),
    acted: new Set<string>(),
    lastSpeechAt: -Infinity,
    lastActivityAt: -Infinity,
    lastCueAt: -Infinity,
    agentSpeaking: false,
  });
  const clock = useCallback(
    () => (s.current.startedAt ? (performance.now() - s.current.startedAt) / 1000 : 0),
    [],
  );
  const step = useCallback((id: string) => s.current.steps.find((x) => x.id === id) ?? null, []);

  const attempt = useCallback(
    (a: Record<string, unknown>) => {
      void post(`/lessons/${s.current.lessonId}/attempt`, { ...a, t: clock() }).catch((e) =>
        console.warn("[tutor] attempt not saved", e),
      );
    },
    [clock],
  );

  const clientTools = useRef({
    show_expert_moment: (p: Record<string, unknown>) => {
      const found = step(String(p["step_id"] ?? ""));
      if (!found) return "No such step.";
      setState((st) => ({ ...st, replay: found }));
      return found.thumb
        ? "Showing the expert's screen now."
        : "There is no screen moment for that step; describe it instead.";
    },
    record_prediction: (p: Record<string, unknown>) => {
      const id = String(p["step_id"] ?? "");
      attempt({
        type: "prediction",
        step: id,
        correct: Boolean(p["correct"]),
        answer: String(p["answer"] ?? ""),
      });
      setState((st) => (st.cue?.type === "predict" ? { ...st, cue: null } : st));
      return "Recorded.";
    },
    finish_lesson: async () => {
      const x = s.current;
      setState((st) => ({ ...st, finishing: true, cue: null }));
      try {
        const report = await post<LessonReport>(`/lessons/${x.lessonId}/finish`, {
          transcript: x.transcript,
        });
        setState((st) => ({ ...st, report, finishing: false }));
        return report.summary;
      } catch (e) {
        setState((st) => ({ ...st, finishing: false }));
        console.warn("[tutor] report failed", e);
        return "The report could not be built. Thank them and end the call.";
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
      error: error ?? st.error,
    }));
  }, []);

  const start = useCallback(
    async (workMapId: string) => {
      if (conv.current) return;
      setState({ ...initialState, status: "connecting" });
      try {
        const lesson = await post<Lesson>("/lessons", { work_map_id: workMapId });
        s.current = {
          ...s.current,
          lessonId: lesson.lesson_id,
          startedAt: 0,
          steps: lesson.steps,
          transcript: [],
          history: [],
          flags: [],
          checking: Promise.resolve(),
          queued: [],
          predicted: new Set(),
          explained: new Set(),
          acted: new Set(),
          lastSpeechAt: -Infinity,
          lastActivityAt: -Infinity,
          lastCueAt: -Infinity,
          agentSpeaking: false,
        };
        setState((st) => ({ ...st, task: lesson.task, steps: lesson.steps }));
        const { token } = await fetch(`${BACKEND_URL}/api/v1/agent/token?role=tutor`).then((r) => {
          if (!r.ok) throw new Error(`token request answered ${r.status}`);
          return r.json() as Promise<{ token: string }>;
        });
        const c = await VoiceConversation.startSession({
          conversationToken: token,
          connectionType: "webrtc",
          dynamicVariables: { task: lesson.task, work_map: lesson.work_map },
          clientTools: clientTools.current,
          onConnect({ conversationId }) {
            s.current.startedAt = performance.now();
            setSession({ id: lesson.lesson_id, clock });
            setState((st) => ({ ...st, status: "connected" }));
            void post(`/lessons/${lesson.lesson_id}/start`, {
              conversation_id: conversationId,
            }).catch(() => undefined);
          },
          onModeChange({ mode }) {
            s.current.agentSpeaking = mode === "speaking";
            setState((st) => ({ ...st, botSpeaking: mode === "speaking" }));
          },
          onMessage({ message, role }) {
            const text = message.trim();
            if (!text) return;
            if (role === "agent") {
              s.current.transcript.push({ role: "tutor", text, t: clock() });
              setState((st) => ({ ...st, said: text, heard: "" }));
              return;
            }
            if (text.startsWith("[")) return; // cues the pill sent, not the new hire's words
            s.current.transcript.push({ role: "learner", text, t: clock() });
            setState((st) => ({ ...st, heard: st.heard ? `${st.heard} ${text}` : text }));
          },
          onVadScore({ vadScore }) {
            if (vadScore >= VAD_SPEECH) s.current.lastSpeechAt = performance.now();
          },
          onDisconnect(details) {
            if (conv.current !== c) return;
            release(
              details.reason === "error"
                ? `The voice connection dropped: ${details.message}`
                : undefined,
            );
          },
          onError(message) {
            setState((st) => ({ ...st, error: message || "Voice connection failed." }));
          },
        });
        conv.current = c;
      } catch (error) {
        release(
          `Could not start the lesson. ${error instanceof Error ? error.message : ""}`.trim(),
        );
      }
    },
    [clock, release],
  );

  /** Act on the check of one screen event: step in, confirm a fix, or note a step done right. */
  const act = useCallback(
    (r: CheckResult) => {
      const x = s.current;
      const c = conv.current;
      if (!c) return;
      if (r.step && r.verdict !== "none") {
        x.acted.add(r.step);
        x.queued = x.queued.filter((q) => !(q.kind === "predict" && q.step === r.step));
      }
      if (r.verdict === "intervene") {
        x.flags.push({ step: r.step, what_happened: r.what_happened });
        attempt({
          type: "intervention",
          step: r.step,
          guardrail: r.guardrail,
          what_happened: r.what_happened,
          expected: r.expected,
        });
        x.lastCueAt = performance.now();
        setState((st) => ({
          ...st,
          cue: {
            type: "stop",
            step: r.step,
            guardrail: r.guardrail,
            what: r.what_happened,
            expected: r.expected,
          },
          replay: step(r.step),
        }));
        console.log(`[tutor] STOP ${r.step}: ${r.what_happened}`);
        // Stepping in is the point here: no waiting for a pause.
        c.sendUserMessage(
          `[STOP step=${r.step} guardrail=${r.guardrail || "none"}] The new hire just did: ${r.what_happened}. The expert would: ${r.expected}. Step in now, before they save.`,
        );
      } else if (r.verdict === "fixed") {
        x.flags = x.flags.filter((f) => f.step !== r.step);
        attempt({ type: "fixed", step: r.step });
        setState((st) => ({ ...st, cue: { type: "fixed", step: r.step }, replay: null }));
        c.sendUserMessage(`[FIXED step=${r.step}] They corrected it: ${r.what_happened}.`);
      } else if (r.verdict === "ok") {
        attempt({ type: "done", step: r.step });
        if (step(r.step)?.judgment && !x.explained.has(r.step))
          x.queued.push({ kind: "done", step: r.step });
      }
      const next = r.next_step && step(r.next_step);
      if (next && next.judgment && !x.predicted.has(next.id) && !x.acted.has(next.id))
        if (!x.queued.some((q) => q.step === next.id))
          x.queued.push({ kind: "predict", step: next.id });
    },
    [attempt, step],
  );

  /** Something changed on the new hire's screen: tell the tutor, and check it against the Work Map. */
  const reportScreen = useCallback(
    (e: ScreenEvent) => {
      const x = s.current;
      const c = conv.current;
      if (!c) return;
      const t = clock();
      c.sendContextualUpdate(`[SCREEN ${mmss(t)}] ${e.event}`);
      const history = x.history.slice(-12);
      const flags = () => x.flags;
      x.history.push({ t, event: e.event });
      // One check at a time, in order, so flags and fixes stay consistent.
      x.checking = x.checking.then(async () => {
        try {
          const r = await post<CheckResult>(`/lessons/${x.lessonId}/check`, {
            event: e.event,
            history,
            open_flags: flags(),
          });
          act(r);
        } catch (err) {
          console.warn("[tutor] check failed", err);
        }
      });
    },
    [act, clock],
  );

  const reportActivity = useCallback(() => {
    const x = s.current;
    x.lastActivityAt = performance.now();
  }, []);

  /** The new hire says the case is done. */
  const finish = useCallback(() => {
    conv.current?.sendUserMessage("[LESSON DONE] The case is finished. Call finish_lesson now.");
  }, []);

  const stop = useCallback(() => release(), [release]);
  const reset = useCallback(() => {
    release();
    setSession(null);
    setState(initialState);
  }, [release]);
  const dismissReplay = useCallback(() => setState((st) => ({ ...st, replay: null })), []);
  const setMicEnabled = useCallback((enabled: boolean) => conv.current?.setMicMuted(!enabled), []);

  // Predictions and explanations wait for a natural pause; interventions never do.
  useEffect(() => {
    if (state.status !== "connected") return;
    const timer = window.setInterval(() => {
      const x = s.current;
      const c = conv.current;
      const now = performance.now();
      const speaking = now - x.lastSpeechAt < 400;
      setState((st) => (st.userSpeaking === speaking ? st : { ...st, userSpeaking: speaking }));
      if (!c || !x.queued.length || x.agentSpeaking || state.report) return;
      if (now - x.lastSpeechAt < QUIET_MS || now - x.lastActivityAt < QUIET_MS) return;
      if (now - x.lastCueAt < CUE_GAP_MS || x.flags.length) return;
      const cue = x.queued.shift()!;
      x.lastCueAt = now;
      const st = step(cue.step);
      if (!st) return;
      if (cue.kind === "predict") {
        x.predicted.add(cue.step);
        setState((v) => ({ ...v, cue: { type: "predict", step: cue.step }, replay: null }));
        c.sendUserMessage(
          `[PREDICT step=${cue.step}] They are about to reach "${st.title}". Before they act, ask them to predict the decision.`,
        );
      } else {
        x.explained.add(cue.step);
        c.sendUserMessage(
          `[DONE step=${cue.step}] They did "${st.title}" the way the expert does.`,
        );
      }
    }, 400);
    return () => clearInterval(timer);
  }, [state.status, state.report, step]);

  // A fix is confirmed briefly, then the pill goes back to watching.
  useEffect(() => {
    if (state.cue?.type !== "fixed") return;
    const timer = window.setTimeout(
      () => setState((st) => (st.cue?.type === "fixed" ? { ...st, cue: null } : st)),
      5000,
    );
    return () => clearTimeout(timer);
  }, [state.cue]);

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
    finish,
    reportScreen,
    reportActivity,
    dismissReplay,
    setMicEnabled,
  };
}
