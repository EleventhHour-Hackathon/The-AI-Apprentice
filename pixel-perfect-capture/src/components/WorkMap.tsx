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
import { ArrowLeft, CheckCheck, Clock, Download, MessageSquareText, Trash2, X } from "lucide-react";
import { DeleteWorkMap } from "@/components/DeleteWorkMap";
import { Button } from "@/components/ui/button";
import {
  count,
  recordedAt,
  taskTitle,
  type WorkMapGuardrail,
  type WorkMapRecord,
  type WorkMapStep,
} from "@/lib/work-maps";

const COL = 280;
const NOTE_COL = 270;
const hidden = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0 };
// Fixed height, so step connectors stay straight whatever each card's height.
const stepHandle = { ...hidden, top: 24 };

type NoteKind = "Guardrail" | "Stop and ask" | "Open question" | "Correction";
type StepData = { step: WorkMapStep; n: number; selected: boolean };
type NoteData = { kind: NoteKind; text: string; selected: boolean };
type LaneData = { label: string };
/** What the side panel shows: a step, a guardrail, or the transcript. */
type Selection = { type: "step" | "guardrail"; index: number } | { type: "transcript" } | null;

const guardKind = (g: WorkMapGuardrail): NoteKind =>
  g.stop_and_ask ? "Stop and ask" : "Guardrail";

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const s = data.step;
  return (
    <div
      className={`wm-node w-[220px] rounded-2xl border bg-card px-3.5 py-3 text-card-foreground ${data.selected ? "wm-node-selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} style={stepHandle} />
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono">{String(data.n).padStart(2, "0")}</span>
        {s.decision && (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-voice-listening" />
            <span className="text-foreground/70">Decision</span>
          </>
        )}
      </div>
      <p className="mt-1.5 line-clamp-3 text-[13px] font-medium leading-snug">{s.step}</p>
      {s.decision && (
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-foreground/70">
          {s.decision}
        </p>
      )}
      <Handle type="source" position={Position.Right} style={stepHandle} />
    </div>
  );
}

function NoteNode({ data }: NodeProps<Node<NoteData>>) {
  const warm = data.kind === "Stop and ask";
  const open = data.kind === "Open question";
  return (
    <div
      className={`wm-node w-[250px] rounded-2xl border px-3.5 py-2.5 ${warm ? "wm-guard-warm" : "bg-card text-card-foreground"} ${data.selected ? "wm-node-selected" : ""}`}
    >
      <span className="flex items-center gap-1 text-[10px] font-medium opacity-75">
        {open && <Clock size={10} />}
        {data.kind}
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

function Canvas({ map, onClose }: Props) {
  const [selected, setSelected] = useState<Selection>(null);
  const transcript = map.transcript ?? [];
  const empty = map.steps.length + map.guardrails.length + map.open_questions.length === 0;

  // Steps run left to right. Guardrails, open questions and corrections were not recorded
  // against a particular step, so each gets its own lane below rather than an implied link.
  const layout = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    let y = 0;
    const lane = (label: string) =>
      nodes.push({
        id: `lane-${label}`,
        type: "lane",
        position: { x: -150, y: y + 4 },
        data: { label } satisfies LaneData,
        selectable: false,
      });

    if (map.steps.length) {
      lane("Steps");
      map.steps.forEach((step, i) => {
        const id = `step-${i}`;
        nodes.push({
          id,
          type: "step",
          position: { x: i * COL, y },
          data: {
            step,
            n: i + 1,
            selected: selected?.type === "step" && selected.index === i,
          } satisfies StepData,
        });
        if (i > 0) edges.push({ id: `step-${i - 1}-${id}`, source: `step-${i - 1}`, target: id });
      });
      y += 190;
    }
    const notes = (
      label: string,
      items: { kind: NoteKind; text: string; selected?: boolean }[],
    ) => {
      if (!items.length) return;
      lane(label);
      items.forEach((item, i) =>
        nodes.push({
          id: `${label}-${i}`,
          type: "note",
          position: { x: i * NOTE_COL, y },
          data: {
            kind: item.kind,
            text: item.text,
            selected: Boolean(item.selected),
          } satisfies NoteData,
        }),
      );
      y += 130;
    };
    notes(
      "Guardrails",
      map.guardrails.map((g, i) => ({
        kind: guardKind(g),
        text: g.rule,
        selected: selected?.type === "guardrail" && selected.index === i,
      })),
    );
    notes(
      "Open questions",
      map.open_questions.map((text) => ({ kind: "Open question" as const, text })),
    );
    notes(
      "Corrections",
      (map.corrections ?? []).map((text) => ({ kind: "Correction" as const, text })),
    );
    return { nodes, edges };
  }, [map, selected]);
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
  const edges = layout.edges;

  const pick = (id: string): Selection => {
    const [kind, index] = [
      id.slice(0, id.lastIndexOf("-")),
      Number(id.slice(id.lastIndexOf("-") + 1)),
    ];
    if (kind === "step") return { type: "step", index };
    if (kind === "Guardrails") return { type: "guardrail", index };
    return null;
  };

  const exportMap = () => {
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
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
            {count(map.guardrails.length, "guardrail")}
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
          {transcript.length > 0 && (
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
                {transcript.length > 0 && " The transcript is still available."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
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
            className="sia-fade absolute bottom-4 right-4 top-4 z-10 flex w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-3xl border border-pill-border bg-pill p-5 text-pill-foreground"
            style={{ boxShadow: "var(--voice-shadow)" }}
          >
            <div className="flex items-center gap-2 text-[11px] text-pill-muted">
              <span className="font-mono">
                {step &&
                  selected.type === "step" &&
                  `STEP ${String(selected.index + 1).padStart(2, "0")}`}
                {guard && guardKind(guard).toUpperCase()}
                {selected.type === "transcript" && "TRANSCRIPT"}
              </span>
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
                <h2 className="mt-1 text-xl font-medium leading-snug">{step.step}</h2>
                {step.screen_moment && <Section label="On screen">{step.screen_moment}</Section>}
                {step.decision && <Section label="Decision">{step.decision}</Section>}
                <Section label="Reason">
                  <blockquote className="border-l-2 border-voice-debrief pl-3 italic">
                    “{step.reason}”
                  </blockquote>
                </Section>
              </>
            )}
            {guard && (
              <>
                <h2 className="mt-1 text-xl font-medium leading-snug">{guard.rule}</h2>
                {guard.applies_when && <Section label="Applies when">{guard.applies_when}</Section>}
                {guard.stop_and_ask && (
                  <Section label="Stop and ask">
                    <span className="text-voice-raised">{guard.stop_and_ask}</span>
                  </Section>
                )}
              </>
            )}
            {selected.type === "transcript" && (
              <ol className="mt-3 space-y-3">
                {transcript
                  .filter((m) => m.content.trim())
                  .map((m, i) => {
                    const screen = m.content.startsWith("[SCREEN]");
                    return (
                      <li key={i} className="text-[12.5px] leading-relaxed">
                        <span className="block font-mono text-[10px] text-pill-muted">
                          {screen ? "SCREEN" : m.role === "assistant" ? "APPRENTICE" : "EXPERT"}
                        </span>
                        <span
                          className={
                            screen
                              ? "text-pill-muted"
                              : m.role === "user"
                                ? ""
                                : "text-pill-foreground/80"
                          }
                        >
                          {screen ? m.content.replace(/^\[SCREEN\]\s*/, "") : m.content}
                        </span>
                      </li>
                    );
                  })}
              </ol>
            )}
          </aside>
        )}
      </div>
    </div>
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
