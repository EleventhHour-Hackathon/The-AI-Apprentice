import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  applyNodeChanges,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ArrowLeft,
  CheckCheck,
  Clock,
  Download,
  GraduationCap,
  MessageSquareText,
  Trash2,
  X,
} from "lucide-react";
import { desktop } from "@/lib/desktop";
import { DeleteWorkMap } from "@/components/DeleteWorkMap";
import { Button } from "@/components/ui/button";
import {
  count,
  guardLabel,
  mmss,
  normalizeMap,
  recordedAt,
  taskTitle,
  type WorkMap as MapData,
  type WorkMapGuardrail,
  type WorkMapRecord,
  type WorkMapStep,
} from "@/lib/work-maps";

const COL = 290;
const GUARD_GAP = 96;
const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };
// Fixed height, so step connectors stay straight whatever each card's height.
const stepHandle = { ...hidden, top: 24 };

type StepData = { step: WorkMapStep; n: number; selected: boolean };
type NoteData = {
  label: string;
  text: string;
  tone: "warm" | "plain" | "open";
  selected: boolean;
};
type LaneData = { label: string };
/** What the side panel shows. */
type Selection = { type: "step" | "guardrail"; index: number } | { type: "transcript" } | null;

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const s = data.step;
  return (
    <div
      className={`wm-node w-[250px] overflow-hidden rounded-2xl border bg-card text-card-foreground ${data.selected ? "wm-node-selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} style={stepHandle} />
      {s.thumb && (
        <img
          src={s.thumb}
          alt={`Screen at ${mmss(s.at)}`}
          className="h-[132px] w-full border-b object-cover object-top"
        />
      )}
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{String(data.n).padStart(2, "0")}</span>
          {s.judgment && (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-voice-listening" />
              <span className="text-foreground/70">Judgment call</span>
            </>
          )}
          {s.at !== null && <span className="ml-auto font-mono">{mmss(s.at)}</span>}
        </div>
        <p className="mt-1.5 line-clamp-3 text-[13px] font-medium leading-snug">{s.title}</p>
        {s.decision && (
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-foreground/70">
            {s.decision}
          </p>
        )}
        {s.quote && (
          <p className="mt-1.5 line-clamp-2 text-[11px] italic leading-snug text-foreground/60">
            “{s.quote}”
          </p>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={stepHandle} />
      <Handle id="g" type="source" position={Position.Bottom} style={hidden} />
    </div>
  );
}

function NoteNode({ data }: NodeProps<Node<NoteData>>) {
  return (
    <div
      className={`wm-node w-[250px] rounded-2xl border px-3.5 py-2.5 ${data.tone === "warm" ? "wm-guard-warm" : "bg-card text-card-foreground"} ${data.selected ? "wm-node-selected" : ""}`}
    >
      <Handle type="target" position={Position.Top} style={hidden} />
      <span className="flex items-center gap-1 text-[10px] font-medium opacity-75">
        {data.tone === "open" && <Clock size={10} />}
        {data.label}
      </span>
      <p className="mt-1 line-clamp-3 text-[12px] leading-snug">{data.text}</p>
    </div>
  );
}

function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  return (
    <span className="block w-[120px] text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {data.label}
    </span>
  );
}

const nodeTypes = { step: StepNode, note: NoteNode, lane: LaneNode };

type Props = { map: WorkMapRecord; onClose: () => void };
export function WorkMap(props: Props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

/** Lay the map out: steps left to right, each step's guardrails under it, then the rest. */
function layoutMap(map: MapData, selected: Selection) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const lane = (label: string, y: number) =>
    nodes.push({
      id: `lane-${label}`,
      type: "lane",
      position: { x: -150, y: y + 4 },
      data: { label } satisfies LaneData,
      selectable: false,
    });
  const isSelected = (type: "step" | "guardrail", index: number) =>
    selected?.type === type && selected.index === index;
  const guardNode = (g: WorkMapGuardrail, index: number, x: number, y: number) => ({
    id: `guardrail-${index}`,
    type: "note",
    position: { x, y },
    data: {
      label: guardLabel[g.kind] + (g.ask_whom ? ` · ${g.ask_whom}` : ""),
      text: g.rule,
      tone: g.kind === "stop_and_ask" ? "warm" : "plain",
      selected: isSelected("guardrail", index),
    } satisfies NoteData,
  });

  const stepsHeight = map.steps.some((s) => s.thumb) ? 330 : 190;
  const stepIndex = new Map(map.steps.map((s, i) => [s.id, i]));
  let y = 0;
  if (map.steps.length) {
    lane("Steps", y);
    map.steps.forEach((step, i) => {
      const id = `step-${i}`;
      nodes.push({
        id,
        type: "step",
        position: { x: i * COL, y },
        data: { step, n: i + 1, selected: isSelected("step", i) } satisfies StepData,
      });
      if (i > 0) edges.push({ id: `step-${i - 1}-${id}`, source: `step-${i - 1}`, target: id });
    });
    y += stepsHeight;
  }

  // Guardrails tied to a step hang under it; the rest get a lane of their own.
  const stacked = new Map<number, number>();
  const loose: number[] = [];
  map.guardrails.forEach((g, gi) => {
    const si = stepIndex.get(g.step);
    if (si === undefined) {
      loose.push(gi);
      return;
    }
    const depth = stacked.get(si) ?? 0;
    stacked.set(si, depth + 1);
    nodes.push(guardNode(g, gi, si * COL, y + depth * GUARD_GAP));
    edges.push({
      id: `step-${si}-guardrail-${gi}`,
      source: `step-${si}`,
      sourceHandle: "g",
      target: `guardrail-${gi}`,
      className: "wm-edge-guard",
    });
  });
  if (stacked.size) {
    lane("Guardrails", y);
    y += Math.max(...stacked.values()) * GUARD_GAP + 40;
  }
  if (loose.length) {
    lane(stacked.size ? "Other guardrails" : "Guardrails", y);
    loose.forEach((gi, i) => nodes.push(guardNode(map.guardrails[gi]!, gi, i * COL, y)));
    y += 130;
  }

  const notes = (label: string, items: string[], tone: NoteData["tone"], kind: string) => {
    if (!items.length) return;
    lane(label, y);
    items.forEach((text, i) =>
      nodes.push({
        id: `${kind}-${i}`,
        type: "note",
        position: { x: i * COL, y },
        data: {
          label: kind === "open" ? "Open question" : "Correction",
          text,
          tone,
          selected: false,
        } satisfies NoteData,
      }),
    );
    y += 130;
  };
  notes("Open questions", map.open_questions, "open", "open");
  notes("Corrections", map.corrections ?? [], "plain", "correction");
  return { nodes, edges };
}

function Canvas({ map: record, onClose }: Props) {
  const map = useMemo(() => normalizeMap(record), [record]);
  const [selected, setSelected] = useState<Selection>(null);
  const empty = map.steps.length + map.guardrails.length + map.open_questions.length === 0;
  const judgments = map.steps.filter((s) => s.judgment).length;

  const layout = useMemo(() => layoutMap(map, selected), [map, selected]);
  // React Flow reports node sizes through onNodesChange; keep them so the minimap can draw.
  const [nodes, setNodes] = useState<Node[]>([]);
  useEffect(
    () =>
      setNodes((previous) =>
        layout.nodes.map((n) => {
          const measured = previous.find((p) => p.id === n.id)?.measured;
          return measured ? { ...n, measured } : n;
        }),
      ),
    [layout],
  );

  const pick = (id: string): Selection => {
    const [kind, index] = [
      id.slice(0, id.lastIndexOf("-")),
      Number(id.slice(id.lastIndexOf("-") + 1)),
    ];
    if (kind === "step") return { type: "step", index };
    if (kind === "guardrail") return { type: "guardrail", index };
    return null;
  };

  const exportMap = () => {
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const slug = (map.task ?? "work-map")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    a.download = `${slug || "work-map"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const keys = useRef({ exportMap, onClose, selected });
  keys.current = { exportMap, onClose, selected };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        // The delete dialog handles its own keys (Esc closes it, not the map).
        target.closest('input, textarea, [contenteditable=true], [role="alertdialog"]') ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.repeat
      )
        return;
      const k = e.key.toLowerCase();
      const a = keys.current;
      if (k === "e") {
        e.preventDefault();
        a.exportMap();
      } else if (k === "escape") {
        e.preventDefault();
        if (a.selected) setSelected(null);
        else a.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const step = selected?.type === "step" ? map.steps[selected.index] : undefined;
  const guard = selected?.type === "guardrail" ? map.guardrails[selected.index] : undefined;
  const stepGuards = step ? map.guardrails.filter((g) => g.step === step.id) : [];

  return (
    <div className="workmap-fade flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b bg-card px-5 py-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          title="All Work Maps (Esc)"
          aria-label="All Work Maps"
          onClick={onClose}
        >
          <ArrowLeft size={15} />
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-medium">{taskTitle(map.task)} · Work Map</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {recordedAt(map.recorded_at)} · {count(map.steps.length, "step")} ·{" "}
            {count(judgments, "judgment call")} · {count(map.guardrails.length, "guardrail")}
            {map.open_questions.length > 0 && ` · ${map.open_questions.length} open`}
          </p>
        </div>
        <span
          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${map.confirmed ? "" : "text-muted-foreground"}`}
        >
          {map.confirmed ? (
            <>
              <CheckCheck size={12} className="text-voice-listening" />
              Confirmed by expert
            </>
          ) : (
            "Not confirmed"
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {map.steps.length > 0 && (
            <Button
              variant="outline"
              className="h-8 rounded-full text-xs"
              title="A new hire works a case while the tutor watches"
              onClick={() => teach(map.id)}
            >
              <GraduationCap size={13} />
              Teach a new hire
            </Button>
          )}
          {map.transcript.length > 0 && (
            <Button
              variant="outline"
              className="h-8 rounded-full text-xs"
              onClick={() => setSelected({ type: "transcript" })}
            >
              <MessageSquareText size={13} />
              Transcript
            </Button>
          )}
          <DeleteWorkMap id={map.id} task={map.task} onDeleted={onClose}>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive"
              title="Delete Work Map"
              aria-label="Delete Work Map"
            >
              <Trash2 size={14} />
            </Button>
          </DeleteWorkMap>
          <Button className="h-8 rounded-full text-xs" title="Export JSON (E)" onClick={exportMap}>
            <Download size={13} />
            Export<Kbd>E</Kbd>
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {empty ? (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <p className="text-sm font-medium">Nothing was captured in this session.</p>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                The apprentice records steps and guardrails once it learns the reason behind them.
                {map.transcript.length > 0 && " The transcript is still available."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ReactFlow
              nodes={nodes}
              edges={layout.edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => setNodes((ns) => applyNodeChanges(changes, ns))}
              fitView
              fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
              minZoom={0.3}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => setSelected(pick(n.id))}
              onPaneClick={() => setSelected(null)}
              className="workmap-flow"
            >
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                className="wm-minimap"
                nodeColor="#cfcfd4"
                maskColor="rgba(247, 246, 243, 0.6)"
              />
            </ReactFlow>
            <p className="pointer-events-none absolute bottom-4 left-6 text-[10px] text-muted-foreground">
              Scroll to zoom · drag to pan · click a step or guardrail for details
            </p>
          </>
        )}

        {selected && (
          <aside
            aria-label="Details"
            className="sia-fade absolute bottom-4 right-4 top-4 z-10 flex w-[400px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-3xl border border-pill-border bg-pill p-5 text-pill-foreground"
            style={{ boxShadow: "var(--voice-shadow)" }}
          >
            <div className="flex items-center gap-2 text-[11px] text-pill-muted">
              <span className="font-mono">
                {step &&
                  selected.type === "step" &&
                  `STEP ${String(selected.index + 1).padStart(2, "0")} OF ${String(map.steps.length).padStart(2, "0")}`}
                {guard && guardLabel[guard.kind].toUpperCase()}
                {selected.type === "transcript" && "TRANSCRIPT"}
              </span>
              {step?.judgment && <span className="text-voice-listening">· Judgment call</span>}
              <Button
                variant="ghost"
                className="voice-icon ml-auto h-7"
                title="Close (Esc)"
                aria-label="Close"
                onClick={() => setSelected(null)}
              >
                <X size={13} />
              </Button>
            </div>
            {step && (
              <>
                <h2 className="mt-1 text-xl font-medium leading-snug">{step.title}</h2>
                <ScreenMoment at={step.at} thumb={step.thumb} what={step.screen || step.event} />
                {step.decision && <Section label="Decision">{step.decision}</Section>}
                <Section label="Reason">
                  {step.reason || step.quote ? (
                    <Quote
                      text={step.quote || step.reason}
                      verbatim={Boolean(step.quote)}
                      source={step.quote_source}
                      at={step.quote_at}
                    />
                  ) : (
                    <span className="text-pill-muted">No reason given.</span>
                  )}
                </Section>
                {stepGuards.length > 0 && (
                  <Section label="Guardrails">
                    {stepGuards.map((g) => (
                      <div key={g.id} className="mb-2 rounded-xl bg-pill-raised p-3">
                        <span
                          className={`text-[10px] font-medium ${g.kind === "stop_and_ask" ? "text-voice-raised" : "text-pill-muted"}`}
                        >
                          {guardLabel[g.kind]}
                          {g.ask_whom && ` · ask ${g.ask_whom}`}
                        </span>
                        <p className="mt-1">{g.rule}</p>
                      </div>
                    ))}
                  </Section>
                )}
              </>
            )}
            {guard && (
              <>
                <h2 className="mt-1 text-xl font-medium leading-snug">{guard.rule}</h2>
                <ScreenMoment at={guard.at} thumb={guard.thumb} what={guard.event} />
                {guard.applies_when && <Section label="Applies when">{guard.applies_when}</Section>}
                {guard.ask_whom && (
                  <Section label="Stop and ask">
                    <span className="text-voice-raised">{guard.ask_whom}</span>
                  </Section>
                )}
                {guard.quote && (
                  <Section label="In the expert's words">
                    <Quote
                      text={guard.quote}
                      verbatim
                      source={guard.quote_source}
                      at={guard.quote_at}
                    />
                  </Section>
                )}
              </>
            )}
            {selected.type === "transcript" && (
              <ol className="mt-3 space-y-3">
                {map.transcript.map((line, i) => (
                  <li key={i} className="text-[12.5px] leading-relaxed">
                    <span className="block font-mono text-[10px] text-pill-muted">
                      {line.who === "expert" ? "EXPERT" : "APPRENTICE"}
                      {line.t !== null && ` · ${mmss(line.t)}`}
                    </span>
                    <span className={line.who === "expert" ? "" : "text-pill-foreground/80"}>
                      {line.text}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** Start a lesson from this map: in the desktop pill, or on the home page in a browser. */
function teach(workMapId: string) {
  const bridge = desktop();
  if (bridge) bridge.pill(`lesson:${workMapId}`);
  else window.location.assign(`/?lesson=${encodeURIComponent(workMapId)}`);
}

function ScreenMoment({
  at,
  thumb,
  what,
}: {
  at: number | null;
  thumb?: string | null;
  what?: string | null;
}) {
  if (!thumb && !what) return null;
  return (
    <Section label={`Screen moment${at !== null ? ` · ${mmss(at)}` : ""}`}>
      {thumb && (
        <img
          src={thumb}
          alt={what ?? "Screen moment"}
          className="w-full rounded-lg border border-pill-border object-cover object-top"
        />
      )}
      {what && <p className="mt-1.5 text-[12px] text-pill-muted">{what}</p>}
    </Section>
  );
}

function Quote({
  text,
  verbatim,
  source,
  at,
}: {
  text: string;
  verbatim: boolean;
  source: string;
  at: number | null;
}) {
  return (
    <blockquote className="border-l-2 border-voice-debrief pl-3">
      <p className={verbatim ? "italic" : ""}>{verbatim ? `“${text}”` : text}</p>
      <span
        className={`mt-1.5 block font-mono text-[10px] ${source === "live" ? "text-voice-listening" : "text-voice-debrief"}`}
      >
        {verbatim
          ? `Expert, ${source === "debrief" ? "in the debrief" : "while working"}${at !== null ? ` at ${mmss(at)}` : ""}`
          : "Paraphrased by the apprentice"}
      </span>
    </blockquote>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-pill-muted">
        {label}
      </h3>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </section>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/20 px-1 font-mono text-[9px] opacity-60">
      {children}
    </kbd>
  );
}
