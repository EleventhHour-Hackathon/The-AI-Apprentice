import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Guide } from "@/components/Guide";
import { WorkMap, type MapFocus } from "@/components/WorkMap";
import { useGuide } from "@/hooks/use-guide";
import { focusedStep } from "@/lib/guide";
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
  // Sia changed the map by voice: show the new version without a loading screen.
  const reload = useCallback(() => {
    fetchWorkMap(id).then(setMap, (e: Error) => console.warn("[guide] map not reloaded", e));
  }, [id]);

  return (
    <main className="relative flex h-screen flex-col bg-background">
      {map ? (
        <MapWithGuide
          map={map}
          onClose={() => void navigate({ to: "/work-maps" })}
          onEdited={reload}
        />
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

/** The Work Map with Sia beside it: Sia moves the map's focus, and hears where the person clicks. */
function MapWithGuide({
  map,
  onClose,
  onEdited,
}: {
  map: WorkMapRecord;
  onClose: () => void;
  onEdited: () => void;
}) {
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number }>();
  const guide = useGuide({
    map,
    onFocusRequest: (focusId) =>
      setFocusRequest((r) => ({ id: focusId, nonce: (r?.nonce ?? 0) + 1 })),
    onEdited,
  });
  const { focusChanged } = guide;
  const onFocusChange = useCallback(
    (item: MapFocus | null) => {
      setFocus(item);
      focusChanged(item);
    },
    [focusChanged],
  );

  return (
    <>
      <WorkMap
        map={map}
        onClose={onClose}
        focusRequest={focusRequest}
        onFocusChange={onFocusChange}
      />
      <Guide guide={guide} focus={focusedStep(map, focus)} />
    </>
  );
}
