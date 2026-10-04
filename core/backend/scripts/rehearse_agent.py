"""Rehearse the AI Apprentice agent over text, without a microphone.

Plays a short scripted session against the live ElevenLabs agent: the pill's
[SCREEN] context updates, the expert's narration, three [PAUSE]s with answers
and [TASK DONE]. Prints what the agent said and which tools it called at each
beat, so prompt changes can be checked before a real voice session:

    uv run python scripts/rehearse_agent.py           # watching, three pauses, debrief
    uv run python scripts/rehearse_agent.py --review  # the end: teach-back, save, edits by voice

Uses a little ElevenLabs credit (the agent still speaks its replies).
"""

import asyncio
import copy
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import websockets  # noqa: E402

from src.core.config import Config  # noqa: E402,F401  (loads .env.development)
from src.services import apprentice_agent, work_map_edit  # noqa: E402

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


# The map the review rehearsal saves and edits, with the real edit logic (work_map_edit).
MAP = {
    "steps": [
        {"id": "s1", "title": "Code the invoice to a cost center", "decision": "re-coded 4471 from 4711 to 0400",
         "reason": "equipment over 5,000 EUR is always capex"},
        {"id": "s2", "title": "Hold invoices from new suppliers", "decision": "put 4480 from Brightline on hold",
         "reason": "purchasing checks a new supplier's bank details first"},
        {"id": "s3", "title": "Send large invoices for approval", "decision": "sent 4485 to the controller",
         "reason": "anything over 10,000 goes to the controller"},
    ],
    "guardrails": [
        {"id": "g1", "kind": "limit", "rule": "Equipment over 5,000 EUR is always capex", "applies_when": "coding equipment", "ask_whom": ""},
        {"id": "g2", "kind": "stop_and_ask", "rule": "New suppliers wait until purchasing checks bank details", "applies_when": "a new supplier", "ask_whom": "Jana in purchasing"},
    ],
}

REVIEW = [
    ("task", "user", "I'm approving this week's supplier invoices.", 9),
    ("done", "user", "[TASK DONE] The expert pressed End: the task is finished. Call start_debrief now.", 14),
    ("skip", "user", "Let's skip the questions today. Can you just explain it back to me?", 25),
    ("confirm", "user", "Yes, that's exactly how it works.", 16),
    ("change rule", "user", "Actually, change the first rule. The capex limit is ten thousand euros, not five.", 12),
    ("remove step", "user", "And drop step two, purchasing handles that now.", 12),
    ("again", "user", "Can we go through it again from the first step?", 12),
    ("ok 1", "user", "Yes, that one's right.", 10),
    ("ok 2", "user", "Yes.", 10),
    ("finish", "user", "No, that's everything. We're done.", 10),
]


def edit_result(change: str, stale: str, summary: str) -> str:
    """Worded like the pill's edit_work_map result (use-apprentice.ts)."""
    next_step = (
        f"These fields still carry the old value: {stale}. Call edit_work_map to change only those fields so the map agrees, "
        "then say the new version back in one short sentence and ask if that is right."
        if stale
        else "Say the new version back in one short sentence and ask if that is right."
    )
    return f"Done: {change}. The Work Map now:\n{summary}\n\n{next_step}"


def answer(call: dict, review: bool) -> str:
    name, params = call["tool_name"], call.get("parameters") or {}
    if name == "start_debrief":
        return BRIEF
    if not review:
        return "Recorded."
    if name == "confirm_work_map":
        return f"Saved. The Work Map as saved (ids are for edit_work_map):\n{work_map_edit.summary_for_agent(MAP)}\n\nTell the expert in one sentence that it is saved, ask whether they would like to change anything, and wait for their answer. Do not call end_call yet."
    if name == "edit_work_map":
        try:
            _, change, stale = work_map_edit.apply(MAP, params)
        except work_map_edit.EditError as e:
            return f"Not changed: {e}. Ask the expert which item they mean, or what it should say."
        return edit_result(change, stale, work_map_edit.summary_for_agent(MAP))
    if name == "read_work_map":
        return f"The Work Map as saved (ids are for edit_work_map):\n{work_map_edit.summary_for_agent(MAP)}\n\nRead the items one at a time, starting where the expert asked, and after each ask whether it is right."
    return "Recorded."


async def main():
    review = "--review" in sys.argv
    script = REVIEW if review else SCRIPT
    start = copy.deepcopy(MAP)
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
                except websockets.ConnectionClosed:
                    beats[-1]["tools"].append("(call ended)")
                    return False
                event = json.loads(raw)
                kind = event.get("type")
                if kind == "ping":
                    await ws.send(json.dumps({"type": "pong", "event_id": event["ping_event"]["event_id"]}))
                elif kind == "agent_tool_response" and event["agent_tool_response"].get("tool_type") == "system":
                    beats[-1]["tools"].append(event["agent_tool_response"]["tool_name"])
                elif kind == "agent_response":
                    beats[-1]["said"].append(event["agent_response_event"]["agent_response"])
                elif kind == "client_tool_call":
                    call = event["client_tool_call"]
                    beats[-1]["tools"].append(f"{call['tool_name']}({json.dumps(call.get('parameters', {}))[:160]})")
                    result = answer(call, review)
                    await ws.send(json.dumps({
                        "type": "client_tool_result",
                        "tool_call_id": call["tool_call_id"],
                        "result": result,
                        "is_error": False,
                    }))

        await listen(6)
        for label, kind, text, wait in script:
            if kind == "context":
                await ws.send(json.dumps({"type": "contextual_update", "text": text}))
            else:
                beats.append({"label": f"{label}: {text[:60]}", "said": [], "tools": []})
                try:
                    await ws.send(json.dumps({"type": "user_message", "text": text}))
                except websockets.ConnectionClosed:
                    beats[-1]["said"].append("(not sent: the call had ended)")
                    break
            if await listen(wait) is False:
                break

    for b in beats:
        print(f"\n▸ {b['label']}")
        print(f"  said:  {' | '.join(b['said']) or '(silent)'}")
        for t in b["tools"]:
            print(f"  tool:  {t}")
    if review:
        print(f"\nMap before:\n{work_map_edit.summary_for_agent(start)}\n\nMap after:\n{work_map_edit.summary_for_agent(MAP)}")


if __name__ == "__main__":
    asyncio.run(main())
