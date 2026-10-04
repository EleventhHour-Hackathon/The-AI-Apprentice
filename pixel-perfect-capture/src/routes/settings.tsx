import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AppWindow,
  Bot,
  Download,
  GraduationCap,
  Keyboard,
  Map,
  Monitor,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  languageOptions,
  storeLanguage,
  storedLanguage,
  type LanguageChoice,
} from "@/lib/languages";
import { runDiagnostics, useSettings, type Diagnostic } from "@/lib/settings";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings · Tacit" }] }),
  component: Settings,
});

const SECTIONS = [
  { id: "apprentice", label: "Apprentice", icon: Bot },
  { id: "capture", label: "Capture", icon: Monitor },
  { id: "privacy", label: "Privacy & data", icon: ShieldCheck },
  { id: "work-maps", label: "Work Maps", icon: Map },
  { id: "teaching", label: "Teaching", icon: GraduationCap },
  { id: "pill", label: "Pill & app", icon: AppWindow },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
] as const;

const VOICE_OPTIONS: ["ivy" | "theo" | "mara", string][] = [
  ["ivy", "Ivy · warm"],
  ["theo", "Theo · calm"],
  ["mara", "Mara · brisk"],
];

// Every choice is saved on this machine (lib/settings.ts; the language in lib/languages.ts).
// Rows marked `soon` are saved but nothing reads them yet.
function Settings() {
  const { settings: s, set, reset } = useSettings();
  const [language, setLanguage] = useState<LanguageChoice>("auto");
  useEffect(() => setLanguage(storedLanguage("apprentice")), []);

  const resetAll = () => {
    if (!window.confirm("Put every setting on this page back to its default?")) return;
    reset();
    storeLanguage("apprentice", "auto");
    setLanguage("auto");
  };

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-4xl gap-10 px-6 py-10">
        <nav className="sticky top-10 hidden h-fit w-44 shrink-0 md:block">
          <ul className="space-y-0.5 text-[13px]">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Icon size={14} />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-12">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-4xl tracking-tight">Settings</h1>
              <Badge variant="outline" className="rounded-full font-normal text-muted-foreground">
                Saved on this machine
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto rounded-full"
                onClick={resetAll}
              >
                <RotateCcw size={13} />
                Reset to defaults
              </Button>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              How Tacit watches, asks, remembers and teaches. Your choices are saved on this
              machine. Items marked <SoonBadge /> are saved but don’t change anything yet.
            </p>
          </div>

          <Section
            id="apprentice"
            title="Apprentice"
            description="The voice that watches you work and asks why."
          >
            <Row label="Voice" hint="Who you hear during a session and the debrief." soon>
              <Choice
                label="Voice"
                value={s.voice}
                onChange={(v) => set("voice", v)}
                options={VOICE_OPTIONS}
              />
            </Row>
            <Row label="Curiosity" hint="How often it raises a question while you work." soon>
              <Segmented
                value={s.curiosity}
                onChange={(v) => set("curiosity", v)}
                options={[
                  ["quiet", "Quiet"],
                  ["balanced", "Balanced"],
                  ["curious", "Curious"],
                ]}
              />
            </Row>
            <Row
              label="Questions during the session"
              hint="At least this many before the debrief, one of them about a guardrail."
              soon
            >
              <Choice
                label="Questions during the session"
                value={s.minQuestions}
                onChange={(v) => set("minQuestions", v)}
                options={[
                  ["2", "At least 2"],
                  ["3", "At least 3"],
                  ["5", "At least 5"],
                ]}
              />
            </Row>
            <Row label="Speaking speed" soon>
              <SliderWithValue
                label="Speaking speed"
                value={s.speakingSpeed}
                onChange={(v) => set("speakingSpeed", v)}
                min={75}
                max={125}
                step={5}
                unit="%"
              />
            </Row>
            <Row label="Debrief" hint="How deep it goes once you end the session." soon>
              <Segmented
                value={s.debriefDepth}
                onChange={(v) => set("debriefDepth", v)}
                options={[
                  ["short", "Short"],
                  ["standard", "Standard"],
                  ["thorough", "Thorough"],
                ]}
              />
            </Row>
            <Row
              label="Language"
              hint="The language the apprentice speaks in new sessions. The Work Map is written in English, with your own words kept as you said them."
            >
              <Select
                value={language}
                onValueChange={(value) => {
                  const next = value as LanguageChoice;
                  setLanguage(next);
                  storeLanguage("apprentice", next);
                }}
              >
                <SelectTrigger aria-label="Apprentice language" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions(true).map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row
              label="Domain vocabulary"
              hint="Terms, acronyms and names it should hear correctly."
              soon
            >
              <Chips
                items={s.vocabulary}
                onChange={(v) => set("vocabulary", v)}
                addLabel="Add term"
              />
            </Row>
            <Row
              label="Show live captions"
              hint="What you and the apprentice say, in the pill."
              soon
            >
              <Switch
                aria-label="Show live captions"
                checked={s.captions}
                onCheckedChange={(v) => set("captions", v)}
              />
            </Row>
          </Section>

          <Section id="capture" title="Capture" description="What Tacit sees and records.">
            <Row label="Watch" hint="Asked again when a session starts if you pick each time." soon>
              <Choice
                label="Watch"
                value={s.watch}
                onChange={(v) => set("watch", v)}
                options={[
                  ["screen", "Entire screen"],
                  ["window", "One window"],
                  ["ask", "Choose each time"],
                ]}
              />
            </Row>
            <Row label="Record video" hint="Short clips of each step show up in the Work Map." soon>
              <Switch
                aria-label="Record video"
                checked={s.recordVideo}
                onCheckedChange={(v) => set("recordVideo", v)}
              />
            </Row>
            <Row label="Video quality" soon>
              <Segmented
                value={s.videoQuality}
                onChange={(v) => set("videoQuality", v)}
                options={[
                  ["720p", "720p"],
                  ["1080p", "1080p"],
                  ["native", "Native"],
                ]}
              />
            </Row>
            <Row label="Read the screen every" hint="Faster notices more, and costs more." soon>
              <Segmented
                value={s.screenInterval}
                onChange={(v) => set("screenInterval", v)}
                options={[
                  ["2", "2 s"],
                  ["5", "5 s"],
                  ["10", "10 s"],
                ]}
              />
            </Row>
            <Row
              label="Blur sensitive fields"
              hint="Passwords, card numbers and IDs are blurred before upload."
              soon
            >
              <Switch
                aria-label="Blur sensitive fields"
                checked={s.blurSensitive}
                onCheckedChange={(v) => set("blurSensitive", v)}
              />
            </Row>
            <Row
              label="Never watch these apps"
              hint="Tacit looks away while they are in front."
              soon
            >
              <Chips
                items={s.excludedApps}
                onChange={(v) => set("excludedApps", v)}
                addLabel="Add app"
              />
            </Row>
            <Row
              label="Pause when you step away"
              hint="No input for a while pauses the session."
              soon
            >
              <Choice
                label="Pause when you step away"
                value={s.pauseAfter}
                onChange={(v) => set("pauseAfter", v)}
                options={[
                  ["off", "Never"],
                  ["2", "After 2 min"],
                  ["5", "After 5 min"],
                ]}
              />
            </Row>
            <Row label="Microphone" hint="Tacit uses your system’s default microphone." soon>
              <span className="text-xs text-muted-foreground">System default</span>
            </Row>
          </Section>

          <Section
            id="privacy"
            title="Privacy & data"
            description="What’s kept, for how long, and who can see it."
          >
            <Row
              label="Off the record also stops video"
              hint="Nothing is seen or heard while off the record (O)."
              soon
            >
              <Switch
                aria-label="Off the record also stops video"
                checked={s.offRecordStopsVideo}
                onCheckedChange={(v) => set("offRecordStopsVideo", v)}
              />
            </Row>
            <Row label="Keep unconfirmed Work Maps" soon>
              <Choice
                label="Keep unconfirmed Work Maps"
                value={s.keepUnconfirmedDays}
                onChange={(v) => set("keepUnconfirmedDays", v)}
                options={[
                  ["7", "7 days"],
                  ["30", "30 days"],
                  ["90", "90 days"],
                ]}
              />
            </Row>
            <Row
              label="Keep screen recordings"
              hint="The Work Map stays when its video is removed."
              soon
            >
              <Choice
                label="Keep screen recordings"
                value={s.keepRecordings}
                onChange={(v) => set("keepRecordings", v)}
                options={[
                  ["90", "90 days"],
                  ["365", "1 year"],
                  ["forever", "Forever"],
                ]}
              />
            </Row>
            <Row
              label="Keep full transcripts"
              hint="Off keeps only the quotes used in the Work Map."
              soon
            >
              <Switch
                aria-label="Keep full transcripts"
                checked={s.keepTranscripts}
                onCheckedChange={(v) => set("keepTranscripts", v)}
              />
            </Row>
            <Row
              label="Let the expert review before saving"
              hint="Quotes and clips are shown for approval at the end of the debrief."
              soon
            >
              <Switch
                aria-label="Let the expert review before saving"
                checked={s.expertReview}
                onCheckedChange={(v) => set("expertReview", v)}
              />
            </Row>
            <Row label="Your data" hint="Every Work Map, transcript and recording." soon>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-full" disabled>
                  <Download size={13} />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full text-destructive hover:text-destructive"
                  disabled
                >
                  <Trash2 size={13} />
                  Delete all
                </Button>
              </div>
            </Row>
          </Section>

          <Section id="work-maps" title="Work Maps" description="How sessions are written up.">
            <Row label="Open Work Maps as" soon>
              <Segmented
                value={s.openAs}
                onChange={(v) => set("openAs", v)}
                options={[
                  ["map", "Map"],
                  ["steps", "Steps"],
                  ["transcript", "Transcript"],
                ]}
              />
            </Row>
            <Row
              label="Highlight judgment calls"
              hint="Steps where you decided something stand out."
              soon
            >
              <Switch
                aria-label="Highlight judgment calls"
                checked={s.highlightJudgment}
                onCheckedChange={(v) => set("highlightJudgment", v)}
              />
            </Row>
            <Row label="Name sessions from the task" hint="Otherwise they’re named by date." soon>
              <Switch
                aria-label="Name sessions from the task"
                checked={s.nameFromTask}
                onCheckedChange={(v) => set("nameFromTask", v)}
              />
            </Row>
            <Row
              label="Merge repeat sessions"
              hint="Several recordings of the same task build one Work Map."
              soon
            >
              <Switch
                aria-label="Merge repeat sessions"
                checked={s.mergeRepeats}
                onCheckedChange={(v) => set("mergeRepeats", v)}
              />
            </Row>
            <Row label="Export as" soon>
              <Segmented
                value={s.exportFormat}
                onChange={(v) => set("exportFormat", v)}
                options={[
                  ["pdf", "PDF"],
                  ["markdown", "Markdown"],
                  ["sop", "SOP doc"],
                ]}
              />
            </Row>
            <Row label="Include in exports" soon>
              <div className="flex flex-col items-end gap-2 text-xs">
                <Check
                  label="Screen thumbnails"
                  checked={s.exportThumbnails}
                  onChange={(v) => set("exportThumbnails", v)}
                />
                <Check
                  label="Quotes"
                  checked={s.exportQuotes}
                  onChange={(v) => set("exportQuotes", v)}
                />
                <Check
                  label="Open questions"
                  checked={s.exportOpenQuestions}
                  onChange={(v) => set("exportOpenQuestions", v)}
                />
              </div>
            </Row>
          </Section>

          <Section
            id="teaching"
            title="Teaching"
            description="The tutor that coaches someone else through a Work Map."
          >
            <Row label="Tutor voice" soon>
              <Choice
                label="Tutor voice"
                value={s.tutorVoice}
                onChange={(v) => set("tutorVoice", v)}
                options={VOICE_OPTIONS}
              />
            </Row>
            <Row
              label="When the learner breaks a rule"
              hint="Stepping in at once is safest for real work."
              soon
            >
              <Choice
                label="When the learner breaks a rule"
                value={s.ruleBreak}
                onChange={(v) => set("ruleBreak", v)}
                options={[
                  ["now", "Step in at once"],
                  ["pause", "At the next pause"],
                  ["end", "In the report"],
                ]}
              />
            </Row>
            <Row
              label="Ask the learner to predict"
              hint="Before a judgment call: “What would you do here?”"
              soon
            >
              <Switch
                aria-label="Ask the learner to predict"
                checked={s.askPredict}
                onCheckedChange={(v) => set("askPredict", v)}
              />
            </Row>
            <Row
              label="Mastered after"
              hint="Correct handling of a step or guardrail in a row."
              soon
            >
              <Choice
                label="Mastered after"
                value={s.masteredAfter}
                onChange={(v) => set("masteredAfter", v)}
                options={[
                  ["2", "2 in a row"],
                  ["3", "3 in a row"],
                  ["5", "5 in a row"],
                ]}
              />
            </Row>
            <Row
              label="Send the report to the expert"
              hint="Mastered, practice next and not covered."
              soon
            >
              <Switch
                aria-label="Send the report to the expert"
                checked={s.sendReport}
                onCheckedChange={(v) => set("sendReport", v)}
              />
            </Row>
          </Section>

          <Section id="pill" title="Pill & app" description="The floating pill and the app window.">
            <Row label="Pill position" soon>
              <Segmented
                value={s.pillPosition}
                onChange={(v) => set("pillPosition", v)}
                options={[
                  ["bottom", "Bottom"],
                  ["bottom-right", "Bottom right"],
                  ["top", "Top"],
                ]}
              />
            </Row>
            <Row label="Start in pill mode" hint="Open just the pill, not this window." soon>
              <Switch
                aria-label="Start in pill mode"
                checked={s.startInPill}
                onCheckedChange={(v) => set("startInPill", v)}
              />
            </Row>
            <Row label="Open Tacit at login" soon>
              <Switch
                aria-label="Open Tacit at login"
                checked={s.openAtLogin}
                onCheckedChange={(v) => set("openAtLogin", v)}
              />
            </Row>
            <Row label="Sound cues" hint="A soft chime when the apprentice has a question." soon>
              <Switch
                aria-label="Sound cues"
                checked={s.soundCues}
                onCheckedChange={(v) => set("soundCues", v)}
              />
            </Row>
            <Row label="Hide the pill in screen shares" soon>
              <Switch
                aria-label="Hide the pill in screen shares"
                checked={s.hideInShares}
                onCheckedChange={(v) => set("hideInShares", v)}
              />
            </Row>
            <Row label="Appearance" soon>
              <Segmented
                value={s.appearance}
                onChange={(v) => set("appearance", v)}
                options={[
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ]}
              />
            </Row>
          </Section>

          <Section
            id="shortcuts"
            title="Shortcuts"
            description="In the pill, and anywhere on your Mac."
          >
            {(
              [
                ["Show or hide the pill", ["⌥", "⌘", "T"], true],
                ["Start or end a session", ["S"]],
                ["Mute the microphone", ["R"]],
                ["Go off the record", ["O"]],
                ["Answer a question later", ["L"]],
                ["Carry on after an answer", ["↵"]],
                ["Skip a debrief question", ["→"]],
              ] as [string, string[], boolean?][]
            ).map(([label, keys, global]) => (
              <Row
                key={label}
                label={label}
                hint={global ? "Works in any app." : undefined}
                soon={global ?? false}
              >
                <div className="flex gap-1 p-1">
                  {keys.map((k) => (
                    <kbd
                      key={k}
                      className="min-w-6 rounded-md border bg-background px-1.5 py-0.5 text-center font-mono text-[11px] text-muted-foreground shadow-[0_1px_0_var(--border)]"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </Row>
            ))}
          </Section>

          <Section
            id="integrations"
            title="Integrations"
            description="Send confirmed Work Maps where your team already works."
          >
            <Row
              label="Coming soon"
              hint="Notion, Confluence, Google Drive, Slack and your own webhook. Nothing is connected yet."
            >
              <SoonBadge />
            </Row>
          </Section>

          <Section
            id="diagnostics"
            title="Diagnostics"
            description="When the apprentice can’t hear, see or save."
          >
            <Diagnostics />
          </Section>
        </div>
      </div>
    </main>
  );
}

// Runs only when asked: the agent checks ask ElevenLabs for a conversation token.
function Diagnostics() {
  const [results, setResults] = useState<Diagnostic[] | null>(null);
  const [running, setRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      setResults(await runDiagnostics());
      setCheckedAt(new Date());
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Row
        label="Check the setup"
        hint={
          checkedAt
            ? `Last checked at ${checkedAt.toLocaleTimeString()}.`
            : "Backend, name redaction, storage and both voice agents."
        }
      >
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => void run()}
          disabled={running}
        >
          <RefreshCw size={13} className={cn(running && "animate-spin")} />
          {running ? "Checking" : "Run checks"}
        </Button>
      </Row>
      {results?.map(({ id, label, ok, detail }) => (
        <Row key={id} label={label} hint={detail}>
          <span className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                ok === null ? "bg-muted-foreground/40" : ok ? "bg-success" : "bg-warning",
              )}
            />
            {ok === null ? "Not checked" : ok ? "OK" : "Needs attention"}
          </span>
        </Row>
      ))}
    </>
  );
}

