import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import {
  APPROVERS,
  COST_CENTERS,
  DATASETS,
  HISTORY,
  HOLD_REASONS,
  eur,
  total,
  type Invoice,
  type Status,
} from "@/lib/sandbox";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sandbox")({
  head: () => ({ meta: [{ title: "Ledgerly · Accounts payable" }] }),
  component: Sandbox,
});

type SetName = keyof typeof DATASETS;
type Log = { at: string; text: string };
type Saved = { invoices: Invoice[]; log: Log[] };
type Dialog = { kind: "post" | "hold" | "approval"; choice: string } | null;

const STORAGE = (set: SetName) => `ledgerly:${set}`;
const STATUS: Record<Status, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-sky-100 text-sky-800" },
  posted: { label: "Posted", className: "bg-emerald-100 text-emerald-800" },
  on_hold: { label: "On hold", className: "bg-amber-100 text-amber-800" },
  awaiting_approval: { label: "Awaiting approval", className: "bg-violet-100 text-violet-800" },
};
const fresh = (set: SetName): Saved => ({
  invoices: structuredClone(DATASETS[set].invoices),
  log: [],
});
const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * Ledgerly, a practice ERP for demos: the expert works the "expert" invoices while
 * the apprentice watches, a new hire works the "newhire" ones with the tutor.
 * Open it in the app window (or any browser tab) and share that screen.
 */
