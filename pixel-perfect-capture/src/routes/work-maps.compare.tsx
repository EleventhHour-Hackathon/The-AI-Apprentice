import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, CheckCheck, Clock, RotateCcw, TriangleAlert } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  compareRows,
  followUpState,
  pickerGroups,
  questionsFor,
  sameTask,
  type CompareRow,
} from "@/lib/compare";
import {
  count,
  fetchFollowUps,
  fetchWorkMapDiff,
  fetchWorkMaps,
  FOLLOW_UP_MAX_BATCH,
  postFollowUps,
  recordedAt,
  taskTitle,
  withdrawFollowUp,
  type DiffQuestion,
  type DiffSide,
  type FollowUp,
  type WorkMapDiffResponse,
  type WorkMapSummary,
} from "@/lib/work-maps";

type CompareSearch = { a?: string | undefined; b?: string | undefined };

export const Route = createFileRoute("/work-maps/compare")({
  head: () => ({ meta: [{ title: "Compare sessions · Tacit" }] }),
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    a: typeof search["a"] === "string" && search["a"] ? search["a"] : undefined,
    b: typeof search["b"] === "string" && search["b"] ? search["b"] : undefined,
  }),
  component: Compare,
});

type DiffState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; result: WorkMapDiffResponse };

/** One expert's questions kept for their next session. `pending` is null until it has loaded. */
type FollowUps = {
  pending: FollowUp[] | null;
  /** Why the waiting list couldn't be loaded; the questions then stay plain text. */
  loadError: string;
  /** Why the last ask or withdraw failed. */
  error: string;
  /** Question ids with a request running. */
  busy: string[];
};
const NO_FOLLOW_UPS: FollowUps = { pending: null, loadError: "", error: "", busy: [] };

