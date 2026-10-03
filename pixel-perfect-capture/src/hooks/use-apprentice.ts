import { useCallback, useEffect, useRef, useState } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
import { DailyTransport } from "@pipecat-ai/daily-transport";
import { BACKEND_URL } from "@/lib/backend";

/** Nodes of the apprentice flow (core/backend/src/services/flows/apprentice.json). */
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
/** Something the backend recorded into the Work Map. */
export type Capture = Moment & {
  kind: "step" | "guardrail" | "open_question" | "correction";
  title: string;
  detail: string;
};

type ApprenticeState = {
  status: "idle" | "connecting" | "connected" | "closed";
  error: string | null;
  node: FlowNode;
  botSpeaking: boolean;
  userSpeaking: boolean;
  /** The expert's words so far in a turn the transcriber has not finalised. */
  partial: string;
  task: string | null;
  confirmed: boolean;
  playbackBlocked: boolean;
  exchanges: Exchange[];
  captures: Capture[];
};

const initialState: ApprenticeState = {
  status: "idle",
  error: null,
  node: "session_start",
  botSpeaking: false,
  userSpeaking: false,
  partial: "",
  task: null,
  confirmed: false,
  playbackBlocked: false,
  exchanges: [],
  captures: [],
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** Turn a server message from the backend handlers into a Work Map capture. */
function toCapture(message: Record<string, unknown>): Omit<Capture, keyof Moment> | null {
  const data = (key: string) =>
    message[key] && typeof message[key] === "object"
      ? (message[key] as Record<string, unknown>)
      : {};
  switch (message["type"]) {
    case "work_map.step": {
      const step = data("step");
      return { kind: "step", title: text(step["step"]), detail: text(step["reason"]) };
    }
    case "work_map.guardrail": {
      const rule = data("guardrail");
      return {
        kind: "guardrail",
        title: text(rule["rule"]),
        detail: [text(rule["applies_when"]), text(rule["stop_and_ask"])]
          .filter(Boolean)
          .join(" · "),
      };
    }
    case "work_map.open_question":
      return { kind: "open_question", title: text(message["question"]), detail: "" };
    case "work_map.correction":
      return { kind: "correction", title: text(message["correction"]), detail: "" };
    default:
      return null;
  }
}

/**
 * One voice session with the apprentice bot: connects over Pipecat/Daily,
 * plays its voice, and turns its events into exchanges and Work Map captures.
 * The flow itself (when to ask, debrief, teach-back) lives in the backend.
 */
export function useApprentice(options: {
  moment: () => Moment;
  onCapture?: (capture: Capture, node: FlowNode) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const audioRef = useRef<HTMLAudioElement>(null);
  const client = useRef<PipecatClient | null>(null);
  const node = useRef<FlowNode>("session_start");
  const utteranceDone = useRef(true);
  /** When and where the apprentice's latest question started, for tying captures to it. */
  const lastMoment = useRef<Moment | null>(null);
  const [state, setState] = useState(initialState);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const release = useCallback((pc: PipecatClient, error?: string) => {
    if (client.current !== pc) return;
    client.current = null;
    void pc.disconnect().catch(() => undefined);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }
    setMicStream(null);
    setState((s) => ({
      ...s,
      status: "closed",
      botSpeaking: false,
      userSpeaking: false,
      partial: "",
      playbackBlocked: false,
      error: error ?? s.error,
    }));
  }, []);

  const play = useCallback(async () => {
    try {
      await audioRef.current?.play();
      setState((s) => ({ ...s, playbackBlocked: false }));
    } catch {
      setState((s) => ({ ...s, playbackBlocked: true }));
    }
  }, []);

  const start = useCallback(async () => {
    if (client.current) return;
    node.current = "session_start";
    utteranceDone.current = true;
    lastMoment.current = null;
    const pc: PipecatClient = new PipecatClient({
      transport: new DailyTransport(),
      enableMic: true,
      enableCam: false,
      callbacks: {
        onTrackStarted(track, participant) {
          if (client.current !== pc || track.kind !== "audio") return;
          if (participant?.local) {
            setMicStream(new MediaStream([track]));
            return;
          }
          const audio = audioRef.current;
          if (!audio) return;
          audio.srcObject = new MediaStream([track]);
          void play();
        },
        onBotReady() {
          if (client.current === pc) setState((s) => ({ ...s, status: "connected" }));
        },
        onBotStartedSpeaking() {
          if (client.current === pc) setState((s) => ({ ...s, botSpeaking: true }));
        },
        onBotStoppedSpeaking() {
          if (client.current !== pc) return;
          utteranceDone.current = true;
          setState((s) => ({ ...s, botSpeaking: false }));
        },
        onBotTtsText({ text: words }) {
          if (client.current !== pc || !words.trim()) return;
          const moment =
            utteranceDone.current || !lastMoment.current ? latest.current.moment() : null;
          utteranceDone.current = false;
          if (moment) lastMoment.current = moment;
          setState((s) => {
            const last = s.exchanges.at(-1);
            if (moment || !last) {
              const exchange: Exchange = {
                ...(moment ?? lastMoment.current ?? { time: 0, thumb: null }),
                node: node.current,
                question: words.trim(),
                answer: "",
                captured: false,
              };
              return { ...s, partial: "", exchanges: [...s.exchanges, exchange] };
            }
            return {
              ...s,
              exchanges: [
                ...s.exchanges.slice(0, -1),
                { ...last, question: `${last.question} ${words.trim()}` },
              ],
            };
          });
        },
        onUserStartedSpeaking() {
          if (client.current === pc) setState((s) => ({ ...s, userSpeaking: true }));
        },
        onUserStoppedSpeaking() {
          if (client.current === pc) setState((s) => ({ ...s, userSpeaking: false }));
        },
        onUserTranscript({ text: words, final }) {
          if (client.current !== pc) return;
          if (!final) {
            setState((s) => ({ ...s, partial: words }));
            return;
          }
          setState((s) => {
            const last = s.exchanges.at(-1);
            if (!last) return { ...s, partial: "" };
            const answer = last.answer ? `${last.answer} ${words.trim()}` : words.trim();
            return {
              ...s,
              partial: "",
              exchanges: [...s.exchanges.slice(0, -1), { ...last, answer }],
            };
          });
        },
        onServerMessage(message: unknown) {
          if (client.current !== pc || !message || typeof message !== "object") return;
          const data = message as Record<string, unknown>;
          if (data["type"] === "flow.node" && typeof data["node"] === "string") {
            node.current = data["node"] as FlowNode;
            setState((s) => ({ ...s, node: node.current }));
          } else if (data["type"] === "work_map.task") {
            setState((s) => ({ ...s, task: text(data["task"]) || null }));
          } else if (data["type"] === "work_map.confirmed") {
            setState((s) => ({ ...s, confirmed: true }));
          } else {
            const found = toCapture(data);
            if (!found?.title) return;
            const recorded = found.kind !== "open_question";
            const capture: Capture = {
              ...found,
              ...(lastMoment.current ?? latest.current.moment()),
            };
            latest.current.onCapture?.(capture, node.current);
            setState((s) => {
              const last = s.exchanges.at(-1);
              const exchanges =
                last && recorded
                  ? [...s.exchanges.slice(0, -1), { ...last, captured: true }]
                  : s.exchanges;
              return { ...s, exchanges, captures: [...s.captures, capture] };
            });
          }
        },
        onBotDisconnected() {
          // After the teach-back the bot ends the call itself; anything earlier is a dropped session.
          release(
            pc,
            node.current === "end"
              ? undefined
              : "The apprentice left the call. Start a new session to retry.",
          );
        },
        onDisconnected() {
          release(pc);
        },
        onError(message) {
          const data = message.data as { message?: unknown; error?: unknown } | undefined;
          const error = text(data?.message) || text(data?.error) || "Voice connection failed.";
          if (client.current === pc) setState((s) => ({ ...s, error }));
        },
      },
    });
    client.current = pc;
    setMicStream(null);
    setState({ ...initialState, status: "connecting" });
    try {
      await pc.startBotAndConnect({ endpoint: `${BACKEND_URL}/api/v1/connect`, requestData: {} });
      if (client.current === pc) setState((s) => ({ ...s, status: "connected" }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      release(
        pc,
        `Could not reach the apprentice at ${BACKEND_URL}.${message ? ` ${message}` : ""}`,
      );
    }
  }, [play, release]);

  const stop = useCallback(() => {
    if (client.current) release(client.current);
  }, [release]);

  const reset = useCallback(() => {
    stop();
    setState(initialState);
  }, [stop]);

  const setMicEnabled = useCallback((enabled: boolean) => {
    try {
      client.current?.enableMic(enabled);
    } catch {
      /* not connected yet */
    }
  }, []);

  /** Send one of the pill's controls to the backend flow (see InterviewFlow._handle_client_message). */
  const send = useCallback(
    (type: "work.end" | "question.later" | "debrief.skip", data: Record<string, unknown> = {}) => {
      try {
        client.current?.sendClientMessage(type, data);
      } catch {
        /* not connected yet */
      }
    },
    [],
  );

  /** Tell the apprentice what changed on screen, without making it speak. */
  const reportScreen = useCallback((event: string) => {
    void client.current
      ?.appendToContext({ role: "user", content: `[SCREEN] ${event}`, run_immediately: false })
      .catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      const pc = client.current;
      client.current = null;
      void pc?.disconnect().catch(() => undefined);
    },
    [],
  );

  return {
    ...state,
    audioRef,
    micStream,
    start,
    stop,
    reset,
    play,
    setMicEnabled,
    send,
    reportScreen,
  };
}
