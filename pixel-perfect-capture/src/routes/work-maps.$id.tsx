import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkMap } from "@/components/WorkMap";
import { fetchWorkMap, taskTitle, type WorkMapRecord } from "@/lib/work-maps";

export const Route = createFileRoute("/work-maps/$id")({
  head: () => ({ meta: [{ title: "Work Map · AI Apprentice" }] }),
  component: WorkMapPage,
});

function WorkMapPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [map, setMap] = useState<WorkMapRecord | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    setMap(null);
    fetchWorkMap(id).then(setMap, (e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (map) document.title = `${taskTitle(map.task)} · Tacit`;
  }, [map]);

  return (
    <main className="flex h-screen flex-col bg-background">
      {map ? (
        <WorkMap map={map} onClose={() => void navigate({ to: "/work-maps" })} />
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm">
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/work-maps">All Work Maps</Link>
                </Button>
                <Button variant="outline" size="sm" onClick={load}>
                  <RotateCcw size={13} />
                  Retry
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Loading…</p>
          )}
        </div>
      )}
    </main>
  );
}
