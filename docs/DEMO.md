# Demo run sheet

About 12 minutes: Sabine teaches the apprentice (≈7 min), the Work Map (≈2 min), a new hire
with the tutor (≈3 min). Everything runs on the practice ERP, Ledgerly, with fake data.

## Before

1. `./start.sh` (backend, UI and the desktop app). Check the backend log for no errors.
2. In the Studio window: **Open the practice ERP**. In Ledgerly, pick **Expert's session**
   and press **Reset**. Do the same for **New hire's practice**.
3. Put Ledgerly on the screen you will share, the pill floating above it.
4. Say the lines below in your own words; what matters is *what* is said, not the wording.
   Speak while you work: what you say near a step is linked to it on the Work Map.

## 1. Capture: Sabine works, the apprentice asks (≈7 min)

Press **Start session** (S). The apprentice asks what you're doing:
"Supplier invoices before month-end close."

| Invoice | Do on screen | Judgment it hides | If the apprentice asks |
|---|---|---|---|
| **4471** Bauer Hydraulik, €6,850, arrives as 4711 opex | Read the lines. Change cost center to **0400 Fixed assets**. Type asset number **AN-2026-0117**. Post invoice, confirm. | Equipment over €5,000 is capex. No asset number, no capex booking. | "Equipment over five thousand euros is always capex. And without an asset number I never book capex; I ask the controller for one." |
| **4472** Schmidt Logistik, €1,240, December | Scroll to *Earlier invoices*: 4466 in December already, and last year's credit note. **Hold…** → Possible duplicate. | Schmidt double-bills every December. | "They bill December freight twice every year. I hold it until their billing confirms it's not a duplicate. Only I release it, after that call." |
| **4473** Kovotech s.r.o., €3,400, Czech subsidiary | **Send for approval…** → Controller (M. Weber). | Anything from the Czech subsidiary needs a second approval. | "Intercompany from the Czech subsidiary always gets a second approval from the controller, whatever the amount." |
| **4474** Büro Hansen, €186.40 | Post it. | Routine. | — |

What to point out while it runs:

- The apprentice stays silent while you type or talk, and asks only at a pause after an
  action (pill: *Watching* / *Listening* / *Reading along*).
- The pill's tally: **Questions 2/3 · Guardrail ✓**.
- The shield icon in the pill: the contact's name, email, phone and IBAN are hidden before
  anything leaves the machine. Press **O** to go off the record for a moment and show it.

Press **End** (S). If fewer than three questions were asked, or none about a guardrail,
the apprentice asks the missing ones first (*Before the debrief*).

## 2. Map: debrief, teach-back, Work Map (≈2 min + map)

- The apprentice asks at least three things it didn't learn while you worked (typically:
  is €5,000 net or gross, who releases the held invoice, what if the asset number isn't there
  yet). Answer briefly.
- Teach-back: it explains the whole process back. **Correct one detail on purpose**, e.g.
  "No, it's five thousand net, not gross." It records the correction and asks again.
- Say "Yes, that's how it works." It saves the map; say "That's it." to finish.
- **Go to Work Maps** → the new map: steps on a timeline, judgment calls marked, guardrails
  under their step, each with its screen moment and a clip of that subtask (personal data
  greyed out), the expert's words, and *Transcript* → *Asked while working*.

## 3. Teach: a new hire on a case Sabine never showed (≈3 min)

1. On the Work Map: **Teach a new hire**. In Ledgerly switch to **New hire's practice**.
2. Open **4480** Bauer Hydraulik, **€7,200** CNC tool changer, pre-coded **4711 opex**.
3. Play the new hire: leave 4711, no asset number, press **Post invoice**.
4. The tutor stops you before you confirm: "Sabine would stop here. Why do you think?" and
   replays her screen moment from 4471. Cancel, change to 0400, add an asset number, post.
5. Do 4481 (Schmidt, December again) and 4482 (Czech subsidiary) or say you're done.
6. The report: *mastered*, *practice next*, *not covered*, in Sabine's words.

If the tutor is late: stay on the confirm dialog for two or three seconds before
confirming; it checks every screen change, and the dialog is the last moment to step in.

## Variation: two languages

Before **Start session**, pick **Deutsch** in the pill and do part 1 in German. The Work Map comes
out in English with Sabine's German words beside their translation. Then pick **English** (or any
language) next to **Teach a new hire**: the tutor teaches in that language, quoting her reasons.

## After

Reset both sets in Ledgerly. Delete practice Work Maps you don't want from *Work Maps*.
