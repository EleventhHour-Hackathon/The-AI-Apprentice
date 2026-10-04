import { useEffect, useState, type FormEvent } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accessKey, backendUrl, saveConnection } from "@/lib/backend";
import { testConnection, type ConnectResult } from "@/lib/connection";
import { cn } from "@/lib/utils";

/**
 * The backend address and access key, tested before they are saved. Used by Connect to Tacit
 * and by Settings > Connection.
 */
export function ConnectionForm({
  submitLabel,
  onConnected,
  className,
}: {
  submitLabel: string;
  onConnected?: (result: Extract<ConnectResult, { ok: true }>) => void;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);

  // Read after mount: localStorage only exists in the window.
  useEffect(() => {
    setUrl(backendUrl());
    setKey(accessKey());
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTesting(true);
    setResult(null);
    try {
      const r = await testConnection(url, key);
      setResult(r);
      if (r.ok) {
        saveConnection(r.url, key);
        setUrl(r.url);
        onConnected?.(r);
      }
    } finally {
      setTesting(false);
    }
  };

  const bad = (field: "url" | "key") => result?.ok === false && result.field === field;

  return (
    <form onSubmit={(e) => void submit(e)} className={cn("space-y-4", className)}>
      <div className="space-y-1.5">
        <Label htmlFor="tacit-url">Server address</Label>
        <Input
          id="tacit-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tacit.example.com"
          autoComplete="url"
          spellCheck={false}
          aria-invalid={bad("url")}
          className={cn(bad("url") && "border-destructive")}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tacit-key">Access key</Label>
        <Input
          id="tacit-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Leave empty if your server has none"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={bad("key")}
          className={cn(bad("key") && "border-destructive")}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="rounded-full" disabled={testing}>
          {testing && <Loader2 size={14} className="animate-spin" />}
          {testing ? "Connecting" : submitLabel}
        </Button>
        {testing && (
          <p className="text-xs text-muted-foreground">
            A server that was asleep can take up to a minute to answer.
          </p>
        )}
        {result?.ok === true && (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <Check size={13} />
            Connected and saved.
          </p>
        )}
        {result?.ok === false && (
          <p role="alert" className="flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert size={13} />
            {result.message}
          </p>
        )}
      </div>
    </form>
  );
}
