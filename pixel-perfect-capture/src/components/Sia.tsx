import { useCallback, useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { AppWindow, ArrowRight, Check, CheckCheck, Clock, Hand, Mic, MicOff, Minus, Monitor, Pause, Play, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VoiceWave } from "./VoiceWave";
import { useApprentice, type Capture, type FlowNode } from "@/hooks/use-apprentice";
import { useScreenEvents } from "@/hooks/use-screen-events";
import type { Floor } from "@/lib/floor";
import { count } from "@/lib/work-maps";

export type SiaState = "idle" | "connecting" | "watching" | "raised" | "gotit" | "debriefing" | "debrief";
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const colors = { idle: "text-pill-muted", connecting: "text-pill-muted", watching: "text-voice-listening", raised: "text-voice-raised", gotit: "text-voice-listening", debriefing: "text-voice-debrief", debrief: "text-voice-debrief" };
const labels = { idle: "Idle", connecting: "Connecting", watching: "Learning", raised: "Raised", gotit: "Answer captured", debriefing: "Debrief", debrief: "Debrief" };
/** While watching, why the apprentice is quiet (lib/floor.ts). */
const floorLabels: Record<Floor, string> = { talking: "Listening", busy: "Watching", reading: "Reading along", waiting: "Learning", quiet: "Learning", ask: "Learning" };
const stages: Partial<Record<FlowNode, string>> = { debrief: "DEBRIEF", teach_back: "TEACH-BACK", end: "WRAPPING UP" };
const kinds = { step: "Step", guardrail: "Rule", open_question: "Open question", correction: "Correction" };
const isWork = (node: FlowNode) => node === "session_start" || node === "observing";

/** `onOpenApp` adds a button that brings the app window forward (desktop pill only); `onLesson` hands a "lesson:<work map id>" command to the tutor. */
export function Sia({ onOpenApp, onLesson }: { onOpenApp?: () => void; onLesson?: (workMapId: string) => void } = {}) {
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [offRecord, setOffRecord] = useState(false);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [screenError, setScreenError] = useState("");
  const [gotit, setGotit] = useState<Capture | null>(null);
  const [quiet, setQuiet] = useState(true);
  const [dismissed, setDismissed] = useState(-1);
  const [minimized, setMinimized] = useState(false);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const snapshot = useRef<() => string | null>(() => null);

  const voice = useApprentice({
    moment: () => ({ time: secondsRef.current, thumb: snapshot.current() }),
    onCapture: (capture, node) => { if (isWork(node) && capture.kind !== "open_question") setGotit(capture); },
  });
  const work = voice.status === "connected" && isWork(voice.node);
  const screenEvents = useScreenEvents(screen, { enabled: work && !paused && !offRecord, session: voice.session, onEvent: voice.reportScreen, onActivity: voice.reportActivity });
  snapshot.current = screenEvents.snapshot;
  const level = paused || offRecord ? 0 : voice.level;

  const current = voice.exchanges.at(-1);
  const currentIndex = voice.exchanges.length - 1;
  const steps = voice.captures.filter(c => c.kind === "step").length;
  const rules = voice.captures.filter(c => c.kind === "guardrail").length;
  const parked = voice.captures.filter(c => c.kind === "open_question").length;
  const raised = work && Boolean(current) && dismissed !== currentIndex && (voice.botSpeaking || voice.userSpeaking || !quiet);
  const state: SiaState = voice.status === "idle" ? "idle" : voice.status === "connecting" ? "connecting" : voice.status === "closed" ? "debrief" : !isWork(voice.node) ? "debriefing" : gotit ? "gotit" : raised ? "raised" : "watching";
  const recording = state === "connecting" || state === "watching" || state === "raised" || state === "gotit";

  const stopScreen = useCallback(() => {
    setScreen(previous => { previous?.getTracks().forEach(track => track.stop()); return null; });
  }, []);
  const startSession = async () => {
    if (voice.status === "connecting" || voice.status === "connected") return;
    setSeconds(0); setPaused(false); setOffRecord(false); setGotit(null); setDismissed(-1); setScreenError("");
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
    } catch {
      setScreenError("Share the screen you work in so the apprentice can watch.");
      return;
    }
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      setScreen(previous => (previous === display ? null : previous));
      setScreenError("Screen sharing stopped. The apprentice can no longer see your work.");
    });
    setScreen(display);
    void voice.start();
  };
  const endWork = () => { stopScreen(); setGotit(null); voice.send("work.end"); };
  const endSession = () => { stopScreen(); voice.stop(); };
  const close = () => { stopScreen(); voice.reset(); setScreenError(""); setSeconds(0); };
  const later = () => {
    if (!current) return;
    setDismissed(currentIndex);
    voice.send("question.later", { question: current.question });
  };
  const skip = () => voice.send("debrief.skip");
  const toggleMute = () => setPaused(p => !p);
  const toggleOffRecord = () => setOffRecord(o => !o);

  useEffect(() => { voice.setMicEnabled(!paused && !offRecord); }, [paused, offRecord, voice.status, voice.setMicEnabled]);
  useEffect(() => { voice.setOffRecord(offRecord); }, [offRecord, voice.status, voice.setOffRecord]);
  // A question stays open while either side is talking, and folds away after eight quiet seconds.
  useEffect(() => {
    if (voice.botSpeaking || voice.userSpeaking) { setQuiet(false); return; }
    const timer = window.setTimeout(() => setQuiet(true), 8000);
    return () => clearTimeout(timer);
  }, [voice.botSpeaking, voice.userSpeaking, current?.answer]);
  useEffect(() => {
    if (!gotit) return;
    const timer = window.setTimeout(() => setGotit(null), 2500);
    return () => clearTimeout(timer);
  }, [gotit]);
  useEffect(() => { if (!isWork(voice.node)) stopScreen(); }, [voice.node, stopScreen]);
  useEffect(() => { if (voice.status === "closed") stopScreen(); }, [voice.status, stopScreen]);
  useEffect(() => {
    if (!work || paused) return;
    const timer = window.setInterval(() => setSeconds(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [work, paused]);
  useEffect(() => () => { setScreen(previous => { previous?.getTracks().forEach(track => track.stop()); return null; }); }, []);

  const lessonRef = useRef(onLesson);
  lessonRef.current = onLesson;
  const actions = useRef({ startSession, endWork, endSession, close, later, skip, toggleMute, toggleOffRecord, continueWork: () => setGotit(null), state, node: voice.node });
  actions.current = { startSession, endWork, endSession, close, later, skip, toggleMute, toggleOffRecord, continueWork: () => setGotit(null), state, node: voice.node };
  // The desktop shell starts sessions from the app window through this hook (electron/main.cjs).
  useEffect(() => {
    const w = window as Window & { __apprenticeCommand?: (command: string) => void };
    w.__apprenticeCommand = command => {
      if (actions.current.state !== "idle") return;
      if (command === "start") void actions.current.startSession();
      else if (command.startsWith("lesson:")) lessonRef.current?.(command.slice("lesson:".length));
    };
    return () => { delete w.__apprenticeCommand; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true]") || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = actions.current;
      const key = e.key.toLowerCase();
      // Let focused buttons handle Enter normally rather than firing two actions.
      if (key === "enter" && target.closest("button")) return;
      const live = a.state !== "idle" && a.state !== "debrief";
      if (key === "s") { e.preventDefault(); if (a.state === "idle") void a.startSession(); else if (a.state === "debrief") a.close(); else if (a.state === "debriefing" || a.state === "connecting") a.endSession(); else a.endWork(); }
      else if (key === "r" && live) { e.preventDefault(); a.toggleMute(); }
      else if (key === "o" && live) { e.preventDefault(); a.toggleOffRecord(); }
      else if (key === "l" && a.state === "raised") { e.preventDefault(); a.later(); }
      else if (key === "enter" && a.state === "gotit") { e.preventDefault(); a.continueWork(); }
      else if (key === "escape") { e.preventDefault(); if (a.state === "debriefing" || a.state === "connecting") a.endSession(); else if (a.state === "debrief") a.close(); }
      else if (key === "arrowright" && a.state === "debriefing" && a.node === "debrief") { e.preventDefault(); a.skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const expanded = state === "raised" || state === "gotit" || state === "debriefing" || state === "debrief";
  const width = state === "idle" ? 310 : expanded ? 440 : 380;
  const color = offRecord || paused ? "text-pill-muted" : colors[state];
  const statusLabel = offRecord ? "Off the record" : paused ? "Paused" : state === "raised" && voice.node === "session_start" ? "Getting started" : state === "watching" ? floorLabels[voice.floor] : labels[state];
  const answer = (current?.answer ? `${current.answer} ${voice.partial}` : voice.partial).trim();
  const speechLabel = offRecord ? "Off the record" : paused ? "Paused" : current?.captured && !voice.botSpeaking ? "Answer captured" : voice.botSpeaking ? "Asking" : level > .08 ? "Listening to you" : "Ready for your voice";
  const error = voice.error ?? screenError;
  // Folded away is fine while it just watches; anything that needs the expert opens it again.
  useEffect(() => { if (state === "raised" || state === "debriefing" || state === "debrief" || error) setMinimized(false); }, [state, error]);

  return <>
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <section aria-label="Voice assistant" className={`voice-shell pointer-events-auto ${expanded && !minimized ? "voice-shell-expanded" : ""} ${state === "raised" ? "voice-shell-raised" : ""}`} style={{ "--voice-width": `${minimized ? 64 : width}px` } as CSSProperties}>
        {minimized ? <button type="button" className={`${color} flex h-12 w-full items-center justify-center`} title={`${statusLabel} · Expand`} aria-label={`${statusLabel}. Expand`} onClick={() => setMinimized(false)}>{state === "watching" && !paused && !offRecord ? <VoiceWave level={level} active /> : <span className="h-2 w-2 rounded-full bg-current" />}</button> : <>
        <div className="flex min-h-12 items-center gap-3 py-2 pl-4 pr-2">
          <span className={`${color} flex shrink-0 items-center gap-2 text-xs font-medium`} aria-live="polite">
            {offRecord ? <span className="h-2 w-2 rounded-full bg-pill-muted" /> : state === "idle" || state === "connecting" ? <span className="h-1.5 w-1.5 rounded-full bg-pill-muted" /> : state === "raised" ? <Hand size={17} /> : state === "gotit" ? <Check size={17} /> : state === "debrief" || state === "debriefing" ? <CheckCheck size={17} /> : <VoiceWave level={level} active={!paused} />}
            {statusLabel}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {screen && recording && <span className="mr-1 text-pill-muted" title="Watching your screen"><Monitor size={12} /></span>}
            {recording && <span className="mr-1 font-mono text-[11px] tabular-nums text-pill-muted">{fmt(seconds)}</span>}
            {state === "idle" ? <Button className="voice-cta" onClick={() => void startSession()} title="Start session (S)"><Mic size={13} />Start session<Kbd>S</Kbd></Button> : state === "debrief" ? <Icon title="Close (Esc)" onClick={close}><X /></Icon> : <><Icon title={paused ? "Resume (R)" : "Pause (R)"} onClick={toggleMute}>{paused ? <Play /> : <Pause />}</Icon><Icon title="Off the record (O)" pressed={offRecord} onClick={toggleOffRecord}>{offRecord ? <MicOff /> : <Mic />}</Icon>{recording && <Icon title="End session (S)" onClick={state === "connecting" ? endSession : endWork}><Square size={12} /></Icon>}</>}
            <Icon title="Minimize" onClick={() => setMinimized(true)}><Minus /></Icon>
            {onOpenApp && <Icon title="Open app" onClick={onOpenApp}><AppWindow /></Icon>}
          </div>
        </div>
        {state === "watching" && voice.known && <div className="pb-2 text-center text-[11px] text-voice-listening">Picking up from an earlier session</div>}
        {state === "watching" && (steps + rules + parked > 0) && <div className="pb-3 text-center text-[11px] text-pill-muted">{[steps && count(steps, "step"), rules && count(rules, "rule"), parked && `${parked} saved for later`].filter(Boolean).join(" · ")}</div>}
        {state === "raised" && current && <div className="border-t border-pill-border px-4 pb-4 pt-3 sia-fade">
          <p className="text-sm leading-snug">{current.question}</p>
          <div className="mt-3 flex gap-2"><span className="mt-0.5 text-[10px] text-pill-muted">YOU</span><p className="voice-caption text-[13px] leading-relaxed text-pill-foreground/80">{answer || "Listening…"}</p></div>
          {voice.node === "observing" && <div className="mt-2 flex justify-end"><Button variant="ghost" className="h-8 rounded-full text-xs text-pill-muted" title="Save for the debrief (L)" onClick={later}><Clock size={13} />Later<Kbd>L</Kbd></Button></div>}
        </div>}
        {state === "gotit" && gotit && <div className="border-t border-pill-border px-4 pb-4 pt-3 sia-fade">
          <p className="text-[10px] text-pill-muted">{kinds[gotit.kind].toUpperCase()}</p>
          <p className="mt-1 text-sm leading-snug">{gotit.title}</p>
          {gotit.detail && <p className="mt-1 text-xs leading-relaxed text-pill-muted">{gotit.detail}</p>}
          <div className="mt-2 flex"><Button variant="ghost" className="ml-auto h-7 text-xs text-pill-muted" title="Continue (Enter)" onClick={() => setGotit(null)}>Continue<Kbd>↵</Kbd></Button></div>
        </div>}
        {state === "debrief" && <div className="border-t border-pill-border px-5 pb-5 pt-4 sia-fade">
          <div className="flex items-center gap-1.5 text-[11px] text-pill-muted"><Check size={12} />Work session ended<span className="ml-auto font-mono">{fmt(seconds)}</span></div>
          <h2 className="mt-3 text-xl font-medium">{voice.confirmed ? "Work Map ready." : voice.captures.length ? "Here’s what I learned." : "Nothing captured yet."}</h2>
          <p className="mt-1 text-xs text-pill-muted">{voice.task ? `${voice.task} · ` : ""}{count(steps, "step")} · {count(rules, "rule")}{parked ? ` · ${parked} open` : ""}{voice.confirmed ? " · confirmed" : ""}</p>
          {voice.captures.length > 0 && <ol className="my-4 divide-y divide-pill-border">{voice.captures.map((capture, index) => <li key={index} className="flex items-start gap-3 py-3 text-[13px] leading-snug"><span className="mt-0.5 text-voice-debrief">{capture.kind === "open_question" ? <Clock size={14} /> : <Check size={14} />}</span><ScreenMoment thumb={capture.thumb} time={capture.time} label={capture.title} /><div className="min-w-0 flex-1"><span className="block text-[10px] text-pill-muted">{kinds[capture.kind]}</span>{capture.title}{capture.detail && <p className="mt-1 text-xs leading-relaxed text-pill-muted">{capture.detail}</p>}</div></li>)}</ol>}
          <div className="mt-4 flex items-center justify-between gap-2"><span className="text-[10px] text-pill-muted">{voice.confirmed ? "Saved on the apprentice backend" : "Unconfirmed · saved as is"}</span><Button className="voice-cta" title="Done (S)" onClick={close}>Done<Kbd>S</Kbd></Button></div>
        </div>}
        {state === "debriefing" && <div className="border-t border-pill-border px-5 pb-4 pt-4 sia-fade">
          <div className="flex items-center justify-between text-[11px] text-pill-muted"><span>{stages[voice.node] ?? "DEBRIEF"}</span><span>{count(steps, "step")} · {count(rules, "rule")}</span></div>
          {current?.thumb && <div className="mt-3"><ScreenMoment thumb={current.thumb} time={current.time} label="Screen when this was asked" /></div>}
          <h2 className="mt-3 min-h-16 text-[18px] font-medium leading-snug">{voice.merging ? "Looking back over what I saw…" : current?.question || "One moment…"}</h2>
          {voice.node === "teach_back" && <p className="mt-2 text-xs leading-relaxed text-pill-muted">Say if that’s right, or correct anything I got wrong.</p>}
          <div className="mt-4 border-t border-pill-border pt-3">
            <div className={`flex items-center gap-2 text-xs ${current?.captured ? "text-voice-listening" : "text-voice-debrief"}`} role="status">{current?.captured && !voice.botSpeaking ? <Check size={17} /> : <VoiceWave level={level} active={!offRecord && !paused} />}{speechLabel}</div>
            <p className="voice-caption mt-2 text-[13px] leading-relaxed text-pill-foreground/85">{answer || "Take your time. I’m listening."}</p>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-pill-border pt-3">
            <Button variant="ghost" className="h-8 rounded-full px-2 text-xs text-pill-muted" title="End debrief (Esc)" onClick={endSession}>End<Kbd>Esc</Kbd></Button>
            {voice.node === "debrief" && <Button variant="ghost" className="h-8 rounded-full px-2 text-xs text-pill-foreground" title="Skip (→)" onClick={skip}>Skip<ArrowRight size={13} /><Kbd>→</Kbd></Button>}
          </div>
        </div>}
        {error && <div role="alert" className="border-t border-pill-border px-4 py-3 text-xs leading-relaxed text-voice-raised">{error}{(state === "idle" || state === "debrief") && <Button variant="ghost" className="mt-1 h-7 px-0 text-xs text-pill-foreground" onClick={() => { close(); void startSession(); }}>Start again</Button>}</div>}
        </>}
      </section>
    </div>
  </>;
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="rounded border border-current/20 px-1 font-mono text-[9px] opacity-60">{children}</kbd>; }
/** Shortcut hints live in the tooltip (`title`), keeping the pill compact. */
export function Icon({ title, pressed, onClick, children }: { title: string; pressed?: boolean; onClick: () => void; children: ReactNode }) { return <Button variant="ghost" size="icon" className="voice-icon" aria-label={title} aria-pressed={pressed} title={title} onClick={onClick}>{children}</Button>; }

function ScreenMoment({ thumb, time, label }: { thumb: string | null; time: number; label: string }) { if (!thumb) return null; return <figure className="w-20 shrink-0"><img src={thumb} alt={label} className="h-12 w-20 rounded border border-pill-border object-cover object-top" /><figcaption className="mt-1 font-mono text-[10px] text-pill-muted">{fmt(time)}</figcaption></figure>; }