// A span, so it can sit inside a sentence.
function SoonBadge() {
  return (
    <span
      className={cn(
        badgeVariants({ variant: "outline" }),
        "rounded-full px-1.5 py-0 align-middle text-[10px] font-normal text-muted-foreground",
      )}
    >
      Soon
    </span>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-10">
      <h2 className="font-display text-2xl tracking-tight">{title}</h2>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{description}</p>
      <div className="divide-y rounded-2xl border bg-card">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  soon = false,
  children,
}: {
  label: string;
  hint?: string | undefined;
  /** Saved, but nothing reads it yet. */
  soon?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm">
          {label}
          {soon && <SoonBadge />}
        </p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-full border bg-background p-0.5 text-xs">
      {options.map(([option, label]) => (
        <button
          key={option}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-full px-3 py-1 transition-colors",
            value === option
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const option = options.find(([o]) => o === v);
        if (option) onChange(option[0]);
      }}
    >
      <SelectTrigger aria-label={label} className="h-9 w-44 rounded-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v} className="text-xs">
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SliderWithValue(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <div className="flex w-44 items-center gap-3">
      <Slider
        aria-label={props.label}
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueChange={([v]) => {
          if (v !== undefined) props.onChange(v);
        }}
      />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {props.value}
        {props.unit}
      </span>
    </div>
  );
}

function Chips({
  items,
  onChange,
  addLabel,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  addLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const add = () => {
    const item = (draft ?? "").trim().slice(0, 60);
    if (item && !items.includes(item)) onChange([...items, item]);
    setDraft(null);
  };
  return (
    <div className="flex max-w-64 flex-wrap justify-end gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-xs"
        >
          {item}
          <button
            onClick={() => onChange(items.filter((i) => i !== item))}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Remove ${item}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      {draft === null ? (
        <button
          onClick={() => setDraft("")}
          className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus size={11} />
          {addLabel}
        </button>
      ) : (
        <input
          autoFocus
          aria-label={addLabel}
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
            else if (e.key === "Escape") setDraft(null);
          }}
          onBlur={add}
          className="w-28 rounded-full border bg-background px-2.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      )}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} className="scale-75" />
    </label>
  );
}
