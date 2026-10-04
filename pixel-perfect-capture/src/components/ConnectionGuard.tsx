import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { TriangleAlert, X } from "lucide-react";
import { ACCESS_KEY_MESSAGE, UNAUTHORIZED_EVENT, backendUrl } from "@/lib/backend";
import { launchState } from "@/lib/connection";

// Checked once per window: on launch, not on every page.
let launchChecked = false;

/**
 * In the app window: sends a first launch (or a refused key) to Connect to Tacit, and shows a
 * note whenever the backend refuses the access key or can't be reached. Not in the pill.
 */
export function ConnectionGuard() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [note, setNote] = useState<"key" | "unreachable" | null>(null);
  const skip = pathname === "/pill" || pathname === "/connect";

  useEffect(() => {
    if (skip || launchChecked) return;
    launchChecked = true;
    void launchState().then((state) => {
      if (state === "connect") void navigate({ to: "/connect" });
      else if (state === "unreachable") setNote("unreachable");
    });
  }, [skip, navigate]);

  useEffect(() => {
    const onUnauthorized = () => setNote("key");
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  // Fixed by a new connection: the note goes once the person is on Connect or Settings.
  useEffect(() => {
    if (pathname === "/connect") setNote(null);
  }, [pathname]);

  if (skip || !note) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm shadow-lg"
    >
      <TriangleAlert size={14} className="shrink-0 text-warning" />
      <span>
        {note === "key"
          ? ACCESS_KEY_MESSAGE
          : `Can’t reach ${backendUrl().replace(/^https?:\/\//, "")}`}
      </span>
      <Link
        to="/settings"
        hash="connection"
        onClick={() => setNote(null)}
        className="font-medium underline underline-offset-2"
      >
        Connection
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setNote(null)}
        className="text-muted-foreground hover:text-foreground"
      >
        <X size={14} />
      </button>
    </div>
  );
}
