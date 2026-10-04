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
| ⬇️ **Download** | [macOS (Apple silicon)](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-mac-arm64.dmg) · [macOS (Intel)](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-mac-x64.dmg) · [Windows](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-win-x64.exe) · [Linux](https://github.com/GsnMithra/tacit-app/releases/latest/download/Tacit-linux-x86_64.AppImage) |

---

## Install (2 minutes)

The app connects to our hosted server by itself: no account, no setup. Our builds aren't signed with an Apple or Microsoft certificate yet, so your computer asks once whether you trust Tacit. That's expected.

### macOS

1. Download the right file: **Apple silicon** if Apple menu → About This Mac shows *Chip: Apple M…*, otherwise **Intel**.
2. Open the `.dmg` and drag **Tacit** into **Applications**.
3. Open Tacit. macOS says *"Tacit" Not Opened*. Click **Done**.
4. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Tacit.
5. Open Tacit again and click **Open**. Allow the **microphone**, and **screen recording** when asked.

> Shortcut: in Terminal, run `xattr -dr com.apple.quarantine /Applications/Tacit.app`, then open Tacit.

### Windows

1. Download and run `Tacit-win-x64.exe`.
2. If you see *Windows protected your PC*, click **More info → Run anyway**.
3. Tacit installs and opens. Allow the microphone when asked.

### Linux

1. Download `Tacit-linux-x86_64.AppImage`.
2. Run `chmod +x Tacit-linux-x86_64.AppImage`, then `./Tacit-linux-x86_64.AppImage`.
3. If it complains about FUSE, install it once: `sudo apt install libfuse2` (on Ubuntu 24.04: `libfuse2t64`).

**First launch:** the server is on a free plan and may take up to a minute to wake. If Tacit shows **Connect to Tacit**, everything is already filled in: click **Connect** and wait a moment.

### Try it in 5 minutes

1. In Tacit, click **Open the practice ERP** (Ledgerly) and pick **Expert's session**.
2. Click **Start session**, then work a few invoices out loud. The apprentice asks at the pauses.
3. Click **End**, answer the debrief, say "yes" to the teach-back, and open the **Work Map**.
4. On the Work Map, click **Teach a new hire**, switch Ledgerly to **New hire's practice**, and try to post invoice 4480 to the opex code. The tutor stops you.

The full demo script is in [docs/DEMO.md](docs/DEMO.md).

---

## How Tacit meets the brief

Every module, requirement and stretch goal in the challenge brief, and how Tacit delivers it.

### Module 1: Capture

| The brief asks for | What Tacit does |
|---|---|
| A screen-share app with a voice agent in a side panel | A floating **pill** over the expert's screen holds the voice agent (ElevenLabs) and the controls |
| A frame every second or two → a vision model → events | Frames go to a vision model about every second; it returns events like *invoice 4471 opened*, *cost center 4711 → 0400* |
| Stay quiet while the expert types, reads or talks | The pill holds the floor: voice activity, screen motion and reading time keep the agent silent |
| Ask at natural pauses: why, is there a limit, when would you stop and ask | Only a pause after an action lets the agent speak, and each question names what's on screen |
| **Required:** at least 3 questions at pauses, about the screen, at least 1 about a guardrail | Counted in code; the pill shows *Questions 2/3 · Guardrail ✓*, and if the expert ends early the missing ones are asked first |

### Module 2: Map

| The brief asks for | What Tacit does |
|---|---|
| A short spoken debrief about what's still unclear | The draft Work Map's open questions drive the debrief; steps with no screen moment or no words become questions |
| Explain the process back until the expert confirms | A short teach-back (under 30 seconds) of the judgment calls and guardrails; it stops when the expert says it's right |
| A clickable Work Map: screen moment, decision, reason in the expert's words, guardrails | An animated, clickable graph: each step shows its screen moment, a clip, the decision, the expert's own words and its guardrails |
| **Required:** 3+ follow-ups not answered during the task, ends with a confirmed teach-back | At least 3 debrief questions are enforced in code; only the expert's "yes" saves the map; corrections are recorded |
| **Required:** every step and guardrail links to a screen moment and the expert's words | Quotes are checked against the transcript and moments against real screen events; anything missing is marked *Unlinked* and asked about |

### Module 3: Teach

| The brief asks for | What Tacit does |
|---|---|
| A voice tutor watching the new hire's own screen | The tutor watches the new hire work in the practice ERP |
| Explain each step the way the expert did | It quotes the expert's reasons, in the new hire's language |
| Ask them to predict the next decision | Before a judgment call it asks *"which would you pick, and why?"* |
| Step in before a guardrail is broken, replaying the expert's screen moment | It **locks the Post / Hold / Send buttons** and waits for its check before a save goes through, then plays the expert's clip |
| Show what they've mastered and what to practice | An end report (*mastered · practice next · not covered*) computed from what they did, not written by an AI |
| **Required:** a case the expert never showed; catch a wrong decision before it's saved, explained with the expert's reasoning | The new hire's practice set has cases the expert never showed (e.g. a €7,200 equipment invoice pre-coded to opex) |

### The Apprentice Test

| Question | Tacit's answer |
|---|---|
| **When to ask** | Voice activity, screen motion and reading time hold the floor; a pause after an action opens it. The pace follows Settings and never drops below three questions. |
| **What to ask** | Each pause carries the latest screen events; the agent asks only what the screen can't show, and a quick check skips anything already clear (at least 90% sure). |
| **When it has understood** | The debrief works through the open gaps (at least three); the teach-back is the proof, and only the expert's "yes" saves the map. |
| **Whether the new hire learned** | A case the expert never showed; the tutor catches wrong decisions before the save; the report comes from what they actually did. |
| **Trust** | Press **O** to go off the record (nothing seen, heard or recorded). A privacy shield on the expert's computer paints over emails, IBANs, phone and card numbers before any frame leaves it; names are redacted on the server with Presidio. |

### Stretch goals

| Goal | What Tacit does |
|---|---|
| **Two experts, one task** | **Compare** two sessions side by side (same, differs, only one did), see a question for each expert, and click **Ask in their next session**; **Record again** asks it first |
| **Any language** | Expert and new hire can each speak any of 72 languages; the Work Map stays in English with the original quotes beside the translation |
| **Agent-ready guardrails** | **Export for agents** turns a Work Map into instructions with every guardrail as a STOP rule (Markdown and JSON) |

### Think bigger: the moonshot

| Direction | Where Tacit is today |
|---|---|
| **A living company memory** | Record a task again and the apprentice asks only about what changed, then keeps an update ready to apply to the original Work Map |
| **The always-on apprentice** | A coverage check recognizes routine work and spots a case no confirmed Work Map covers, ready with one question for the expert |
| **People first, then agents** | **Autopilot** in the practice ERP posts the routine invoices and hands every judgment call to a person, with the expert's rule |

### Built with ElevenLabs and the suggested wiring

| The brief suggests | In Tacit |
|---|---|
| ElevenAgents plays interviewer and tutor | Three agents: **apprentice** (interviewer), **tutor**, and **Sia**, a guide that walks anyone through a Work Map |
| A curious, patient voice | Tuned for speed with Eleven v4 Turbo and speculative turns, so Sia answers quickly; Expressive Mode (v3) is one setting away |
| Your choice of LLM | A fast agent model (GPT-6 Luna) for quick replies, configurable per agent |
| Scribe v2 Realtime | Scribe realtime listens, with patient turn-taking so the agent waits for real pauses |
| Client tools push screen events into the conversation | Screen events and pauses are sent into the live conversation; the agent records steps and guardrails through client tools |
| An LLM merges events, transcript and answers into Work Map JSON and lists gaps | The merge builds the Work Map and its open questions for the debrief |
| The Work Map goes into the tutor's knowledge base and Procedures | The tutor gets the full Work Map in every session, and Tacit generates knowledge-base and Procedures payloads from any map |
| Microsoft Presidio | Name redaction on the hosted server |
| *Ask less, later* | 3 to 5 live questions, spaced out; the rest waits for the debrief |

### "What good looks like"

The built-in practice ERP reproduces the brief's scene exactly: invoice **4471** (€6,850 equipment, re-coded from opex 4711 to capex 0400), **4472** (a supplier that double-bills in December, held), **4473** (the Czech subsidiary, sent for a second approval), and for the new hire **4480**, a fresh €7,200 equipment invoice pre-coded to opex, where the tutor says *"Sabine would stop here. Why do you think?"* and replays her moment.

---

## Everything else we added

- **Sia on the Work Map:** *Talk to Sia* with two modes, **Learn this task** (for a new hire) and **Review as the expert** (walk through it and correct it by voice). Sia moves the map's focus as she talks.
- **A Work Map you can walk:** click a step to glide to it; **Next / Previous** (or ← →) follow the workflow; animated entrance and a flowing path to the next step.
- **Bigger clips:** **Enlarge** opens a clip in a resizable in-app view that remembers its size.
- **Fewer, better questions:** a quick check before each question skips what the screen or common practice already answers; sure-enough reasons become assumptions for the expert to confirm in the teach-back.
- **Edit by voice:** the expert can change steps and rules by talking; the map updates live.
- **Settings that work:** the question pace (curiosity, minimum questions, debrief depth) changes live sessions; **Diagnostics** checks the server, redaction, storage and voice agents.
- **Desktop app for macOS, Windows and Linux**, connected to a hosted server; every AI key stays on the server, behind an access key.
- **A product website** with OS-aware downloads and an install guide.
- **Tested:** 482 backend and 262 app tests run on every change.

## What's next

The moonshot we're building toward is **the world's operations manual**: anonymized Work Maps across many companies that show how digital work is really done, and teach it to anyone. Next on that path:
- **MCP guardrail lookup**, so any agent, including the tutor, can ask Tacit's guardrails on demand.
- **Living Work Maps for every expert**: repeat sessions that update the shared map, reviewed and applied in one click.
- **The always-on apprentice in every session**: the coverage check asking its one question at the right pause during everyday work.

## Architecture

```
Desktop app (Electron + React)        Hosted server (FastAPI on Render)         Services
 ├─ Studio, pill, Work Map, tutor ──►  ├─ sessions, screen events, merge   ──►  OpenAI (vision, merge, checks)
 ├─ privacy shield (on device)         ├─ compare, export, coverage, autopilot  ElevenLabs Agents + Scribe realtime
 └─ practice ERP "Ledgerly"            └─ access key on every request           Supabase (Postgres, Storage)
```

| Path | What's there |
|---|---|
| `pixel-perfect-capture/` | The desktop app (Electron, React, TanStack Router, @xyflow/react, Tailwind) |
| `core/backend/` | The server (FastAPI, Python): API, voice agent setup, merge, compare, tutor, privacy |
| `website/` | The product website |
| `docs/` | The report, pitch, demo script, challenge brief, deploy and install guides |

## Data and datasets

No external dataset. Everything runs on **Ledgerly**, the practice ERP built into the app ([`pixel-perfect-capture/src/lib/sandbox.ts`](pixel-perfect-capture/src/lib/sandbox.ts)), with synthetic invoices in two sets: the expert's session and the new hire's practice set. No real people, companies or personal data. Of the brief's suggested sources we use **ElevenLabs Agents and Scribe** and **Microsoft Presidio**; we didn't use O\*NET or WebArena, because our own sandbox lets us control the hidden judgment calls.

## Run from source

```bash
./start.sh          # server (:8000), app UI (:8081) and the desktop app
./start.sh --web    # server + UI in the browser
```

Needs Node 20+, [uv](https://docs.astral.sh/uv/) and `core/backend/.env.development` with `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `SUPABASE_DB_URL` (see `core/backend/.env.example`). More in [DEV.md](DEV.md) and [docs/DEPLOY.md](docs/DEPLOY.md).
