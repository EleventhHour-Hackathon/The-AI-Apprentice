import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, CheckCheck, ChevronRight, RotateCcw, Trash2 } from "lucide-react";
import { DeleteWorkMap } from "@/components/DeleteWorkMap";
import { Button } from "@/components/ui/button";
import { count, fetchWorkMaps, recordedAt, taskTitle, type WorkMapSummary } from "@/lib/work-maps";

export const Route = createFileRoute("/work-maps/")({
  head: () => ({ meta: [{ title: "Work Maps · AI Apprentice" }] }),
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
      <header className="flex h-12 items-center gap-2 border-b bg-card px-3 text-sm font-semibold">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          aria-label="Home"
          asChild
        >
          <Link to="/">
            <ArrowLeft size={15} />
          </Link>
        </Button>
        Work Maps
      </header>
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
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
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {maps.map((map) => (
              <li key={map.id} className="group flex items-center transition-colors hover:bg-muted">
                <Link
                  to="/work-maps/$id"
                  params={{ id: map.id }}
                  className="flex min-w-0 flex-1 items-center gap-4 py-4 pl-5 pr-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{taskTitle(map.task)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {recordedAt(map.recorded_at)} · {count(map.steps, "step")} ·{" "}
                      {count(map.guardrails, "guardrail")}
                      {map.open_questions > 0 && ` · ${map.open_questions} open`}
                    </p>
                  </div>
                  {map.confirmed && (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <CheckCheck size={12} className="text-voice-listening" />
                      Confirmed
                    </span>
                  )}
                  <ChevronRight size={15} className="text-muted-foreground" />
                </Link>
                <DeleteWorkMap
                  id={map.id}
                  task={map.task}
                  onDeleted={() => setMaps((list) => list?.filter((m) => m.id !== map.id) ?? null)}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mr-3 h-8 w-8 rounded-full text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    title="Delete Work Map"
                    aria-label={`Delete ${taskTitle(map.task)}`}
                  >
                    <Trash2 size={14} />
                  </Button>
                </DeleteWorkMap>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
