import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AppWindow,
  Bot,
  Download,
  GraduationCap,
  Keyboard,
  Map,
  Mic,
  Monitor,
  Play,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Badge } from "@/components/ui/badge";
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
import { languageOptions, storeLanguage, storedLanguage, type LanguageChoice } from "@/lib/languages";

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

// Apprentice language is saved; the remaining controls are a preview.
function Settings() {
  const [language, setLanguage] = useState<LanguageChoice>("auto");
  useEffect(() => setLanguage(storedLanguage("apprentice")), []);

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
                Preview
              </Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground">
              How Tacit watches, asks, remembers and teaches. Apprentice language is saved on this machine; other settings are a preview.
            </p>
          </div>

          <Section
            id="apprentice"
            title="Apprentice"
            description="The voice that watches you work and asks why."
          >
            <Row label="Voice" hint="Who you hear during a session and the debrief.">
              <div className="flex items-center gap-2">
                <Choice
                  value="ivy"
                  options={[
                    ["ivy", "Ivy · warm"],
                    ["theo", "Theo · calm"],
                    ["mara", "Mara · brisk"],
                  ]}
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-full"
                  title="Play a sample"
                >
                  <Play size={13} />
                </Button>
              </div>
            </Row>
            <Row label="Curiosity" hint="How often it raises a question while you work.">
              <Segmented options={["Quiet", "Balanced", "Curious"]} initial="Balanced" />
            </Row>
            <Row
              label="Questions during the session"
              hint="At least this many before the debrief, one of them about a guardrail."
            >
              <Choice
                value="3"
                options={[
                  ["2", "At least 2"],
                  ["3", "At least 3"],
                  ["5", "At least 5"],
                ]}
              />
            </Row>
            <Row label="Speaking speed">
              <SliderWithValue initial={100} min={75} max={125} step={5} unit="%" />
            </Row>
            <Row label="Debrief" hint="How deep it goes once you end the session.">
              <Segmented options={["Short", "Standard", "Thorough"]} initial="Standard" />
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
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
            <Row
              label="Domain vocabulary"
              hint="Terms, acronyms and names it should hear correctly."
            >
              <Chips initial={["GL code", "3-way match", "Net 30"]} addLabel="Add term" />
            </Row>
            <Row label="Show live captions" hint="What you and the apprentice say, in the pill.">
              <Switch defaultChecked />
            </Row>
          </Section>

          <Section id="capture" title="Capture" description="What Tacit sees and records.">
            <Row label="Watch" hint="Asked again when a session starts if you pick each time.">
              <Choice
                value="screen"
                options={[
                  ["screen", "Entire screen"],
                  ["window", "One window"],
                  ["ask", "Choose each time"],
                ]}
              />
            </Row>
            <Row label="Record video" hint="Short clips of each step show up in the Work Map.">
              <Switch defaultChecked />
            </Row>
            <Row label="Video quality">
              <Segmented options={["720p", "1080p", "Native"]} initial="1080p" />
            </Row>
            <Row label="Read the screen every" hint="Faster notices more, and costs more.">
              <Segmented options={["2 s", "5 s", "10 s"]} initial="5 s" />
            </Row>
            <Row
              label="Blur sensitive fields"
              hint="Passwords, card numbers and IDs are blurred before upload."
            >
              <Switch defaultChecked />
            </Row>
            <Row label="Never watch these apps" hint="Tacit looks away while they are in front.">
              <Chips initial={["1Password", "Messages", "Mail"]} addLabel="Add app" />
            </Row>
            <Row label="Pause when you step away" hint="No input for a while pauses the session.">
              <Choice
                value="2"
                options={[
                  ["off", "Never"],
                  ["2", "After 2 min"],
                  ["5", "After 5 min"],
                ]}
              />
            </Row>
            <Row label="Microphone">
              <Choice
                value="default"
                options={[
                  ["default", "System default"],
                  ["mbp", "MacBook Pro Microphone"],
                  ["airpods", "AirPods Pro"],
                ]}
              />
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
            >
              <Switch defaultChecked />
            </Row>
            <Row label="Keep unconfirmed Work Maps">
              <Choice
                value="30"
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
            >
              <Choice
                value="forever"
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
            >
              <Switch defaultChecked />
            </Row>
            <Row
              label="Let the expert review before saving"
              hint="Quotes and clips are shown for approval at the end of the debrief."
            >
              <Switch />
            </Row>
            <Row label="Your data" hint="Every Work Map, transcript and recording.">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="rounded-full">
                  <Download size={13} />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full text-destructive hover:text-destructive"
                >
                  <Trash2 size={13} />
                  Delete all
                </Button>
              </div>
            </Row>
          </Section>

          <Section id="work-maps" title="Work Maps" description="How sessions are written up.">
            <Row label="Open Work Maps as">
              <Segmented options={["Map", "Steps", "Transcript"]} initial="Map" />
            </Row>
            <Row
              label="Highlight judgment calls"
              hint="Steps where you decided something stand out."
            >
              <Switch defaultChecked />
            </Row>
            <Row label="Name sessions from the task" hint="Otherwise they’re named by date.">
              <Switch defaultChecked />
            </Row>
            <Row
              label="Merge repeat sessions"
              hint="Several recordings of the same task build one Work Map."
            >
              <Switch />
            </Row>
            <Row label="Export as">
              <Segmented options={["PDF", "Markdown", "SOP doc"]} initial="PDF" />
            </Row>
            <Row label="Include in exports">
              <div className="flex flex-col items-end gap-2 text-xs">
                <Check label="Screen thumbnails" defaultChecked />
                <Check label="Quotes" defaultChecked />
                <Check label="Open questions" />
              </div>
            </Row>
          </Section>

          <Section
            id="teaching"
            title="Teaching"
            description="The tutor that coaches someone else through a Work Map."
          >
            <Row label="Tutor voice">
              <Choice
                value="theo"
                options={[
                  ["ivy", "Ivy · warm"],
                  ["theo", "Theo · calm"],
                  ["mara", "Mara · brisk"],
                ]}
              />
            </Row>
            <Row
              label="When the learner breaks a rule"
              hint="Stepping in at once is safest for real work."
            >
              <Choice
                value="now"
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
            >
              <Switch defaultChecked />
            </Row>
            <Row label="Mastered after" hint="Correct handling of a step or guardrail in a row.">
              <Choice
                value="3"
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
            >
              <Switch defaultChecked />
            </Row>
          </Section>

          <Section id="pill" title="Pill & app" description="The floating pill and the app window.">
            <Row label="Pill position">
              <Segmented options={["Bottom", "Bottom right", "Top"]} initial="Bottom" />
            </Row>
            <Row label="Start in pill mode" hint="Open just the pill, not this window.">
              <Switch />
            </Row>
            <Row label="Open Tacit at login">
              <Switch />
            </Row>
            <Row label="Sound cues" hint="A soft chime when the apprentice has a question.">
              <Switch defaultChecked />
            </Row>
            <Row label="Hide the pill in screen shares">
              <Switch defaultChecked />
            </Row>
            <Row label="Appearance">
              <Segmented options={["System", "Light", "Dark"]} initial="System" />
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
              <Row key={label} label={label} hint={global ? "Works in any app." : undefined}>
                <button
                  className="flex gap-1 rounded-md p-1 transition-colors hover:bg-muted"
                  title="Change shortcut"
                >
                  {keys.map((k) => (
                    <kbd
                      key={k}
                      className="min-w-6 rounded-md border bg-background px-1.5 py-0.5 text-center font-mono text-[11px] text-muted-foreground shadow-[0_1px_0_var(--border)]"
                    >
                      {k}
                    </kbd>
                  ))}
                </button>
              </Row>
            ))}
          </Section>

          <Section
            id="integrations"
            title="Integrations"
            description="Send confirmed Work Maps where your team already works."
          >
            {(
              [
                ["Notion", "A page per Work Map, steps as a checklist.", false],
                ["Confluence", "Publish to a space as an SOP.", false],
                ["Google Drive", "Recordings and exports in a folder.", true],
                ["Slack", "Post to a channel when a Work Map is confirmed.", false],
                ["Webhook", "POST the Work Map JSON to your own endpoint.", false],
              ] as const
            ).map(([name, hint, connected]) => (
              <Row key={name} label={name} hint={hint}>
                {connected ? (
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Connected
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-muted-foreground"
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="rounded-full">
                    Connect
                  </Button>
                )}
              </Row>
            ))}
          </Section>

          <Section
            id="diagnostics"
            title="Diagnostics"
            description="When the apprentice can’t hear, see or save."
          >
            {(
              [
                ["Backend", "localhost:8000", true],
                ["Voice agent", "ElevenLabs · AI Apprentice", true],
                ["Storage", "Supabase · screen-recordings", true],
                ["Screen recording permission", "Not granted to Tacit", false],
              ] as const
            ).map(([label, hint, ok]) => (
              <Row key={label} label={label} hint={hint}>
                <span className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-warning")}
                  />
                  {ok ? "OK" : "Needs attention"}
                </span>
              </Row>
            ))}
            <Row label="Test microphone" hint="Say something; the bar should move.">
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-2/5 rounded-full bg-foreground/60" />
                </div>
                <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" title="Test">
                  <Mic size={13} />
                </Button>
              </div>
            </Row>
            <Row
              label="Re-sync storage"
              hint="Matches recordings on disk, in Storage and in the database."
            >
              <Button variant="outline" size="sm" className="rounded-full">
                <RefreshCw size={13} />
                Check
              </Button>
            </Row>
            <Row label="Logs" hint="Tacit 0.1.0 · for a bug report.">
              <Button variant="outline" size="sm" className="rounded-full">
                <Download size={13} />
                Export logs
              </Button>
            </Row>
          </Section>
        </div>
      </div>
    </main>
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
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented({ options, initial }: { options: string[]; initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="inline-flex rounded-full border bg-background p-0.5 text-xs">
      {options.map((option) => (
        <button
          key={option}
          aria-pressed={value === option}
          onClick={() => setValue(option)}
          className={cn(
            "rounded-full px-3 py-1 transition-colors",
            value === option
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Choice({ value, options }: { value: string; options: [string, string][] }) {
  return (
    <Select defaultValue={value}>
      <SelectTrigger className="h-9 w-44 rounded-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v} className="text-xs">
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SliderWithValue(props: {
  initial: number;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <div className="flex w-44 items-center gap-3">
      <Slider
        value={[value]}
        min={props.min}
        max={props.max}
        step={props.step}
        onValueChange={([v]) => setValue(v ?? props.initial)}
      />
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
        {value}
        {props.unit}
      </span>
    </div>
  );
}

function Chips({ initial, addLabel }: { initial: string[]; addLabel: string }) {
  const [items, setItems] = useState(initial);
  return (
    <div className="flex max-w-64 flex-wrap justify-end gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-xs"
        >
          {item}
          <button
            onClick={() => setItems(items.filter((i) => i !== item))}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Remove ${item}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <button className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground">
        <Plus size={11} />
        {addLabel}
      </button>
    </div>
  );
}

function Check({ label, defaultChecked }: { label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2">
      {label}
      <Switch defaultChecked={defaultChecked ?? false} className="scale-75" />
    </label>
  );
}
