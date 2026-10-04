import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ConnectionForm } from "@/components/ConnectionForm";

export const Route = createFileRoute("/connect")({
  head: () => ({ meta: [{ title: "Connect · Tacit" }] }),
  component: Connect,
});

/** First launch, or a key that no longer works: where this app finds its Tacit server. */
function Connect() {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8">
        <p className="font-display text-[26px] leading-none tracking-tight">Tacit</p>
        <h1 className="mt-6 font-display text-3xl tracking-tight">Connect to Tacit</h1>
        <p className="mt-1.5 mb-6 text-sm text-muted-foreground">
          Tacit works with your team’s server. Enter its address and the access key you were given.
          You can change them later in Settings.
        </p>
        <ConnectionForm submitLabel="Connect" onConnected={() => void navigate({ to: "/" })} />
      </div>
    </main>
  );
}
