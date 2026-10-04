import { BACKEND_URL } from "@/lib/backend";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AppWindow, Check, CheckCheck, Hand, Lightbulb, Monitor, Square, X } from "lucide-react";
import { ClipPlayer } from "@/components/ClipPlayer";
import { Button } from "@/components/ui/button";
import { Icon, Kbd } from "@/components/Sia";
import { VoiceWave } from "./VoiceWave";
import { useScreenEvents } from "@/hooks/use-screen-events";
import { usePrivacyShield } from "@/hooks/use-privacy-shield";
import type { LanguageChoice } from "@/lib/languages";
import { useTutor, type LessonStep } from "@/hooks/use-tutor";
import { taskTitle } from "@/lib/work-maps";

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The pill in teaching mode: a new hire works a case on their own screen while
 * the tutor watches, asks them to predict judgment calls, and steps in before
 * a wrong decision is saved, replaying how the expert did it.
 */
export function Tutor({
  workMapId,
  language = "en",
  onClose,
  onOpenApp,
}: {
  workMapId: string;
  /** The language the tutor speaks with the new hire. */
  language?: LanguageChoice;
  onClose: () => void;
  onOpenApp?: () => void;
}) {
  const tutor = useTutor();
  const { start: startTutor, reset: resetTutor } = tutor;
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [screenError, setScreenError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const started = useRef(false);

  const stopScreen = useCallback(() => {
    setScreen((previous) => {
      previous?.getTracks().forEach((track) => track.stop());
      return null;
    });
  }, []);

  const begin = useCallback(async () => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      });
    } catch {
      setScreenError("Share the screen you work in so the tutor can watch.");
      return;
    }
    display.getVideoTracks()[0]?.addEventListener("ended", () => {
      setScreen((previous) => (previous === display ? null : previous));
      setScreenError("Screen sharing stopped. The tutor can no longer see your work.");
    });
    setScreen(display);
    void startTutor(workMapId, language);
  }, [startTutor, workMapId, language]);

  // Opened from the app's "Teach a new hire": start straight away.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  const working = tutor.status === "connected" && !tutor.report;
  // The new hire's screen is shielded the same way: personal data never leaves the machine.
  const shield = usePrivacyShield(screen);
  useScreenEvents(shield.stream, {
    enabled: working,
    session: null, // lessons don't keep screen moments; the expert's are what gets replayed
    onEvent: tutor.reportScreen,
    onActivity: tutor.reportActivity,
    beforeSample: shield.fresh,
    // A wrong decision has to be caught before the new hire confirms it.
    sampleIntervalMs: 1000,
  });
  useEffect(() => {
    if (shield.status === "failed")
      setScreenError(
        "The privacy shield couldn’t start, so your screen isn’t being shared. Check the connection and start again.",
      );
  }, [shield.status]);

  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [working]);
  useEffect(() => {
    if (tutor.report || tutor.status === "closed") stopScreen();
  }, [tutor.report, tutor.status, stopScreen]);
  useEffect(() => () => stopScreen(), [stopScreen]);

  const close = useCallback(() => {
    resetTutor();
    stopScreen();
    onClose();
  }, [onClose, resetTutor, stopScreen]);

  const keys = useRef({ finish: tutor.finish, close, report: tutor.report, working });
  keys.current = { finish: tutor.finish, close, report: tutor.report, working };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "s" && keys.current.working) {
        e.preventDefault();
        keys.current.finish();
      } else if (k === "escape" && (keys.current.report || !keys.current.working)) {
        e.preventDefault();
        keys.current.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cue = tutor.cue;
  const stepOf = (id: string) => tutor.steps.findIndex((s) => s.id === id) + 1;
  const error = tutor.error ?? screenError;
  const label = tutor.report
    ? "Lesson report"
    : tutor.finishing
      ? "Wrapping up"
      : tutor.status === "connecting"
        ? "Starting lesson"
        : cue?.type === "stop"
          ? "Stop and think"
          : cue?.type === "predict"
            ? "Predict"
            : cue?.type === "fixed"
              ? "Fixed"
              : tutor.userSpeaking
                ? "Listening"
                : "Watching";
  const color =
    cue?.type === "stop"
      ? "text-voice-raised"
      : cue?.type === "predict"
        ? "text-voice-noticed"
        : cue?.type === "fixed" || tutor.report
          ? "text-voice-listening"
          : "text-voice-debrief";
  const expanded = Boolean(tutor.report || cue || tutor.replay || tutor.finishing);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <section
        aria-label="Voice assistant"
        className={`voice-shell pointer-events-auto ${expanded ? "voice-shell-expanded" : ""} ${cue?.type === "stop" ? "voice-shell-raised" : ""}`}
        style={{ "--voice-width": `${expanded ? 440 : 380}px` } as CSSProperties}
      >
        <div className="flex min-h-12 items-center gap-3 py-2 pl-4 pr-2">
          <span
            className={`${color} flex shrink-0 items-center gap-2 text-xs font-medium`}
            aria-live="polite"
          >
            {cue?.type === "stop" ? (
              <Hand size={17} />
            ) : cue?.type === "predict" ? (
              <Lightbulb size={17} />
            ) : cue?.type === "fixed" || tutor.report ? (
              <CheckCheck size={17} />
            ) : tutor.status === "connected" ? (
              <VoiceWave level={tutor.level} active />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-pill-muted" />
            )}
            {label}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {screen && working && (
              <span className="mr-1 text-pill-muted" title="Watching your screen">
                <Monitor size={12} />
              </span>
            )}
            {working && (
              <span className="mr-1 font-mono text-[11px] tabular-nums text-pill-muted">
                {fmt(seconds)}
              </span>
            )}
            {working ? (
              <Icon title="End lesson (S)" onClick={tutor.finish}>
                <Square size={12} />
              </Icon>
            ) : (
              <Icon title="Close (Esc)" onClick={close}>
                <X />
              </Icon>
            )}
            {onOpenApp && (
              <Icon title="Open app" onClick={onOpenApp}>
                <AppWindow />
              </Icon>
            )}
          </div>
        </div>

        {tutor.status === "connecting" && (
          <p className="px-4 pb-3 text-xs text-pill-muted">
            Loading the expert&rsquo;s Work Map{tutor.task ? ` for ${tutor.task}` : ""}…
          </p>
        )}

        {working && !expanded && tutor.task && (
          <p className="pb-3 text-center text-[11px] text-pill-muted">
            Learning: {taskTitle(tutor.task)}
          </p>
        )}

        {cue?.type === "stop" && !tutor.report && (
          <Panel>
            <p className="text-[10px] text-pill-muted">
              STEP {String(stepOf(cue.step)).padStart(2, "0")} · BEFORE YOU SAVE
            </p>
            <p className="mt-1 text-sm leading-snug">
              {tutor.said || "The expert would stop here."}
            </p>
            <p className="mt-2 text-xs text-pill-muted">You: {cue.what}</p>
            {tutor.replay && <ExpertMoment step={tutor.replay} />}
            <Answer heard={tutor.heard} />
          </Panel>
        )}

        {cue?.type === "predict" && !tutor.report && (
          <Panel>
            <p className="text-[10px] text-pill-muted">
              PREDICT · STEP {String(stepOf(cue.step)).padStart(2, "0")}
            </p>
            <p className="mt-1 text-sm leading-snug">
              {tutor.said || "What would the expert decide here?"}
            </p>
            <Answer heard={tutor.heard} />
          </Panel>
        )}

        {cue?.type === "fixed" && !tutor.report && (
          <Panel>
            <p className="flex items-center gap-1.5 text-sm text-voice-listening">
              <Check size={15} />
              That&rsquo;s how the expert does it.
            </p>
            {tutor.said && <p className="mt-1 text-xs text-pill-muted">{tutor.said}</p>}
          </Panel>
        )}

        {!cue && tutor.replay && !tutor.report && (
          <Panel>
            <div className="flex items-center text-[10px] text-pill-muted">
              HOW THE EXPERT DID IT
              <Button
                variant="ghost"
                className="voice-icon ml-auto h-6"
                aria-label="Close replay"
                onClick={tutor.dismissReplay}
              >
                <X size={12} />
              </Button>
            </div>
            <ExpertMoment step={tutor.replay} />
          </Panel>
        )}

        {tutor.finishing && !tutor.report && (
          <Panel>
            <p className="text-sm text-pill-muted">Putting your report together…</p>
          </Panel>
        )}

        {tutor.report && (
          <div className="sia-fade border-t border-pill-border px-5 pb-5 pt-4">
            <h2 className="text-xl font-medium">
              {tutor.report.practice.length
                ? "Good work. Here’s what to practice."
                : "You did it the expert’s way."}
            </h2>
            <p className="mt-1 text-xs text-pill-muted">
              {taskTitle(tutor.task)} · {fmt(seconds)}
            </p>
            {tutor.report.mastered.length > 0 && (
              <ReportList label="Mastered">
                {tutor.report.mastered.map((m) => (
                  <li key={m.step} className="flex items-start gap-2 py-1.5">
                    <Check size={14} className="mt-0.5 shrink-0 text-voice-listening" />
                    {m.title}
                  </li>
                ))}
              </ReportList>
            )}
            {tutor.report.practice.length > 0 && (
              <ReportList label="Practice next">
                {tutor.report.practice.map((p) => (
                  <li key={p.step} className="py-2">
                    <span className="font-medium">{p.title}</span>
                    <p className="mt-0.5 text-xs text-pill-muted">{p.why}</p>
                    {p.expert_words && (
                      <p className="mt-1 border-l-2 border-voice-debrief pl-2 text-xs italic text-pill-foreground/80">
                        “{p.expert_words}”
                      </p>
                    )}
                  </li>
                ))}
              </ReportList>
            )}
            {tutor.report.not_covered.length > 0 && (
              <ReportList label="Not in this case">
                <li className="py-1 text-xs text-pill-muted">
                  {tutor.report.not_covered.map((n) => n.title).join(" · ")}
                </li>
              </ReportList>
            )}
            <div className="mt-4 flex justify-end">
              <Button className="voice-cta" title="Done (Esc)" onClick={close}>
                Done<Kbd>Esc</Kbd>
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="border-t border-pill-border px-4 py-3 text-xs leading-relaxed text-voice-raised"
          >
            {error}
            {tutor.status !== "connected" && (
              <Button
                variant="ghost"
                className="mt-1 h-7 px-0 text-xs text-pill-foreground"
                onClick={() => {
                  tutor.reset();
                  setScreenError("");
                  void begin();
                }}
              >
                Try again
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="sia-fade border-t border-pill-border px-4 pb-4 pt-3">{children}</div>;
}

function Answer({ heard }: { heard: string }) {
  return (
    <div className="mt-3 flex gap-2">
      <span className="mt-0.5 text-[10px] text-pill-muted">YOU</span>
      <p className="voice-caption text-[13px] leading-relaxed text-pill-foreground/80">
        {heard || "Listening…"}
      </p>
    </div>
  );
}

/** The expert's screen moment for a step, replayed with their words. */
function ExpertMoment({ step }: { step: LessonStep }) {
  return (
    <figure className="mt-3 rounded-xl bg-pill-raised p-2.5">
      {step.clip ? (
        <ClipPlayer
          src={`${BACKEND_URL}${step.clip}`}
          poster={step.thumb}
          label={`The expert doing it: ${step.title}`}
          autoPlay
        />
      ) : (
        step.thumb && (
          <img
            src={step.thumb}
            alt={`The expert's screen: ${step.title}`}
            className="w-full rounded-lg border border-pill-border object-cover object-top"
          />
        )
      )}
      <figcaption className="mt-2 text-xs leading-relaxed">
        <span className="font-mono text-[10px] text-pill-muted">
          THE EXPERT{step.at !== null ? ` · ${fmt(step.at)}` : ""}
        </span>
        <p className="mt-0.5">{step.decision || step.title}</p>
        {/* The expert's reason; what they only said while doing it is not one. */}
        {((step.quote_kind !== "narration" && step.quote) || step.reason) && (
          <p className="mt-1 italic text-pill-foreground/80">
            “{(step.quote_kind !== "narration" && step.quote) || step.reason}”
          </p>
        )}
        {step.quote_kind !== "narration" && step.quote && step.quote_translation && (
          <p className="mt-0.5 text-pill-foreground/70">{step.quote_translation}</p>
        )}
      </figcaption>
    </figure>
  );
}

function ReportList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-[10px] font-medium uppercase tracking-wider text-pill-muted">{label}</h3>
      <ul className="mt-1 divide-y divide-pill-border text-[13px]">{children}</ul>
    </section>
  );
}
