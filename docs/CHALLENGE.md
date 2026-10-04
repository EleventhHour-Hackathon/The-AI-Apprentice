# The AI Apprentice: challenge brief

Hack-Nation × ElevenLabs, 7th Global AI Hackathon, Challenge 01. Copied from the PDF so agents
and teammates can check progress against it (`docs/PROGRESS.md`).

## Your challenge

Build the AI Apprentice: a working end-to-end MVP that captures what an expert knows while they
work, maps it into a workflow anyone can follow and teaches it to the next generation. An ElevenLabs
voice agent watches the expert's screen, asks why at the right moments and runs a short debrief until
it fully understands the process.

The conversation is the core. The expert shares their screen and does a real task. The voice agent
stays quiet while they type and asks short spoken questions at natural pauses: why this step, what
would change the decision, what they would never do.

The debrief closes the gaps. When the task is done, the apprentice asks about the exceptions it
noticed, the rules it is unsure about and the cases it has not seen. Then it explains the process back
until the expert says: yes, that is how it works.

Your use case, your interface. Invoicing is the running example, but any knowledge-driven desk work
fits: insurance claims, procurement, support escalations, KYC checks. The interface is yours too: a
side panel, a floating voice companion, a replayable timeline or a coaching overlay.

**An apprentice, not a recorder.** A recorder captures what happened. An automation tool copies the
clicks. An apprentice asks why, learns the rules and guardrails behind each step, and keeps asking
until nothing is unclear. If a new person could not do the task from what it learned, it is not an
AI Apprentice.

## Modules (build all three)

### Module 1: Capture

A web app where the expert shares their screen and an ElevenLabs agent listens in a side panel.
Every second or two, send a frame to a vision model and turn what changed into events: invoice 4471
opened, cost center changed from 4711 to 0400. The agent stays quiet while the expert types, reads
or talks, and asks at natural pauses: why this step, is there a limit, when would you stop and ask
someone?

**Required:** During a real task, the agent asks at least three questions, each at a natural pause
and about something visible on screen. At least one is about a guardrail.

### Module 2: Map

When the task ends, the apprentice runs a short spoken debrief. It asks about what is still unclear,
then explains the whole process back in its own words so the expert can confirm or correct it. The
result is the Work Map: a clickable timeline where every step shows the screen moment, the decision,
the reason in the expert's words and the guardrails around it.

| Example step | Step 4 of 7: code the invoice to a cost center |
|---|---|
| Screen moment | 03:12, invoice 4471, cost center field |
| Decision | Re-coded from opex (4711) to capex (0400) |
| Reason | "Equipment over €5,000 is always capex." Sabine, live question at 03:15 |
| Guardrails | No asset number, no capex booking. Unknown supplier: stop and ask the controller. |

**Required:** The debrief asks at least three follow-up questions that were not answered during the
task and ends with a teach-back the expert confirms. Every step and guardrail links to a screen
moment and the expert's own words.

### Module 3: Teach

Turn the Work Map into a voice tutor for the next generation. The new hire works a case on their own
screen while the tutor watches, explains each step the way the expert did, asks them to predict the
next decision and steps in before a guardrail is broken, replaying the expert's screen moment when it
helps. At the end it shows what they have mastered and what to practice next.

**Required:** A judge playing a new hire processes a case the expert never showed. The tutor catches
at least one wrong decision before it is saved and explains it using the reasoning the expert gave.

## The Apprentice Test (the demo must answer all five)

1. **When to ask.** How does the agent know the expert has paused, and stay quiet while they type,
   read or talk?
2. **What to ask.** How does it pick the question that reveals a reason or a guardrail, instead of
   one the screen already answers?
3. **When it has understood.** How does the debrief decide it is done, and how does the teach-back
   prove it?
4. **Whether the new hire learned.** How do you show they can handle a new case on their own?
5. **Trust.** How can the expert take something off the record, and how is personal data on screen
   protected?

## Stretch goals

