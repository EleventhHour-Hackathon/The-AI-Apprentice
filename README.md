# Tacit: the AI Apprentice

**An apprentice that learns a desk job by watching an expert do it, asks why at the right moments, turns it into a Work Map, and teaches the next person.**

Hack-Nation × ElevenLabs · 7th Global AI Hackathon · Challenge 01: *The AI Apprentice*

| | |
|---|---|
| 🎤 **Pitch video** | https://youtu.be/CDk9xKfkDSE |
| 👥 **Team video** | https://youtu.be/VZDgWwMC0fk |
| 🎬 **Demo video** | https://youtu.be/EOa8bZaofmk |
| 📄 **1-page report (PDF)** | [docs/report/report.pdf](docs/report/report.pdf) |
| 🌐 **Website** | https://gsnmithra.github.io/tacit-app/ |
| ⬇️ **Download the app** | [macOS (Apple silicon)](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-mac-arm64.dmg) · [macOS (Intel)](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-mac-x64.dmg) · [Windows](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-win-x64.exe) · [Linux](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-linux-x86_64.AppImage) |
| 📘 **Install guide** | https://gsnmithra.github.io/tacit-app/install.html |

The installers connect to our hosted backend on their own. They are unsigned, so on first open use right-click → Open (macOS) or More info → Run anyway (Windows); see the install guide.

---

## The problem

Our most experienced people are retiring with decades of judgment that was never written down. Screen recordings and process documents capture *what* was clicked, not *why*. The limits, exceptions and moments to stop and ask live only in people's heads, and new hires learn them by breaking them.

## What Tacit does

**1. Capture: it asks why while the expert works.**
The expert shares their screen; a floating pill watches. A vision model turns frames into events ("invoice 4471 opened", "cost center 4711 → 0400"). An ElevenLabs voice agent stays quiet while the expert types, reads or talks, and asks short questions only at natural pauses: why this step, is there a limit, when would you stop and ask someone. At least three questions, one about a guardrail, are checked in code. A fast model skips anything the screen or common practice already answers.

**2. Map: a debrief that closes the gaps.**
When the task ends, the apprentice asks about what is still unclear, then explains the process back in under 30 seconds until the expert says "yes, that's how it works". The result is a **Work Map**: an animated, clickable graph where every step shows its screen moment, a clip, the decision, the reason in the expert's own words, and the guardrails around it. Click a step to focus it; Next walks the workflow.

**3. Teach: a tutor for the next person.**
A new hire works a case the expert never showed, on their own screen. The tutor explains each step the way the expert did, asks them to predict the next decision, and **locks the save before a wrong decision is posted**, replaying the expert's moment. It ends with what they mastered and what to practice. **Sia**, a guide agent, can also walk a learner (or review with the expert) through any step of the Work Map.

### Beyond the brief
- **Two experts, one task:** compare two sessions, see what's the same, what differs and what only one did, and ask each expert why in their next session ("Record again").
- **Any language:** the expert and the new hire can each speak any of 72 languages; the Work Map stays in English with the original quotes beside the translation.
- **Agent-ready guardrails:** export a Work Map as instructions an agent can load, every guardrail a STOP rule; an **autopilot** in the practice ERP posts routine invoices and hands every judgment call to a person.
- **Living Work Map:** a repeat session asks only about what changed and keeps an update to apply to the original map.
- **Coverage check:** notices a case no confirmed map covers and asks one question.

## The Apprentice Test

