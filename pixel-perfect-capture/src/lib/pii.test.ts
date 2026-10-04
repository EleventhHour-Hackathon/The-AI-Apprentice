import { describe, expect, it } from "vitest";
import { findPii, type OcrLine } from "./pii";

/** A line of words laid out left to right, 10 px per character. */
function line(text: string, y = 0): OcrLine {
  let x = 0;
  return {
    words: text.split(" ").map((word) => {
      const bbox = { x0: x, y0: y, x1: x + word.length * 10, y1: y + 12 };
      x = bbox.x1 + 10;
      return { text: word, bbox };
    }),
  };
}

const kinds = (text: string) => findPii([line(text)]).map((h) => h.kind);

describe("findPii", () => {
  it("hides emails, and only the email", () => {
    const [hit] = findPii([line("Send to sabine.mueller@example.de today")]);
    expect(hit?.kind).toBe("email");
    expect(hit?.box).toEqual({ x0: 80, y0: 0, x1: 330, y1: 12 });
  });

  it("hides IBANs written with or without spaces", () => {
    expect(kinds("IBAN DE89 3704 0044 0532 0130 00")).toContain("iban");
    expect(kinds("pay DE89370400440532013000 now")).toContain("iban");
  });

  it("hides card numbers that pass the checksum, not other long numbers", () => {
    expect(kinds("Card 4111 1111 1111 1111")).toContain("card");
    expect(kinds("Order 4111 1111 1111 1112")).not.toContain("card");
  });

  it("hides phone numbers, but not amounts, invoice numbers or cost centers", () => {
    expect(kinds("Call +49 711 1234567")).toContain("phone");
    expect(kinds("Tel. 0711 / 123 45 67")).toContain("phone");
    expect(kinds("Invoice 4471 total 7,200.00 EUR cost center 0400")).toEqual([]);
  });

  it("hides what follows a personal label, like a contact name", () => {
    const hits = findPii([line("Contact: Jana Novak (Brno)")]);
    expect(hits.map((h) => h.kind)).toEqual(["labelled"]);
    expect(hits[0]!.box.x0).toBe(90); // starts at "Jana", the label itself stays readable
  });

  it("leaves supplier names and the work itself alone", () => {
    expect(kinds("Supplier Kühn Maschinenbau GmbH, equipment, capex")).toEqual([]);
  });
});