/** Two sessions of one task side by side, and what to ask each expert about where they differ. */
function Compare() {
  const { a, b } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [maps, setMaps] = useState<WorkMapSummary[] | null>(null);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<DiffState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Keyed by Work Map id, so an answer that lands after the pair changed can't land on the wrong side.
  const [followUps, setFollowUps] = useState<Record<string, FollowUps>>({});

  const patchFollowUps = useCallback(
    (mapId: string, f: (s: FollowUps) => FollowUps) =>
      setFollowUps((prev) => ({ ...prev, [mapId]: f(prev[mapId] ?? NO_FOLLOW_UPS) })),
    [],
  );

  const load = useCallback(() => {
    setError("");
    setMaps(null);
    fetchWorkMaps().then(setMaps, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // Aborting on cleanup drops the answer for a pair that is no longer the one picked.
  useEffect(() => {
    if (!a || !b || a === b) return;
    const controller = new AbortController();
    setDiff({ status: "loading" });
    const { signal } = controller;
    fetchWorkMapDiff(a, b, undefined, { signal }).then(
      (result) => {
        setDiff({ status: "done", result });
        for (const mapId of [result.a.id, result.b.id]) {
          patchFollowUps(mapId, () => NO_FOLLOW_UPS);
          fetchFollowUps(mapId, { signal }).then(
            (pending) => {
              if (!signal.aborted) patchFollowUps(mapId, (s) => ({ ...s, pending, loadError: "" }));
            },
            (e: Error) => {
              if (!signal.aborted) patchFollowUps(mapId, (s) => ({ ...s, loadError: e.message }));
            },
          );
        }
      },
      (e: Error) => {
        if (!signal.aborted) setDiff({ status: "error", message: e.message });
      },
    );
    return () => controller.abort();
  }, [a, b, attempt, patchFollowUps]);

  // After a POST or DELETE the response's list is the server's truth. After a failure the list
  // is read again, so a question withdrawn or asked elsewhere shows as it is now.
  const followUpAction = useCallback(
    async (mapId: string, ids: string[], request: () => Promise<{ questions: FollowUp[] }>) => {
      patchFollowUps(mapId, (s) => ({ ...s, error: "", busy: [...s.busy, ...ids] }));
      try {
        const { questions } = await request();
        patchFollowUps(mapId, (s) => ({ ...s, pending: questions }));
      } catch (e) {
        patchFollowUps(mapId, (s) => ({ ...s, error: (e as Error).message }));
        fetchFollowUps(mapId).then(
          (pending) => patchFollowUps(mapId, (s) => ({ ...s, pending })),
          () => {},
        );
      } finally {
        patchFollowUps(mapId, (s) => ({ ...s, busy: s.busy.filter((id) => !ids.includes(id)) }));
      }
    },
    [patchFollowUps],
  );
  const ask = (mapId: string, fromId: string, questions: DiffQuestion[]) =>
    void followUpAction(
      mapId,
      questions.map((q) => q.id),
      () => postFollowUps(mapId, questions, fromId),
    );
  const withdraw = (mapId: string, questionId: string) =>
    void followUpAction(mapId, [questionId], () => withdrawFollowUp(mapId, questionId));

  const pick = (next: CompareSearch) =>
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true });

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <AppHeader />
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <Link
          to="/work-maps"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={13} />
          All Work Maps
        </Link>
        <h1 className="font-display text-4xl tracking-tight">Compare two sessions</h1>
        <p className="mt-1.5 mb-8 text-sm text-muted-foreground">
          Where two experts did the same task differently, and what to ask each of them.
        </p>
        {error ? (
          <Failed message={error} hint onRetry={load} />
        ) : maps === null ? (
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        ) : maps.length < 2 ? (
          <div className="text-center">
            <p className="text-sm font-medium">Record a second session of this task to compare.</p>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Comparing needs two Work Maps. There {maps.length === 1 ? "is one" : "are none"} so
              far.
            </p>
          </div>
        ) : (
          <>
            <Pickers maps={maps} a={a} b={b} onPick={pick} />
            {!a ? (
              <Prompt text="Pick the session to start from." />
            ) : !b ? (
              <Prompt text="Now pick a second session to compare it with." />
            ) : a === b ? (
              <Prompt text="Pick two different sessions." />
            ) : diff.status === "loading" ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Comparing…</p>
            ) : diff.status === "error" ? (
              <Failed message={diff.message} onRetry={() => setAttempt((n) => n + 1)} />
            ) : (
              <Result
                result={diff.result}
                followUps={followUps}
                onAsk={ask}
                onWithdraw={withdraw}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Failed({
  message,
  hint = false,
  onRetry,
}: {
  message: string;
  hint?: boolean;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="py-6 text-center text-sm">
      <p>{message}</p>
      {hint && (
        <p className="mt-1 text-xs text-muted-foreground">
          Check that the backend in core/backend is running.
        </p>
      )}
      <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RotateCcw size={13} />
        Retry
      </Button>
    </div>
  );
}

const Prompt = ({ text }: { text: string }) => (
  <p className="py-10 text-center text-sm text-muted-foreground">{text}</p>
);

const optionLabel = (m: WorkMapSummary) => `${taskTitle(m.task)} · ${recordedAt(m.recorded_at)}`;

function Pickers({
  maps,
  a,
  b,
  onPick,
}: {
  maps: WorkMapSummary[];
  a: string | undefined;
  b: string | undefined;
  onPick: (next: CompareSearch) => void;
}) {
  const groups = pickerGroups(maps, a);
  const known = (id: string | undefined) => !id || maps.some((m) => m.id === id);
  const select =
    "h-9 w-full truncate rounded-xl border bg-card px-3 text-sm outline-none hover:bg-muted/40";
  return (
    <div className="mb-8 grid gap-3 sm:grid-cols-2">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Session A</span>
        <select
          className={select}
          value={a ?? ""}
          onChange={(e) => onPick({ a: e.target.value || undefined })}
        >
          <option value="">Choose a session</option>
          {!known(a) && <option value={a}>Unknown session</option>}
          {pickerGroups(maps, undefined).otherTasks.map((m) => (
            <option key={m.id} value={m.id}>
              {optionLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Session B</span>
        <select
          className={select}
          value={b ?? ""}
          onChange={(e) => onPick({ b: e.target.value || undefined })}
        >
          <option value="">Choose a session</option>
          {!known(b) && <option value={b}>Unknown session</option>}
          {b === a && b && <option value={b}>The same session</option>}
          {groups.sameTask.map((m) => (
            <option key={m.id} value={m.id}>
              {optionLabel(m)}
            </option>
          ))}
          {groups.otherTasks.length > 0 && (
            <optgroup label="Other tasks">
              {groups.otherTasks.map((m) => (
                <option key={m.id} value={m.id}>
                  {optionLabel(m)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
    </div>
  );
}

type FollowUpActions = {
  onAsk: (mapId: string, fromId: string, questions: DiffQuestion[]) => void;
  onWithdraw: (mapId: string, questionId: string) => void;
};

function Result({
  result,
  followUps,
  ...actions
}: { result: WorkMapDiffResponse; followUps: Record<string, FollowUps> } & FollowUpActions) {
  const rows = compareRows(result.diff);
  const all = [...rows.steps, ...rows.guardrails];
  const agree = all.every((r) => r.kind === "same");
  const dates = { a: recordedAt(result.a.recorded_at), b: recordedAt(result.b.recorded_at) };
  return (
    <div className="space-y-10">
      <div className="grid gap-3 sm:grid-cols-2">
        <SideCard label="Session A" side={result.a} />
        <SideCard label="Session B" side={result.b} />
      </div>

      {!sameTask(result.a.task, result.b.task) && (
        <div
          role="note"
          className="flex items-start gap-2.5 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs"
        >
          <TriangleAlert size={14} className="mt-px shrink-0 text-warning" />
          <p>
            These sessions are from different tasks, so many differences may just be different work.
          </p>
        </div>
      )}

      {agree && (
        <p className="rounded-2xl border bg-card px-4 py-3 text-sm">
          These two sessions agree on every step and guardrail.
        </p>
      )}

      {!agree && (
        <section>
          <h2 className="mb-3 font-display text-2xl tracking-tight">Questions for each expert</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Questions
              label="Session A"
              questions={questionsFor(result, "a")}
              mapId={result.a.id}
              fromId={result.b.id}
              followUps={followUps[result.a.id] ?? NO_FOLLOW_UPS}
              {...actions}
            />
            <Questions
              label="Session B"
              questions={questionsFor(result, "b")}
              mapId={result.b.id}
              fromId={result.a.id}
              followUps={followUps[result.b.id] ?? NO_FOLLOW_UPS}
              {...actions}
            />
          </div>
        </section>
      )}

      <Section title="Steps" rows={rows.steps} dates={dates} />
      <Section title="Guardrails" rows={rows.guardrails} dates={dates} />
    </div>
  );
}

function SideCard({ label, side }: { label: string; side: DiffSide }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span
          className={cn(
            "flex items-center gap-1 text-[11px]",
            side.confirmed ? "text-success" : "text-muted-foreground",
          )}
        >
          {side.confirmed ? <CheckCheck size={12} /> : <Clock size={12} />}
          {side.confirmed ? "Confirmed" : "Not confirmed"}
        </span>
      </div>
      <p className="mt-1 truncate text-sm font-medium">{taskTitle(side.task)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {recordedAt(side.recorded_at)} · {count(side.steps, "step")} ·{" "}
        {count(side.guardrails, "guardrail")}
      </p>
      <Link
        to="/work-maps/$id"
        params={{ id: side.id }}
        className="mt-2 inline-block text-xs underline-offset-2 hover:underline"
      >
        Open this Work Map
      </Link>
    </div>
  );
}

/** One expert's questions; each can be kept for their next session or withdrawn again. */
function Questions({
  label,
  questions,
  mapId,
  fromId,
  followUps,
  onAsk,
  onWithdraw,
}: {
  label: string;
  questions: DiffQuestion[];
  mapId: string;
  fromId: string;
  followUps: FollowUps;
} & FollowUpActions) {
  // Until the waiting list has loaded the questions are plain text: a button could lie.
  const loaded = followUps.pending !== null && !followUps.loadError;
  const state = followUpState(questions, followUps.pending);
  const busy = (id: string) => followUps.busy.includes(id);
  const askable = questions.filter((q) => state[q.id] === "can_ask" && !busy(q.id));
  const error = followUps.loadError || followUps.error;
  return (
    <div className="rounded-2xl border bg-card px-4 py-3.5">
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">Ask the expert of {label}</p>
        {loaded && askable.length > 0 && (
          <Button
            variant="outline"
            className="h-7 px-2.5 text-xs"
            disabled={followUps.busy.length > 0}
            onClick={() => onAsk(mapId, fromId, askable.slice(0, FOLLOW_UP_MAX_BATCH))}
          >
            Ask all
          </Button>
        )}
      </div>
      {questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to ask this expert.</p>
      ) : (
        <ol className="space-y-2.5">
          {questions.map((q) => (
            <li key={q.id} className="text-sm leading-relaxed">
              {q.text}
              {q.quote && (
                <span className="mt-0.5 block text-xs text-muted-foreground">“{q.quote}”</span>
              )}
              {loaded &&
                (state[q.id] === "waiting" ? (
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock size={12} className="shrink-0" />
                    Waiting for their next session
                    <Button
                      variant="ghost"
                      className="h-7 px-1.5 text-xs underline-offset-2 hover:underline"
                      disabled={busy(q.id)}
                      onClick={() => onWithdraw(mapId, q.id)}
                    >
                      Withdraw
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    className="mt-1 h-7 px-2.5 text-xs"
                    disabled={busy(q.id)}
                    onClick={() => onAsk(mapId, fromId, [q])}
                  >
                    Ask in their next session
                  </Button>
                ))}
            </li>
          ))}
        </ol>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  dates,
}: {
  title: string;
  rows: CompareRow[];
  dates: { a: string; b: string };
}) {
  if (rows.length === 0) return null;
  const differs = rows.filter((r) => r.kind === "differs");
  const onlyA = rows.filter((r) => r.kind === "only_a");
  const onlyB = rows.filter((r) => r.kind === "only_b");
  const same = rows.filter((r) => r.kind === "same");
  return (
    <section>
      <h2 className="mb-3 font-display text-2xl tracking-tight">{title}</h2>
      <div className="space-y-6">
        {differs.length > 0 && (
          <Group label="Differs">
            {differs.map((r) => (
              <li key={r.key} className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2">
                <DiffSideView
                  label="Session A"
                  title={r.titleA}
                  words={r.wordsA}
                  row={r}
                  side="a"
                />
                <DiffSideView
                  label="Session B"
                  title={r.titleB}
                  words={r.wordsB}
                  row={r}
                  side="b"
                />
              </li>
            ))}
          </Group>
        )}
        {onlyA.length > 0 && (
          <Group label={`Only in Session A · ${dates.a}`}>
            {onlyA.map((r) => (
              <OnlyRow key={r.key} title={r.titleA} words={r.wordsA} />
            ))}
          </Group>
        )}
        {onlyB.length > 0 && (
          <Group label={`Only in Session B · ${dates.b}`}>
            {onlyB.map((r) => (
              <OnlyRow key={r.key} title={r.titleB} words={r.wordsB} />
            ))}
          </Group>
        )}
        {same.length > 0 && (
          <Group label="Same">
            {same.map((r) => (
              <li
                key={r.key}
                className="flex items-center gap-2 px-1 text-sm text-muted-foreground"
              >
                <Check size={13} className="shrink-0 text-success" />
                <span className="truncate">{r.titleA}</span>
              </li>
            ))}
          </Group>
        )}
      </div>
    </section>
  );
}

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <p className="mb-2 text-xs font-medium text-muted-foreground">{label}</p>
    <ul className="space-y-2">{children}</ul>
  </div>
);

const Words = ({ words }: { words: string }) =>
  words ? <p className="mt-1 text-xs italic text-muted-foreground">“{words}”</p> : null;

function DiffSideView({
  label,
  title,
  words,
  row,
  side,
}: {
  label: string;
  title: string;
  words: string;
  row: CompareRow;
  side: "a" | "b";
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{title || "Untitled"}</p>
      <Words words={words} />
      {row.fields.length > 0 && (
        <dl className="mt-2.5 space-y-1.5 text-xs">
          {row.fields.map((f) => (
            <div key={f.field}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 inline-block rounded-md bg-warning/15 px-1.5 py-0.5">
                {side === "a" ? f.a : f.b}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const OnlyRow = ({ title, words }: { title: string; words: string }) => (
  <li className="rounded-2xl border bg-card px-4 py-3">
    <p className="text-sm font-medium">{title || "Untitled"}</p>
    <Words words={words} />
  </li>
);
