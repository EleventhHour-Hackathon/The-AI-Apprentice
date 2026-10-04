import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceConversation } from "@elevenlabs/client";
import { backendFetch } from "@/lib/backend";
import {
  focusCue,
  focusedStep,
  guideError,
  hasStep,
  nextStepId,
  spokenRecently,
  stepForGuide,
  workMapText,
  type GuideFocus,
  type GuideMode,
} from "@/lib/guide";
import { storedLanguage } from "@/lib/languages";
import { taskTitle, type WorkMapRecord } from "@/lib/work-maps";

type GuideState = {
  status: "idle" | "connecting" | "connected" | "closed";
  error: string | null;
  mode: GuideMode;
  botSpeaking: boolean;
  muted: boolean;
  /** Sia's latest words, and the person's reply to them. */
  said: string;
  heard: string;
};

const initialState: GuideState = {
  status: "idle",
  error: null,
  mode: "learn",
  botSpeaking: false,
  muted: false,
  said: "",
  heard: "",
};

/** Arrow keys move along the map quickly: only the node they stop on is sent to Sia. */
const FOCUS_SETTLE_MS = 700;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Sia on the Work Map page: a voice conversation with the guide agent (ElevenLabs, role "guide")
 * about this map. In learn mode it explains the steps to a new hire; in review mode it walks the
 * expert through them and edits the map when they correct something.
 *
 * The map and Sia follow each other: Sia's focus_step and next_step move the map (onFocusRequest),
 * and a node the person picks on the map is sent to Sia as [FOCUS step=<id>].
 */
export function useGuide(options: {
  map: WorkMapRecord;
  /** Focus this step or guardrail on the map. */
  onFocusRequest: (id: string) => void;
  /** The map was edited by voice: load it again. */
  onEdited?: () => void;
}) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const conv = useRef<VoiceConversation | null>(null);
  const [state, setState] = useState(initialState);
  const [level, setLevel] = useState(0);
  const s = useRef({
    mode: "learn" as GuideMode,
    focus: null as GuideFocus,
    /** A focus Sia asked for: when the map reports it, it isn't sent back as [FOCUS]. */
    requested: "",
    focusTimer: null as number | null,
    /** What the person said, for the quote of an edit. */
    heard: [] as string[],
  });

  /** Move the map to this id, as Sia asked. */
  const show = useCallback((id: string, kind: "step" | "guardrail") => {
    s.current.focus = { kind, id };
    s.current.requested = id;
    latest.current.onFocusRequest(id);
  }, []);

  const clientTools = useRef({
    focus_step: (p: Record<string, unknown>) => {
      const id = str(p["step_id"]);
      const { map } = latest.current;
      if (hasStep(map, id)) show(id, "step");
      else if (focusedStep(map, { kind: "guardrail", id }) !== "none") show(id, "guardrail");
      else return "No such step.";
      return "Shown.";
    },
    next_step: () => {
      const { map } = latest.current;
      const id = nextStepId(map, s.current.focus);
      if (id) show(id, "step");
      return stepForGuide(map, id);
    },
    edit_work_map: async (p: Record<string, unknown>) => {
      if (s.current.mode !== "review")
        return "Not changed: only the expert can change the map, in review mode. Say so and go on.";
      const said = spokenRecently(str(p["said"]), s.current.heard);
      const response = await backendFetch(
        `/api/v1/sessions/${encodeURIComponent(latest.current.map.id)}/edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...p, said }),
        },
      ).catch(() => null);
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
      latest.current.onEdited?.();
      const next = body.stale
        ? `These fields still carry the old value: ${body.stale}. Call edit_work_map to change only those fields so the map agrees, then say the new version back in one short sentence and ask if that is right.`
        : "Say the new version back in one short sentence and ask if that is right.";
      return `Done: ${body.change}. The Work Map now:\n${body.summary}\n\n${next}`;
    },
  });

  const release = useCallback((error?: string) => {
    const c = conv.current;
    conv.current = null;
    if (c?.isOpen()) void c.endSession().catch(() => undefined);
    if (s.current.focusTimer !== null) clearTimeout(s.current.focusTimer);
    s.current.focusTimer = null;
    setLevel(0);
    setState((st) => ({
      ...st,
      status: "closed",
      botSpeaking: false,
      muted: false,
      error: error ?? st.error,
    }));
  }, []);

  const start = useCallback(
    async (mode: GuideMode) => {
      if (conv.current) return;
      const x = s.current;
      x.mode = mode;
      x.heard = [];
      x.requested = "";
      setState({ ...initialState, mode, status: "connecting" });
      // A new hire hears the tutor's language, the expert their own (Auto: the agent's default).
      const language = storedLanguage(mode === "learn" ? "tutor" : "apprentice");
      try {
        const response = await backendFetch("/api/v1/agent/token?role=guide");
        if (!response.ok) {
          const detail = await response
            .json()
            .then((b: { detail?: string }) => b.detail)
            .catch(() => undefined);
          throw new Error(detail ?? `The token request answered ${response.status}.`);
        }
        const { token } = (await response.json()) as { token: string };
        const { map } = latest.current;
        const c = await VoiceConversation.startSession({
          conversationToken: token,
          connectionType: "webrtc",
          dynamicVariables: {
            task: taskTitle(map.task),
            work_map: workMapText(map),
            focused_step: focusedStep(map, x.focus),
            mode,
          },
          ...(language !== "auto" && { overrides: { agent: { language } } }),
          clientTools: clientTools.current,
          onConnect() {
            setState((st) => ({ ...st, status: "connected" }));
          },
          onModeChange({ mode: m }) {
            setState((st) => ({ ...st, botSpeaking: m === "speaking" }));
          },
          onMessage({ message, role }) {
            const text = message.trim();
            if (!text) return;
            if (role === "agent") {
              setState((st) => ({ ...st, said: text, heard: "" }));
              return;
            }
            if (text.startsWith("[")) return; // cues the page sent, not the person's words
            s.current.heard = [...s.current.heard, text].slice(-6);
            setState((st) => ({ ...st, heard: st.heard ? `${st.heard} ${text}` : text }));
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
        release(guideError(error));
      }
    },
    [release],
  );

  /** The map's focus changed. If the person picked it (not Sia), tell Sia once it settles. */
  const focusChanged = useCallback((item: GuideFocus) => {
    const x = s.current;
    x.focus = item;
    if (x.focusTimer !== null) clearTimeout(x.focusTimer);
    x.focusTimer = null;
    if (!item) return;
    if (item.id === x.requested) {
      x.requested = "";
      return;
    }
    x.requested = "";
    x.focusTimer = window.setTimeout(() => {
      x.focusTimer = null;
      conv.current?.sendUserMessage(focusCue(item.id));
    }, FOCUS_SETTLE_MS);
  }, []);

  const stop = useCallback(() => release(), [release]);
  const setMuted = useCallback((muted: boolean) => {
    conv.current?.setMicMuted(muted);
    setState((st) => ({ ...st, muted }));
  }, []);

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
      if (s.current.focusTimer !== null) clearTimeout(s.current.focusTimer);
    },
    [],
  );

  return { ...state, level, start, stop, setMuted, focusChanged };
}