function Sandbox() {
  const [set, setSet] = useState<SetName>("expert");
  const [data, setData] = useState<Saved>(() => fresh("expert"));
  const [selected, setSelected] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);

  // ?set=newhire opens the new hire's practice set; work is kept per set across reloads.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("set");
    const initial: SetName = wanted === "newhire" ? "newhire" : "expert";
    setSet(initial);
  }, []);
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE(set));
    const next = saved ? (JSON.parse(saved) as Saved) : fresh(set);
    setData(next);
    setSelected(next.invoices[0]?.id ?? "");
  }, [set]);
  const save = (next: Saved) => {
    setData(next);
    localStorage.setItem(STORAGE(set), JSON.stringify(next));
  };

  const invoice = data.invoices.find((i) => i.id === selected);
  const update = (patch: Partial<Invoice>, log?: string) => {
    if (!invoice) return;
    save({
      invoices: data.invoices.map((i) => (i.id === invoice.id ? { ...i, ...patch } : i)),
      log: log ? [{ at: now(), text: log }, ...data.log] : data.log,
    });
  };
  const reset = () => {
    localStorage.removeItem(STORAGE(set));
    const next = fresh(set);
    setData(next);
    setSelected(next.invoices[0]?.id ?? "");
  };

  const confirm = () => {
    if (!invoice || !dialog) return;
    const cc = COST_CENTERS.find((c) => c.code === invoice.costCenter);
    if (dialog.kind === "post")
      update(
        { status: "posted", note: "" },
        `Invoice ${invoice.id} posted to ${invoice.costCenter} ${cc?.name ?? ""}${invoice.assetNumber ? `, asset ${invoice.assetNumber}` : ""}`,
      );
    else if (dialog.kind === "hold")
      update(
        { status: "on_hold", note: dialog.choice },
        `Invoice ${invoice.id} put on hold: ${dialog.choice}`,
      );
    else
      update(
        { status: "awaiting_approval", note: dialog.choice },
        `Invoice ${invoice.id} sent for approval to ${dialog.choice}`,
      );
    setDialog(null);
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-[14px] text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-4 bg-slate-800 px-5 text-white">
        <span className="text-[15px] font-semibold tracking-tight">Ledgerly</span>
        <span className="text-slate-300">Accounts payable · Inbox</span>
        <div className="ml-auto flex items-center gap-2 text-[12px]">
          <span className="text-slate-400">Practice data</span>
          <select
            value={set}
            onChange={(e) => setSet(e.target.value as SetName)}
            className="rounded bg-slate-700 px-2 py-1 text-white"
          >
            {Object.entries(DATASETS).map(([key, d]) => (
              <option key={key} value={key}>
                {d.label}
              </option>
            ))}
          </select>
          <button
            onClick={reset}
            className="flex items-center gap-1 rounded px-2 py-1 text-slate-300 hover:bg-slate-700 hover:text-white"
            title="Put every invoice in this set back to open"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 border-r bg-white">
          <p className="border-b px-4 py-2.5 text-[12px] font-medium uppercase tracking-wide text-slate-500">
            Invoices ({data.invoices.filter((i) => i.status === "open").length} open)
          </p>
          <ul>
            {data.invoices.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => setSelected(i.id)}
                  className={cn(
                    "w-full border-b px-4 py-3 text-left hover:bg-slate-50",
                    i.id === selected && "bg-sky-50 hover:bg-sky-50",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Invoice {i.id}</span>
                    <span className="tabular-nums">{eur(total(i))}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] text-slate-600">{i.supplier}</span>
                    <StatusChip status={i.status} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {invoice ? (
          <main className="min-w-0 flex-1 overflow-y-auto p-6">
            <InvoiceView
              invoice={invoice}
              onChange={(patch) => update(patch)}
              onAction={(kind) =>
                setDialog({
                  kind,
                  choice:
                    kind === "hold" ? HOLD_REASONS[0]! : kind === "approval" ? APPROVERS[0]! : "",
                })
              }
            />
            <section className="mt-6 max-w-4xl">
              <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-slate-500">
                Activity
              </h3>
              {data.log.length === 0 ? (
                <p className="text-slate-500">Nothing posted yet.</p>
              ) : (
                <ul className="space-y-1">
                  {data.log.map((l, n) => (
                    <li key={n} className="text-slate-700">
                      <span className="mr-2 font-mono text-[12px] text-slate-400">{l.at}</span>
                      {l.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </main>
        ) : (
          <main className="flex flex-1 items-center justify-center text-slate-500">
            Choose an invoice.
          </main>
        )}
      </div>

      {dialog && invoice && (
        <ConfirmDialog
          dialog={dialog}
          invoice={invoice}
          onChoice={(choice) => setDialog({ ...dialog, choice })}
          onCancel={() => setDialog(null)}
          onConfirm={confirm}
        />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", s.className)}>
      {s.label}
    </span>
  );
}

function InvoiceView({
  invoice,
  onChange,
  onAction,
}: {
  invoice: Invoice;
  onChange: (patch: Partial<Invoice>) => void;
  onAction: (kind: "post" | "hold" | "approval") => void;
}) {
  const editable = invoice.status === "open";
  const history = useMemo(
    () => HISTORY.filter((h) => h.supplier === invoice.supplier),
    [invoice.supplier],
  );
  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-[22px] font-semibold">
            Invoice {invoice.id} <StatusChip status={invoice.status} />
          </h1>
          <p className="mt-1 text-slate-600">
            {invoice.supplier} · {invoice.country}
          </p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-right text-[13px]">
          <dt className="text-slate-500">Invoice date</dt>
          <dd>{invoice.date}</dd>
          <dt className="text-slate-500">Due</dt>
          <dd>{invoice.due}</dd>
          <dt className="text-slate-500">Order ref.</dt>
          <dd>{invoice.orderRef}</dd>
        </dl>
      </div>
      {invoice.note && (
        <p className="mt-3 rounded border border-slate-200 bg-white px-3 py-2 text-slate-700">
          {invoice.status === "on_hold" ? "Hold reason" : "Approver"}: {invoice.note}
        </p>
      )}

      <Card title="Lines" className="mt-5">
        <table className="w-full">
          <thead className="text-left text-[12px] text-slate-500">
            <tr>
              <th className="py-1 font-medium">Description</th>
              <th className="py-1 text-right font-medium">Qty</th>
              <th className="py-1 text-right font-medium">Unit price</th>
              <th className="py-1 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l, n) => (
              <tr key={n} className="border-t">
                <td className="py-1.5">{l.description}</td>
                <td className="py-1.5 text-right tabular-nums">{l.qty}</td>
                <td className="py-1.5 text-right tabular-nums">{eur(l.unit)}</td>
                <td className="py-1.5 text-right tabular-nums">{eur(l.qty * l.unit)}</td>
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-1.5" colSpan={3}>
                Total (net)
              </td>
              <td className="py-1.5 text-right tabular-nums">{eur(total(invoice))}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Card title="Coding">
          <label className="block text-[12px] text-slate-500" htmlFor="cc">
            Cost center
          </label>
          <select
            id="cc"
            disabled={!editable}
            value={invoice.costCenter}
            onChange={(e) => onChange({ costCenter: e.target.value })}
            className="mt-1 w-full rounded border bg-white px-2 py-1.5 disabled:bg-slate-100"
          >
            {COST_CENTERS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name} ({c.kind})
              </option>
            ))}
          </select>
          <label className="mt-3 block text-[12px] text-slate-500" htmlFor="asset">
            Asset number
          </label>
          <input
            id="asset"
            disabled={!editable}
            value={invoice.assetNumber}
            placeholder="e.g. AN-2026-0117"
            onChange={(e) => onChange({ assetNumber: e.target.value })}
            className="mt-1 w-full rounded border px-2 py-1.5 disabled:bg-slate-100"
          />
          <label className="mt-3 block text-[12px] text-slate-500" htmlFor="comment">
            Comment
          </label>
          <textarea
            id="comment"
            disabled={!editable}
            value={invoice.comment}
            rows={2}
            onChange={(e) => onChange({ comment: e.target.value })}
            className="mt-1 w-full resize-none rounded border px-2 py-1.5 disabled:bg-slate-100"
          />
        </Card>
        <Card title="Supplier details">
          <dl className="space-y-1.5">
            <Field label="Contact:" value={invoice.contact.name} />
            <Field label="Email:" value={invoice.contact.email} />
            <Field label="Phone:" value={invoice.contact.phone} />
            <Field label="IBAN:" value={invoice.contact.iban} />
          </dl>
        </Card>
      </div>

      <Card title={`Earlier invoices from ${invoice.supplier}`} className="mt-4">
        {history.length === 0 ? (
          <p className="text-slate-500">None.</p>
        ) : (
          <table className="w-full">
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t first:border-t-0">
                  <td className="py-1.5">Invoice {h.id}</td>
                  <td className="py-1.5">{h.date}</td>
                  <td className="py-1.5 text-right tabular-nums">{eur(h.amount)}</td>
                  <td className="py-1.5 pl-4 text-slate-600">{h.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editable && (
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => onAction("post")}
            className="rounded bg-sky-700 px-4 py-2 font-medium text-white hover:bg-sky-800"
          >
            Post invoice
          </button>
          <button
            onClick={() => onAction("hold")}
            className="rounded border bg-white px-4 py-2 font-medium hover:bg-slate-50"
          >
            Hold…
          </button>
          <button
            onClick={() => onAction("approval")}
            className="rounded border bg-white px-4 py-2 font-medium hover:bg-slate-50"
          >
            Send for approval…
          </button>
        </div>
      )}
    </div>
  );
}

function Card({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border bg-white p-4", className)}>
      <h2 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-slate-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Every action is confirmed first: the moment a reviewer (or the tutor) can still step in. */
function ConfirmDialog({
  dialog,
  invoice,
  onChoice,
  onCancel,
  onConfirm,
}: {
  dialog: NonNullable<Dialog>;
  invoice: Invoice;
  onChoice: (choice: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cc = COST_CENTERS.find((c) => c.code === invoice.costCenter);
  const title =
    dialog.kind === "post"
      ? `Post invoice ${invoice.id}?`
      : dialog.kind === "hold"
        ? `Put invoice ${invoice.id} on hold?`
        : `Send invoice ${invoice.id} for approval?`;
  const options =
    dialog.kind === "hold" ? HOLD_REASONS : dialog.kind === "approval" ? APPROVERS : [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div role="dialog" aria-label={title} className="w-[440px] rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {dialog.kind === "post" ? (
          <dl className="mt-3 space-y-1 text-[13.5px]">
            <div className="flex justify-between">
              <dt className="text-slate-500">Amount</dt>
              <dd className="tabular-nums">{eur(total(invoice))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Cost center</dt>
              <dd>
                {invoice.costCenter} · {cc?.name} ({cc?.kind})
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Asset number</dt>
              <dd>{invoice.assetNumber || "none"}</dd>
            </div>
            <p className="pt-2 text-slate-500">Posted invoices can’t be changed.</p>
          </dl>
        ) : (
          <select
            value={dialog.choice}
            onChange={(e) => onChoice(e.target.value)}
            className="mt-3 w-full rounded border px-2 py-1.5"
            aria-label={dialog.kind === "hold" ? "Hold reason" : "Approver"}
          >
            {options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded border px-4 py-2 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-sky-700 px-4 py-2 font-medium text-white hover:bg-sky-800"
          >
            {dialog.kind === "post" ? "Post" : dialog.kind === "hold" ? "Hold" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