- **Two experts, one task.** Show where two sessions differ and ask each expert why.
- **Any language.** The expert explains in German; the tutor teaches a new hire in English.
- **Agent-ready guardrails.** Export the Work Map as instructions an agent can load, so it follows
  the same steps and stops where the expert would.

## Think bigger: the moonshot

End the pitch with one slide: the moonshot you would build next and how today's MVP gets you there.

- **A living company memory.** Every expert and every workflow in one map that stays current. When
  the work changes, the apprentice asks only about what is new.
- **The always-on apprentice.** No scheduled sessions. It notices a case it has never seen during
  everyday work and asks one question at the right moment.
- **People first, then agents.** The steps and guardrails that teach a new hire also let agents take
  routine steps safely, while people keep the judgment calls.
- **The world's operations manual.** Anonymized Work Maps across thousands of companies that show
  how the world's digital work is really done, and teach it to anyone, anywhere.

## Built with ElevenLabs

- ElevenAgents plays both roles, interviewer and tutor, with Expressive Mode for a curious, patient
  voice.
- Your choice of LLM behind the agent. It decides what to ask, when, and when it has understood
  enough.
- Scribe v2 Realtime listens while people work and knows when they pause.

One way to wire it:

1. The browser shares the screen. A frame every one to two seconds goes to a vision model, which
   returns events, not video.
2. Client tools push those events into the ElevenAgents conversation, so the agent knows what is on
   screen.
3. After the task, an LLM merges events, transcript and answers into Work Map JSON and lists what is
   still unclear for the debrief.
4. The Work Map goes into the tutor's knowledge base and Procedures, and the tutor watches the new
   hire's screen the same way.

Tips: start with voice and one screen. Ask less, later: three to five live questions per ten
minutes; the rest waits for the debrief.

## Data sources and hints

| Category | Source | Use |
|---|---|---|
| Agent brain | ElevenAgents LLM options (elevenlabs.io/docs/agents-platform/customization/llm) | Model behind interviewer and tutor |
| Screen understanding | Any vision model (Claude, Gemini, GPT) | Describe what changed between frames |
| Debrief and Work Map | Any agent framework | Merge events, transcript and answers; find the gaps |
| Tools | ElevenLabs MCP tools (elevenlabs.io/docs/eleven-agents/customization/tools/mcp) | Let the tutor look up guardrails through an MCP server |
| Tasks and roles | O*NET database (onetcenter.org/database.html) | 18,838 tasks across 1,016 occupations |
| Screen sandbox | WebArena (webarena.dev) | Self-hosted web apps with fake data |
| Privacy | Microsoft Presidio | Redact personal data in transcripts and frames |

## Bring your own workflow

A good one takes 5 to 10 minutes on screen, hides at least one judgment call that is not written
down anywhere, and has real guardrails: a limit, an exception, a moment to stop and ask someone.
Default: three supplier invoices in a sandbox ERP, one over the €5,000 capex line and one from a
supplier that double-bills in December.

## What good looks like

A judge playing Sabine shares their screen and processes three invoices while talking. At a pause, a
calm voice asks: "You moved that one to capex. What made you do that?" The judge explains that
equipment over €5,000 is always capex. In the debrief it asks: "You held the December invoice. Is
that for every supplier, and who decides when to release it?" Then it explains the whole process back
in under a minute, and the judge corrects one detail. The Work Map shows seven steps, three judgment
calls and four guardrails, each linked to its moment on screen. Then a second judge, playing a new
hire, opens a fresh €7,200 equipment invoice and reaches for the opex code. The tutor says: "Sabine
would stop here. Why do you think?" It replays her screen moment and lets them fix it. That is the
bar.

| Strong | Weak |
|---|---|
| Asks at natural pauses, about what is on screen | Interrupts mid-typing, or asks generic questions |
| Captures guardrails: limits, exceptions, when to stop and ask | Captures only the happy path |
| The debrief closes gaps and ends with a teach-back | A summary written from the transcript afterwards |
| The tutor teaches a new hire to decide, in the expert's words | A screen recording nobody will watch |
| A pitch with a clear moonshot and a path to it | A demo that stops at the demo |
