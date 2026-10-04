/**
 * Finds personal data in text read off the screen (OCR), so the privacy shield
 * can hide it before any frame leaves the machine.
 *
 * Errs on the side of hiding: an invoice number that looks like a phone number
 * gets covered too. Company names, amounts and codes are left alone; they are
 * the work the apprentice has to learn.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type OcrWord = { text: string; bbox: Box };
export type OcrLine = { words: OcrWord[] };
export type PiiKind = "email" | "iban" | "card" | "phone" | "labelled";
export type PiiHit = { kind: PiiKind; box: Box };

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Country code, check digits, then 11-30 letters/digits, possibly in groups of four.
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/g;
const CARD = /\b\d(?:[ -]?\d){12,18}\b/g;
// Starts like a phone number does (+, 0 or a bracket), at least 8 digits in all.
const PHONE = /(?:\+|\(0|\b0)[\d ()/.-]{7,}\d/g;
/** Labels whose value is about a person: the rest of the line after them is hidden. */
const LABEL =
  /\b(name|full name|contact|contact person|employee|customer|patient|email|e-mail|phone|tel|telephone|mobile|address|street|iban|account holder|account no|account number|bic|dob|date of birth|birthday|ssn|social security|tax id|steuer-?id|passport|id number)\s*[:#]/gi;

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function union(boxes: Box[]): Box {
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** Personal data in OCR'd lines, as boxes in the same coordinates as the words. */
export function findPii(lines: OcrLine[]): PiiHit[] {
  const hits: PiiHit[] = [];
  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim());
    if (!words.length) continue;
    // Rebuild the line from its words, remembering where each word sits in the text.
    let text = "";
    const spans = words.map((w) => {
      const start = text.length ? text.length + 1 : 0;
      text = text ? `${text} ${w.text}` : w.text;
      return { start, end: text.length };
    });
    const cover = (kind: PiiKind, start: number, end: number) => {
      const covered = words.filter((_, i) => spans[i]!.end > start && spans[i]!.start < end);
      if (covered.length) hits.push({ kind, box: union(covered.map((w) => w.bbox)) });
    };
    const scan = (
      kind: PiiKind,
      pattern: RegExp,
      keep: (match: string) => boolean = () => true,
    ) => {
      for (const m of text.matchAll(pattern))
        if (keep(m[0])) cover(kind, m.index, m.index + m[0].length);
    };

    scan("email", EMAIL);
    scan("iban", IBAN, (m) => m.replace(/\s/g, "").length >= 15);
    scan("card", CARD, (m) => luhn(m.replace(/\D/g, "")));
    scan("phone", PHONE, (m) => m.replace(/\D/g, "").length >= 8);
    for (const m of text.matchAll(LABEL)) cover("labelled", m.index + m[0].length, text.length);
  }
  return hits;
}
