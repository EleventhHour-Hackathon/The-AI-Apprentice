import { useState } from "react";
import { GraduationCap, Mic, MicOff, PencilLine, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/Sia";
import { VoiceWave } from "./VoiceWave";
import type { useGuide } from "@/hooks/use-guide";
import type { GuideMode } from "@/lib/guide";

const modes: { value: GuideMode; label: string; hint: string; icon: typeof Mic }[] = [
  {
    value: "learn",
    label: "Learn this task",
    hint: "Sia explains each step the expert's way",
    icon: GraduationCap,
  },
  {
    value: "review",
    label: "Review as the expert",
    hint: "Sia walks you through your map and changes what you correct",
    icon: PencilLine,
  },
];

/**
 * Sia on the Work Map page: talk through this map by voice, to learn it or to review it.
 * The conversation lives in useGuide (the page owns it, so the map's focus reaches it).
 */
export function Guide({
  guide,
  focus,
}: {
  guide: ReturnType<typeof useGuide>;
  /** The step or guardrail in focus on the map, as "s3. <title>", or "none". */
  focus: string;
}) {
  const [mode, setMode] = useState<GuideMode>("learn");
  const [open, setOpen] = useState(false);
  const live = guide.status === "connecting" || guide.status === "connected";
  if (!open && !live)
    return (
      <Button
        className="voice-cta absolute bottom-10 left-4 z-20"
        style={{ boxShadow: "var(--voice-shadow)" }}
        onClick={() => setOpen(true)}
      >
        <Mic size={13} />
        Talk to Sia
      </Button>
    );
  const status =
    guide.status === "connecting"
      ? "Connecting"
      : guide.muted
        ? "Muted"
        : guide.botSpeaking
          ? "Sia is speaking"
          : "Listening";

  return (
    <section
      aria-label="Talk to Sia"
      className="sia-fade absolute bottom-10 left-4 z-20 w-[320px] max-w-[calc(100vw-32px)] rounded-3xl border border-pill-border bg-pill p-4 text-pill-foreground"
      style={{ boxShadow: "var(--voice-shadow)" }}
    >
      {live ? (
        <>
          <div className="flex items-center gap-2">
            <span
              className="flex min-w-0 items-center gap-2 text-xs font-medium text-voice-listening"
              aria-live="polite"
            >
              {guide.status === "connected" && !guide.muted ? (
                <VoiceWave level={guide.level} active />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-pill-muted" />
              )}
              {status}
            </span>
            <span className="text-[11px] text-pill-muted">
              · {guide.mode === "learn" ? "Learning" : "Reviewing"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Icon
                title={guide.muted ? "Unmute" : "Mute"}
                pressed={guide.muted}
                onClick={() => guide.setMuted(!guide.muted)}
              >
                {guide.muted ? <MicOff /> : <Mic />}
              </Icon>
              <Icon title="End" onClick={guide.stop}>
                <Square size={12} />
              </Icon>
            </div>
          </div>
          <p className="mt-2 truncate text-[11px] text-pill-muted" title={focus}>
            {focus === "none" ? "No step in focus" : `In focus: ${focus}`}
          </p>
          {guide.said && <p className="mt-2 line-clamp-3 text-sm leading-snug">{guide.said}</p>}
          {guide.heard && (
            <p className="mt-1 line-clamp-2 text-xs italic text-pill-muted">{guide.heard}</p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Talk to Sia about this task</p>
            <div className="ml-auto">
              <Icon title="Close" onClick={() => setOpen(false)}>
                <X />
              </Icon>
            </div>
          </div>
          <div className="mt-3 grid gap-1.5" role="radiogroup" aria-label="Mode">
            {modes.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                title={m.hint}
                onClick={() => setMode(m.value)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                  mode === m.value
                    ? "border-voice-listening text-pill-foreground"
                    : "border-pill-border text-pill-muted hover:text-pill-foreground"
                }`}
              >
                <m.icon size={13} />
                {m.label}
              </button>
            ))}
          </div>
          {guide.error && (
            <p role="alert" className="mt-3 text-xs text-voice-raised">
              {guide.error}
            </p>
          )}
          <Button className="voice-cta mt-3 w-full" onClick={() => void guide.start(mode)}>
            <Mic size={13} />
            Talk to Sia
          </Button>
        </>
      )}
    </section>
  );
}