| Question | How Tacit answers it |
|---|---|
| **When to ask** | The pill holds the floor: voice activity, pixel motion on the shared screen and reading time keep the agent quiet; only a pause after an action lets it speak. The pace follows Settings and never drops below three questions. |
| **What to ask** | Each pause carries the latest screen events; the prompt asks only what the screen can't show (why, limits, who decides), and a fast model filters out what's already clear (≥ 90% sure). |
| **When it has understood** | The draft map's open questions drive the debrief (at least three); the teach-back is the proof, corrections win, and only the expert's "yes" saves the map. Quotes are checked against the transcript. |
| **Whether the new hire learned** | The tutor uses a case the expert never showed; the end report is computed from what the learner actually did, not written by an LLM. |
| **Trust** | Off the record (press O): nothing is seen, heard or recorded. An on-device privacy shield paints over emails, IBANs, phone and card numbers before any frame leaves the machine; text is redacted on the server, names with Presidio. |

## Architecture

```
Desktop app (Electron + React)          Hosted backend (FastAPI on Render)        Services
 ├─ Studio, pill, Work Map, tutor  ──►   ├─ sessions, screen events, merge    ──►  OpenAI (vision, merge, checks)
 ├─ privacy shield (on device)           ├─ Work Map diff, export, coverage        ElevenLabs Agents (apprentice,
 └─ practice ERP "Ledgerly"              └─ access key on every request            tutor, guide) + Scribe realtime
                                                                                   Supabase (Postgres, Storage)
```

- **Desktop app:** `pixel-perfect-capture/` (Electron, React, TanStack Router, @xyflow/react, Tailwind). Packaged for macOS, Windows and Linux with electron-builder.
- **Backend:** `core/backend/` (FastAPI, Python, uv). Deployed on Render from `render.yaml`; every API key stays on the server.
- **Website:** `website/` (static), published at https://gsnmithra.github.io/tacit-app/.
- **Tests:** 482 backend (pytest) and 262 UI (vitest) tests; `./.claude/check.sh` runs them with the build and lint.

## Data and datasets

Tacit does not use an external dataset. Everything runs on **Ledgerly**, a practice ERP built into the app ([`pixel-perfect-capture/src/lib/sandbox.ts`](pixel-perfect-capture/src/lib/sandbox.ts)) with synthetic supplier invoices modeled on the challenge's running example: equipment over the €5,000 capex line, a supplier that double-bills in December, and an invoice from a Czech subsidiary that needs a second approval. There are two sets: the expert's session and a new hire's practice set with cases the expert never showed. No real people, companies or personal data are included.

Sources the challenge suggested and how we used them:
- **ElevenLabs Agents and Scribe:** the voice of the apprentice, tutor and guide.
- **Microsoft Presidio:** name redaction in transcripts and quotes (on by default on the hosted backend).
- **O\*NET and WebArena:** not used; our own sandbox gave us control over the hidden judgment calls.

## Run it locally

```bash
./start.sh            # backend (:8000), UI (:8081) and the desktop app
./start.sh --web      # backend + UI in the browser
```

You need Node 20+, [uv](https://docs.astral.sh/uv/), and `core/backend/.env.development` with `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `SUPABASE_DB_URL` (see `core/backend/.env.example`). More: [DEV.md](DEV.md), [USE.md](USE.md), [docs/DEMO.md](docs/DEMO.md) (demo run sheet), [docs/DEPLOY.md](docs/DEPLOY.md) (hosting), [docs/INSTALL.md](docs/INSTALL.md) (for people you send the app to).

## Repository

| Path | What's there |
|---|---|
| `pixel-perfect-capture/` | The desktop app: Studio, pill, Work Map, tutor, practice ERP |
| `core/backend/` | The backend: API, voice agent config, merge, diff, tutor, privacy |
| `website/` | The product website |
| `docs/` | Report, pitch, demo run sheet, challenge brief, deploy and install guides |
| `.github/workflows/release.yml` | Builds the macOS, Windows and Linux installers on a version tag |

## Moonshot

A **living company memory**: every expert and every workflow in one map that stays current. When the work changes, the apprentice asks only about what's new; people keep the judgment calls, and agents take the routine steps safely. Today's pieces (repeat-session updates, the coverage check, agent-ready export and the autopilot that stops at guardrails) are the first slices of it.
