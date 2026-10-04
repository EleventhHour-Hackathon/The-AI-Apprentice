/**
 * Fake data for the practice ERP (/sandbox): the challenge's running example.
 *
 * Two sets. "expert" is what the expert (Sabine) processes while the apprentice
 * watches: an equipment invoice over the €5,000 capex line that arrives coded as
 * opex, a December invoice from a supplier that double-bills every December, and an
 * invoice from the Czech subsidiary that needs a second approval. "newhire" is the
 * case the expert never showed, for the tutor: a fresh €7,200 equipment invoice.
 *
 * The ERP itself enforces none of these rules. They live in the expert's head; that
 * is the point of the apprentice.
 */

export type CostCenter = { code: string; name: string; kind: "opex" | "capex" | "intercompany" };
export const COST_CENTERS: CostCenter[] = [
  { code: "4711", name: "Maintenance & small equipment", kind: "opex" },
  { code: "4720", name: "Freight & logistics", kind: "opex" },
  { code: "4730", name: "Office & supplies", kind: "opex" },
  { code: "0400", name: "Fixed assets: machinery", kind: "capex" },
  { code: "4800", name: "Intercompany purchases", kind: "intercompany" },
];
export const APPROVERS = ["Controller (M. Weber)", "Head of Finance (K. Brandt)"];
export const HOLD_REASONS = [
  "Possible duplicate",
  "Waiting for goods receipt",
  "Price differs from order",
  "Other",
];

export type Status = "open" | "posted" | "on_hold" | "awaiting_approval";
export type Line = { description: string; qty: number; unit: number };
export type Invoice = {
  id: string;
  supplier: string;
  country: string;
  /** Personal data on purpose: the privacy shield should hide it. */
  contact: { name: string; email: string; phone: string; iban: string };
  date: string;
  due: string;
  orderRef: string;
  lines: Line[];
  costCenter: string;
  assetNumber: string;
  comment: string;
  status: Status;
  /** Hold reason or approver, once decided. */
  note: string;
};
/** Earlier invoices from the same supplier, for checking duplicates. */
export type PastInvoice = {
  id: string;
  supplier: string;
  date: string;
  amount: number;
  note: string;
};

export const total = (inv: Pick<Invoice, "lines">) =>
  inv.lines.reduce((sum, l) => sum + l.qty * l.unit, 0);
export const eur = (n: number) =>
  `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const bauer = {
  supplier: "Bauer Hydraulik GmbH",
  country: "Germany",
  contact: {
    name: "Jonas Keller",
    email: "j.keller@bauer-hydraulik.de",
    phone: "+49 711 4093 2210",
    iban: "DE89 3704 0044 0532 0130 00",
  },
};
const schmidt = {
  supplier: "Schmidt Logistik KG",
  country: "Germany",
  contact: {
    name: "Petra Lindner",
    email: "billing@schmidt-logistik.de",
    phone: "+49 7031 88 1402",
    iban: "DE44 6005 0101 0004 4128 77",
  },
};
const kovotech = {
  supplier: "Kovotech s.r.o. (subsidiary)",
  country: "Czech Republic",
  contact: {
    name: "Jana Novak",
    email: "j.novak@kovotech.cz",
    phone: "+420 541 123 456",
    iban: "CZ65 0800 0000 1920 0014 5399",
  },
};
const hansen = {
  supplier: "Büro Hansen",
  country: "Germany",
  contact: {
    name: "Tim Hansen",
    email: "info@buero-hansen.de",
    phone: "+49 711 22 0915",
    iban: "DE02 1203 0000 0000 2020 51",
  },
};

const open = { assetNumber: "", comment: "", status: "open" as const, note: "" };

export const DATASETS: Record<"expert" | "newhire", { label: string; invoices: Invoice[] }> = {
  expert: {
    label: "Expert's session",
    invoices: [
      {
        id: "4471",
        ...bauer,
        date: "2026-12-10",
        due: "2027-01-09",
        orderRef: "PO-88213",
        lines: [
          { description: "Hydraulic press HP-200, incl. installation", qty: 1, unit: 6450 },
          { description: "Commissioning and safety inspection", qty: 1, unit: 400 },
        ],
        costCenter: "4711",
        ...open,
      },
      {
        id: "4472",
        ...schmidt,
        date: "2026-12-12",
        due: "2026-12-26",
        orderRef: "FR-2026-12",
        lines: [{ description: "Freight Stuttgart–Hamburg, December", qty: 1, unit: 1240 }],
        costCenter: "4720",
        ...open,
      },
      {
        id: "4473",
        ...kovotech,
        date: "2026-12-11",
        due: "2027-01-10",
        orderRef: "IC-5521",
        lines: [
          { description: "Machined flanges, batch 12", qty: 200, unit: 14.5 },
          { description: "Surface treatment", qty: 1, unit: 500 },
        ],
        costCenter: "4800",
        ...open,
      },
      {
        id: "4474",
        ...hansen,
        date: "2026-12-09",
        due: "2026-12-23",
        orderRef: "PO-88190",
        lines: [
          { description: "Printer paper A4, 10 boxes", qty: 10, unit: 12.9 },
          { description: "Toner cartridges", qty: 2, unit: 28.7 },
        ],
        costCenter: "4730",
        ...open,
      },
    ],
  },
  newhire: {
    label: "New hire's practice",
    invoices: [
      {
        id: "4480",
        ...bauer,
        date: "2026-12-15",
        due: "2027-01-14",
        orderRef: "PO-88240",
        lines: [{ description: "CNC tool changer TC-40 for machining center", qty: 1, unit: 7200 }],
        costCenter: "4711",
        ...open,
      },
      {
        id: "4481",
        ...schmidt,
        date: "2026-12-16",
        due: "2026-12-30",
        orderRef: "FR-2026-12",
        lines: [{ description: "Freight Stuttgart–Munich, December", qty: 1, unit: 980 }],
        costCenter: "4720",
        ...open,
      },
      {
        id: "4482",
        ...kovotech,
        date: "2026-12-15",
        due: "2027-01-14",
        orderRef: "IC-5530",
        lines: [{ description: "Welded brackets, batch 7", qty: 150, unit: 14.3 }],
        costCenter: "4800",
        ...open,
      },
      {
        id: "4483",
        ...hansen,
        date: "2026-12-14",
        due: "2026-12-28",
        orderRef: "PO-88231",
        lines: [{ description: "Whiteboard markers and folders", qty: 1, unit: 92.4 }],
        costCenter: "4730",
        ...open,
      },
    ],
  },
};

/** Supplier history: Schmidt bills December freight twice, and was caught last year. */
export const HISTORY: PastInvoice[] = [
  { id: "3988", supplier: schmidt.supplier, date: "2025-12-08", amount: 1180, note: "Paid" },
  {
    id: "3996",
    supplier: schmidt.supplier,
    date: "2025-12-19",
    amount: 1180,
    note: "Credit note: billed twice",
  },
  { id: "4466", supplier: schmidt.supplier, date: "2026-12-03", amount: 1240, note: "Paid" },
  {
    id: "4460",
    supplier: bauer.supplier,
    date: "2026-11-21",
    amount: 2380,
    note: "Paid · spare seals",
  },
  {
    id: "4458",
    supplier: kovotech.supplier,
    date: "2026-11-20",
    amount: 3150,
    note: "Paid · approved by controller",
  },
  { id: "4455", supplier: hansen.supplier, date: "2026-11-18", amount: 143.2, note: "Paid" },
];
