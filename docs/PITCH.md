---
marp: true
title: Tacit · The AI Apprentice
paginate: true
---

# Tacit

**An apprentice that learns a job by watching an expert do it, asks why at the right moment, and teaches the next person.**

Sabine has run accounts payable for 24 years and retires in 18 months.
Tacit watches her close the month, asks what the screen can't show, and turns it into a Work Map and a tutor.

---

## Capture → Map → Teach

1. **Capture.** Sabine shares her screen and works. A vision model turns frames into events ("cost center changed from 4711 to 0400"). An ElevenLabs voice agent listens and asks at natural pauses.
2. **Map.** A spoken debrief closes the gaps, then the apprentice explains it all back until she says *yes, that's how it works*. The result: a clickable Work Map. Each step has its screen moment, a clip, the decision, the reason in her words and its guardrails.
3. **Teach.** A tutor watches a new hire work a case Sabine never showed. It steps in before a wrong decision is saved, and explains it with her reasoning.

---

## 1 · When to ask

**The agent never decides alone; the pill holds the floor** (`lib/floor.ts`, unit-tested).

- *Talking*: voice activity, plus 2.5 s of quiet after the expert speaks.
- *Busy*: pixels on the shared screen moved in the last 3 s (typing, scrolling).
- *Reading*: a document opened less than 8 s ago.
- Only after an action, then quiet: the pill sends `[PAUSE]`. Any reply without it is muted, and the agent is told it wasn't heard.
- Ask less, later: the first question comes after 25 s. Questions are 40 s apart until 3 are asked, then 75 s.

---

## 2 · What to ask

- Each `[PAUSE]` carries the last screen events, so questions name what's on screen ("that invoice you held").
- The prompt asks for what the screen can't show: why, what would change it, where the line is, who decides. It never asks what she did.
- **3 live questions, one about a guardrail, are checked in code.** Only real questions count. Each is labelled *guardrail / reason / other*. If End comes early, the apprentice asks the missing ones first.
- The pill shows *Questions 2/3 · Guardrail ✓*, and the Work Map lists what was asked.

---

## 3 · When it has understood

- When the work ends, a draft Work Map is merged from screen events, the transcript and live captures. Its **open questions drive the debrief**: at least 3, skipping anything already answered.
- The agent moves on to the teach-back once it could explain the task, exceptions included.
- **The teach-back is the proof.** The whole process is explained back in under a minute. Corrections are recorded and win over earlier answers. Only her "yes" saves the map.
- The map can't overclaim. Quotes must be words she actually said, checked against the transcript. Every moment is a real screen event. Anything without a moment or her words is marked *Unlinked*.

---

## 4 · Whether the new hire learned

- The tutor gets the Work Map and watches the new hire's screen the same way.
- Every screen change is checked against Sabine's rules, applied to *this* case's values. A wrong decision gets `[STOP]` **at once**, before the confirm dialog is closed. The tutor replays her screen moment and explains it in her words.
- It asks the new hire to predict the next decision before judgment calls.
- **The report is computed from what they did, not by an LLM.** It sorts each step into *mastered*, *practice next* (with why, and what Sabine would do) and *not covered*.

---

## 5 · Trust

- **Off the record (O).** Nothing is seen, heard, transcribed or recorded until she's back.
- **Privacy shield.** On-device OCR finds emails, IBANs, card and phone numbers, and labelled fields (Contact:, Name:). It paints over them before any frame leaves the machine. The vision model, thumbnails and recordings only ever see the shielded copy. It **fails closed**: no shield, no screen sharing.
- **Text redaction** on the backend for transcripts, events, quotes and edits ([email], [iban], …). It also redacts names when Presidio is installed.
- The pill hides itself from the capture. Work Maps and their videos can be deleted at any time; unconfirmed sessions are marked for deletion after 30 days.

---

## Any language

- The expert explains in their language: 72 languages, or Auto-detect. The apprentice listens, asks and debriefs in that language.
- The Work Map is kept in English. Every quote stays exactly as the expert said it, with an English translation beside it.
- The tutor teaches the new hire in *their* language: Sabine explains in German, Lena learns in English (or Spanish, or Hindi).

---

## Built with ElevenLabs

- **ElevenAgents** plays both roles: the curious interviewer and the patient tutor, with Expressive Mode.
- **Scribe Realtime** and patient turn-taking (turn v3) underneath the pill's floor.
- **Client tools** are how the agent acts: it records steps and guardrails, starts the debrief and teach-back, edits the map by voice, and confirms it.

---

## The moonshot: a living company memory

**Every expert, every workflow, in one map that stays current. When the work changes, the apprentice asks only about what's new.**

| Today (MVP) | Next | Then |
|---|---|---|
| One expert, one task, one Work Map | Merge repeat sessions into one map. Show where two experts differ, and ask each why. | The always-on apprentice: it notices a case no map covers and asks one question at the right moment |
| A tutor per map | Agent-ready guardrails: the same steps and stop points, loaded by an agent | Agents take the routine steps; people keep the judgment calls |

Each Work Map is the unit: grounded in real screen moments and the expert's own words. That is what makes it safe to teach from, to merge, and to hand to an agent.

**Every retiring expert becomes a Work Map and a tutor, not a farewell party.**
