"""Rehearse the AI Apprentice agent over text, without a microphone.

Plays a short scripted session against the live ElevenLabs agent: the pill's
[SCREEN] context updates, the expert's narration, three [PAUSE]s with answers
and [TASK DONE]. Prints what the agent said and which tools it called at each
beat, so prompt changes can be checked before a real voice session:

    uv run python scripts/rehearse_agent.py

Uses a little ElevenLabs credit (the agent still speaks its replies).
"""

import asyncio
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import websockets  # noqa: E402

from src.core.config import Config  # noqa: E402,F401  (loads .env.development)
from src.services import apprentice_agent  # noqa: E402

BRIEF = """DRAFT WORK MAP
Steps:
1. [00:31] Re-coded cost center for invoice 4471: 4711 to 0400 (reason: equipment over 5,000 is capex)
2. [01:58] Put invoice 4480 on hold (reason unknown)
Guardrails:
- limit: Equipment over 5,000 EUR is always capex

ASK ABOUT THESE GAPS FIRST, one at a time:
- Why did you put the Brightline invoice on hold?
- If equipment is exactly 5,000 EUR, does it go to 0400?
- Who do you ask if an asset number is missing?"""

# (label, kind, text, seconds to listen afterwards)
PAUSE = "[PAUSE] The expert has stopped after: {steps}. {ask}"
FIRST = "You have asked {n} of at least 3 questions, so ask one now, about something on screen."
NO_GUARDRAIL = " No guardrail yet: make this one about a limit, an exception or when they would stop and ask someone."

# (label, kind, text, seconds to listen afterwards); [PAUSE] is worded the way the pill sends it.
SCRIPT = [
    ("task", "user", "I'm approving this week's supplier invoices.", 9),
    ("screen", "context", "[SCREEN 00:08] Invoice 4471 from Kessler Maschinenbau opened, 7,800 EUR, cost center 4711", 1),
    ("screen", "context", "[SCREEN 00:31] Cost center on invoice 4471 changed from 4711 to 0400", 1),
    ("narration", "user", "Okay so this one is a machine part, I'm putting it on the other cost center.", 8),
    ("pause 1", "user", PAUSE.format(steps="[00:31] Cost center on invoice 4471 changed from 4711 to 0400", ask=FIRST.format(n=0)), 9),
    ("answer", "user", "It's a machine part, so it goes to 0400.", 9),
    ("screen", "context", "[SCREEN 01:40] Invoice 4480 from Brightline Ltd (UK) opened, 2,300 GBP, new supplier", 1),
    ("screen", "context", "[SCREEN 01:58] Invoice 4480 status changed from Open to On hold", 1),
    ("narration", "user", "This one waits.", 8),
    ("pause 2", "user", PAUSE.format(steps="[01:40] Invoice 4480 from Brightline Ltd (UK) opened; [01:58] Invoice 4480 status changed from Open to On hold", ask=FIRST.format(n=1) + NO_GUARDRAIL), 9),
    ("answer", "user", "New suppliers wait until purchasing has checked their bank details. I'd ask Jana in purchasing.", 9),
    ("screen", "context", "[SCREEN 03:05] Invoice 4485 from Kessler Maschinenbau, 12,400 EUR, sent for approval to controller", 1),
    ("pause 3", "user", PAUSE.format(steps="[03:05] Invoice 4485, 12,400 EUR, sent for approval to controller", ask=FIRST.format(n=2)), 9),
    ("answer", "user", "Anything over ten thousand goes to the controller, no matter what.", 9),
    ("done", "user", "[TASK DONE] The expert pressed End: the task is finished. Call start_debrief now.", 14),
]


async def main():
    agent_id = apprentice_agent.find_agent_id()
    url = apprentice_agent._call(f"/v1/convai/conversation/get-signed-url?agent_id={agent_id}")["signed_url"]
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({"type": "conversation_initiation_client_data"}))
        beat = {"label": "greeting", "said": [], "tools": []}
        beats = [beat]

        async def listen(seconds: float):
            end = time.monotonic() + seconds
            while (left := end - time.monotonic()) > 0:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    return
                event = json.loads(raw)
                kind = event.get("type")
                if kind == "ping":
                    await ws.send(json.dumps({"type": "pong", "event_id": event["ping_event"]["event_id"]}))
                elif kind == "agent_response":
                    beats[-1]["said"].append(event["agent_response_event"]["agent_response"])
                elif kind == "client_tool_call":
                    call = event["client_tool_call"]
                    beats[-1]["tools"].append(f"{call['tool_name']}({json.dumps(call.get('parameters', {}))[:160]})")
                    result = BRIEF if call["tool_name"] == "start_debrief" else "Recorded."
                    await ws.send(json.dumps({
                        "type": "client_tool_result",
                        "tool_call_id": call["tool_call_id"],
                        "result": result,
                        "is_error": False,
                    }))

        await listen(6)
        for label, kind, text, wait in SCRIPT:
            if kind == "context":
                await ws.send(json.dumps({"type": "contextual_update", "text": text}))
            else:
                beats.append({"label": f"{label}: {text[:60]}", "said": [], "tools": []})
                await ws.send(json.dumps({"type": "user_message", "text": text}))
            await listen(wait)

    for b in beats:
        print(f"\n▸ {b['label']}")
        print(f"  said:  {' | '.join(b['said']) or '(silent)'}")
        for t in b["tools"]:
            print(f"  tool:  {t}")


if __name__ == "__main__":
    asyncio.run(main())
