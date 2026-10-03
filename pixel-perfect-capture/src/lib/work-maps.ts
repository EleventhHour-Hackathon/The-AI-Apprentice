import { BACKEND_URL } from "@/lib/backend";

// Saved by the backend at the end of a session (InterviewFlow._save_work_map in core/backend).
export type WorkMapStep = { step: string; decision: string; reason: string; screen_moment: string };
export type WorkMapGuardrail = { rule: string; applies_when: string; stop_and_ask: string };
export type WorkMapRecord = {
  id: string;
  task: string | null;
  recorded_at: string | null;
  confirmed?: boolean;
  steps: WorkMapStep[];
  guardrails: WorkMapGuardrail[];
  open_questions: string[];
  corrections?: string[];
  transcript?: { role: "user" | "assistant"; content: string }[];
};
export type WorkMapSummary = {
  id: string;
  task: string | null;
  recorded_at: string | null;
  confirmed: boolean;
  steps: number;
  guardrails: number;
  open_questions: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_URL}/api/v1${path}`, init);
  } catch {
    throw new Error("Couldn’t reach the apprentice backend.");
  }
  if (response.status === 404) throw new Error("This Work Map doesn’t exist.");
  if (response.status === 503) throw new Error("Work Map storage (Supabase) is unavailable.");
  if (!response.ok) throw new Error(`The backend answered ${response.status}.`);
  return (await response.json()) as T;
}

export const fetchWorkMaps = () => request<WorkMapSummary[]>("/work_maps");
export const fetchWorkMap = (id: string) =>
  request<WorkMapRecord>(`/work_maps/${encodeURIComponent(id)}`);
export const deleteWorkMap = (id: string) =>
  request<{ deleted: string }>(`/work_maps/${encodeURIComponent(id)}`, { method: "DELETE" });

export const taskTitle = (task: string | null) => {
  const t = task?.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Untitled session";
};

export const recordedAt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unknown time";

export const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
