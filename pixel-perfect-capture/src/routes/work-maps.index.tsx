import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCheck, ChevronRight, Clock, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { DeleteWorkMap } from "@/components/DeleteWorkMap";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  count,
  daysUntilDeleted,
  fetchWorkMaps,
  recordedAt,
  taskTitle,
  UNCONFIRMED_RETENTION_DAYS,
  type WorkMapSummary,
} from "@/lib/work-maps";

export const Route = createFileRoute("/work-maps/")({
  head: () => ({ meta: [{ title: "Work Maps · Tacit" }] }),
  component: WorkMaps,
});

/** Every Work Map the backend has saved, newest first. */
function WorkMaps() {
  const [maps, setMaps] = useState<WorkMapSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    setMaps(null);
    fetchWorkMaps().then(setMaps, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <h1 className="font-display text-4xl tracking-tight">Work Maps</h1>
        <p className="mt-1.5 mb-8 text-sm text-muted-foreground">
          What Tacit learned from each session: the steps, the judgment calls and the guardrails.
        </p>
        {error ? (
          <div role="alert" className="text-center text-sm">
            <p>{error}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Check that the backend in core/backend is running.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={load}>
              <RotateCcw size={13} />
              Retry
            </Button>
          </div>
        ) : maps === null ? (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        ) : maps.length === 0 ? (
          <div className="text-center">
            <p className="text-sm font-medium">No Work Maps yet.</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Finish a session with the apprentice and its Work Map appears here.
            </p>
          </div>
        ) : (
          <MapList
            maps={maps}
            onDeleted={(id) => setMaps((list) => list?.filter((m) => m.id !== id) ?? null)}
          />
        )}
      </div>
    </main>
  );
}

type Filter = "confirmed" | "unconfirmed";

/** Confirmed maps by default; unconfirmed ones sit behind a filter with their deletion countdown. */
function MapList({ maps, onDeleted }: { maps: WorkMapSummary[]; onDeleted: (id: string) => void }) {
  const confirmed = maps.filter((m) => m.confirmed);
  const unconfirmed = maps.filter((m) => !m.confirmed);
  const [filter, setFilter] = useState<Filter>(
    confirmed.length || !unconfirmed.length ? "confirmed" : "unconfirmed",
  );
  const shown = filter === "confirmed" ? confirmed : unconfirmed;

  return (
    <>
      <div
        role="tablist"
        aria-label="Filter Work Maps"
        className="mb-4 inline-flex rounded-full border bg-card p-0.5 text-xs"
      >
        {(
          [
            ["confirmed", "Confirmed", confirmed.length],
            ["unconfirmed", "Unconfirmed", unconfirmed.length],
          ] as const
        ).map(([value, label, n]) => (
          <button
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              filter === value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label} <span className="tabular-nums opacity-60">{n}</span>
          </button>
        ))}
      </div>

      {filter === "unconfirmed" && unconfirmed.length > 0 && (
        <div
          role="note"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs"
        >
          <TriangleAlert size={14} className="mt-px shrink-0 text-warning" />
          <p>
            Unconfirmed Work Maps are deleted {UNCONFIRMED_RETENTION_DAYS} days after they’re
            recorded. Only maps confirmed in the debrief are kept.
          </p>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filter === "confirmed"
            ? "No confirmed Work Maps yet."
            : "Nothing waiting to be confirmed."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((map) => (
            <MapRow key={map.id} map={map} onDeleted={() => onDeleted(map.id)} />
          ))}
        </ul>
      )}
    </>
  );
}

function MapRow({ map, onDeleted }: { map: WorkMapSummary; onDeleted: () => void }) {
  const days = map.confirmed ? null : daysUntilDeleted(map.recorded_at);
  return (
    <li className="group flex items-center rounded-2xl border bg-card transition-colors hover:border-foreground/15 hover:bg-muted/40">
      <Link
        to="/work-maps/$id"
        params={{ id: map.id }}
        className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-4 pr-2"
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            map.confirmed ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {map.confirmed ? <CheckCheck size={15} /> : <Clock size={15} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{taskTitle(map.task)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {recordedAt(map.recorded_at)} · {count(map.steps, "step")} ·{" "}
            {count(map.guardrails, "guardrail")}
            {map.open_questions > 0 && ` · ${map.open_questions} open`}
          </p>
        </div>
        {days !== null && (
          <span
            className={cn(
              "shrink-0 text-[11px] tabular-nums",
              days <= 3 ? "text-destructive" : "text-warning",
            )}
          >
            {days === 0 ? "Deleting soon" : `Deletes in ${count(days, "day")}`}
          </span>
        )}
        <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
      </Link>
      <DeleteWorkMap id={map.id} task={map.task} onDeleted={onDeleted}>
        <Button
          variant="ghost"
          size="icon"
          className="mr-3 h-8 w-8 rounded-full text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
          title="Delete Work Map"
          aria-label={`Delete ${taskTitle(map.task)}`}
        >
          <Trash2 size={14} />
        </Button>
      </DeleteWorkMap>
    </li>
  );
}
