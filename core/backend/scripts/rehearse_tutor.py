"""Rehearse the tutor agent over text, without a microphone.

Starts a real lesson from a Work Map, then plays a new hire's case against the
live tutor agent: the pill's [SCREEN] updates and its [PREDICT], [STOP],
[FIXED] and [LESSON DONE] cues, with the real report behind finish_lesson.

    uv run python scripts/rehearse_tutor.py <work map id>

Needs the backend running on localhost:8000. Uses a little ElevenLabs credit.
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

BACKEND = "http://localhost:8000/api/v1"


def post(path, body):
    request = urllib.request.Request(
        BACKEND + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"}
    )
    return json.loads(urllib.request.urlopen(request).read())


async def main(work_map_id: str):
    lesson = post("/lessons", {"work_map_id": work_map_id})
    lesson_id = lesson["lesson_id"]
    first = lesson["steps"][0]["id"]
    # What the pill would record from its checks, so finish_lesson has real attempts to report on.
    attempts = {
        "stop": {"type": "intervention", "step": first, "what_happened": "cost center set to 4711 on a 7,200 EUR equipment invoice", "expected": "0400"},
        "fixed": {"type": "fixed", "step": first},
    }
    script = [
        ("screen", "context", "[SCREEN 00:05] Invoice 5120 from Hoffmann Antriebstechnik opened, 7,200 EUR, new gearbox, cost center empty", 1, None),
        ("thinking aloud", "user", "Okay, a gearbox from Hoffmann, let me see.", 7, None),
        ("predict", "user", f'[PREDICT step={first}] They are about to reach "{lesson["steps"][0]["title"]}". Before they act, ask them to predict the decision.', 9, None),
        ("wrong guess", "user", "I'd just leave it on the usual 4711.", 10, None),
        ("screen", "context", "[SCREEN 00:21] Cost center on invoice 5120 changed from empty to 4711", 1, "stop"),
        ("stop", "user", f"[STOP step={first} guardrail=g1] The new hire just did: cost center on invoice 5120 (7,200 EUR equipment) set to 4711. The expert would: set cost center 0400, equipment over 5,000 EUR is capex. Step in now, before they save.", 10, None),
        ("answer", "user", "Hmm, because it's over five thousand?", 10, None),
        ("screen", "context", "[SCREEN 00:40] Cost center on invoice 5120 changed from 4711 to 0400", 1, "fixed"),
        ("fixed", "user", f"[FIXED step={first}] They corrected it: cost center changed from 4711 to 0400.", 7, None),
        ("done", "user", "[LESSON DONE] The case is finished. Call finish_lesson now.", 14, None),
    ]

    agent_id = apprentice_agent.find_agent_id("tutor")
    url = apprentice_agent._call(f"/v1/convai/conversation/get-signed-url?agent_id={agent_id}")["signed_url"]
    beats = [{"label": "greeting", "said": [], "tools": []}]
    async with websockets.connect(url, max_size=None) as ws:
        await ws.send(json.dumps({
            "type": "conversation_initiation_client_data",
            "dynamic_variables": {"task": lesson["task"], "work_map": lesson["work_map"]},
        }))

        async def listen(seconds):
            end = time.monotonic() + seconds
            while (left := end - time.monotonic()) > 0:
                try:
                    event = json.loads(await asyncio.wait_for(ws.recv(), timeout=left))
                except asyncio.TimeoutError:
                    return
                kind = event.get("type")
                if kind == "ping":
                    await ws.send(json.dumps({"type": "pong", "event_id": event["ping_event"]["event_id"]}))
                elif kind == "agent_response":
                    beats[-1]["said"].append(event["agent_response_event"]["agent_response"])
                elif kind == "client_tool_call":
                    call = event["client_tool_call"]
                    beats[-1]["tools"].append(f"{call['tool_name']}({json.dumps(call.get('parameters', {}))[:140]})")
                    if call["tool_name"] == "record_prediction":
                        post(f"/lessons/{lesson_id}/attempt", {"type": "prediction", **call.get("parameters", {}), "step": call["parameters"].get("step_id")})
                    result = (
                        post(f"/lessons/{lesson_id}/finish", {"transcript": []})["summary"]
                        if call["tool_name"] == "finish_lesson"
                        else "Recorded."
                    )
                    await ws.send(json.dumps({"type": "client_tool_result", "tool_call_id": call["tool_call_id"], "result": result, "is_error": False}))

        await listen(6)
        for label, kind, text, wait, record in script:
            if record:
                post(f"/lessons/{lesson_id}/attempt", attempts[record])
            if kind == "context":
                await ws.send(json.dumps({"type": "contextual_update", "text": text}))
            else:
                beats.append({"label": f"{label}: {text[:70]}", "said": [], "tools": []})
                await ws.send(json.dumps({"type": "user_message", "text": text}))
            await listen(wait)

    for b in beats:
        print(f"\n▸ {b['label']}")
        print(f"  said:  {' | '.join(b['said']) or '(silent)'}")
        for t in b["tools"]:
            print(f"  tool:  {t}")
    report = json.loads(urllib.request.urlopen(f"{BACKEND}/lessons/{lesson_id}").read())["report"]
    print("\nREPORT", json.dumps(report, indent=1)[:1500])


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
