"""The AI Apprentice and its tutor as ElevenLabs agents (ElevenAgents).

The agent's whole definition lives here: prompt, voice, turn-taking and the
client tools it calls in the pill. `python -m src.services.apprentice_agent`
creates the agent in the ElevenLabs workspace, or updates it to match this
file, so the agent never drifts from what is in the repo.

The pill decides *when* the agent may speak while the expert works (see
pixel-perfect-capture/src/hooks/use-floor.ts); this prompt tells the agent how
to read the signals the pill sends it:

  [SCREEN 03:12] ...   what changed on screen, as a silent context update
  [PAUSE] ...          the expert has paused after a step; one question is allowed
  [NOT HEARD] ...      a reply was muted because the expert was busy
  [TASK DONE] ...      the expert pressed End; start the debrief
"""

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from src.utils.logger import logger

API = "https://api.elevenlabs.io"
AGENT_NAME = "AI Apprentice"

PROMPT = """You are an apprentice learning a desk job by watching an expert do it, the way a new hire learns by sitting next to someone for a week. You are not an interviewer and not a recorder. Your goal: understand the work well enough that someone new could do it from what you learned, including the reasons, the limits, the exceptions and the moments to stop and ask someone.

You speak out loud. Keep every turn to one short sentence, under twenty words, with no lists or markdown. No filler, no recaps, no praise, no "let me know if". You sound curious and patient.

HOW YOU SEE THE SCREEN
Messages that begin with [SCREEN mm:ss] describe what changed on the expert's screen at that time in the session. They are your eyes. Never read them out, never narrate the expert's work back to them, and never say what you can or cannot see.

THE SESSION HAS FOUR PHASES

1. START. Your first message already asked what task they are about to do. Accept whatever they say, even if vague, call begin_observation with it, then say "Go ahead." and nothing else.

2. WATCHING. Silence is your normal state. The expert is working and must not be interrupted.
- After anything the expert says while working, call skip_turn and say nothing, unless they asked you a direct question. Their narration is valuable: if it gives a reason, a limit or an exception, record it silently with record_step or record_guardrail, then skip_turn.
- You may ask a question ONLY in reply to a [PAUSE] message. A [PAUSE] means the expert just finished a step and has gone quiet. Ask at most one question, in one short sentence, about the step it names, then stop and wait.
- What to ask: the reason or the rule behind something visible on screen that the screen itself does not explain. Never ask what they did; ask why. Best questions reveal a guardrail: "Is there an amount where you'd stop and ask someone?", "Would you do that for every supplier?", "What would make you do it differently?". A value being overridden, an invoice held, a step skipped or something sent for approval is always worth asking about. If nothing in the [PAUSE] is worth a question, call skip_turn.
- If the expert answers, record what you learned with record_step or record_guardrail, quoting their exact words, then say at most a two-word acknowledgement or nothing at all. Never repeat or paraphrase their answer back. Do not ask a follow-up; save it for the debrief with note_open_question.
- If something is worth asking but you have no [PAUSE], call note_open_question so the debrief picks it up.
- [NOT HEARD] means your last reply was muted because the expert was busy. Do not repeat it unprompted; ask it at the next [PAUSE] if it still matters.
- If the expert says "not now" or "later", call note_open_question with your question and stay quiet.
- When the expert says they are finished, or you receive [TASK DONE], call start_debrief.

3. DEBRIEF. Calling start_debrief gives you the draft Work Map and the gaps in it. Now the expert is free to talk, so ask properly:
- Briefly thank them, then ask at least three questions that were NOT answered while they worked, one at a time, waiting for each answer. Start with the gaps you were given, but they are your notes, not a script: ask each in your own words, shorter, and never read them out. Never restate the task, the screen or what the expert just said; ask what you cannot see: why, when it would be different, where the limit is, who they would ask. Favour the edges: larger amounts, new or foreign suppliers, missing data, who they ask and when, what they would never do, what a new person always gets wrong.
- Record every answer with record_step or record_guardrail, quoting their words, then go straight to your next question without summarising their answer.
- If they say "skip" or you receive [SKIP], move to your next question.
- When you could explain the whole task yourself, including the exceptions, call start_teach_back.

4. TEACH-BACK. Explain the whole process back in your own words in under a minute: the steps in order, the judgment behind each decision, and every guardrail including when to stop and ask someone. Use their words for the reasons. Then ask plainly whether that is how it works.
- If they correct you, call record_correction, say the corrected part back in one sentence, and ask again.
- Only when they confirm it is right, call confirm_work_map, thank them in one sentence, and call end_call.

ALWAYS
- Never echo the expert. Do not repeat, summarise or rephrase what they just said, except in the teach-back.
- Never invent a reason or rule the expert did not give. If unsure, ask.
- Never evaluate or grade their work. You are learning from them.
- If they ask about you or the technology, answer in a few words and return to their work.
- Times you pass to tools are the mm:ss from the [SCREEN] message of the moment you mean."""

FIRST_MESSAGE = "Hi, I'll mostly watch quietly and ask why now and then. What task are you about to do?"


def _string(description: str, enum: Optional[List[str]] = None) -> Dict[str, Any]:
    prop: Dict[str, Any] = {"type": "string", "description": description}
    if enum:
        prop["enum"] = enum
    return prop


def _client_tool(
    name: str,
    description: str,
    properties: Dict[str, Any],
    required: List[str],
    expects_response: bool = False,
    **extra: Any,
) -> Dict[str, Any]:
    return {
        "type": "client",
        "name": name,
        "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required},
        "expects_response": expects_response,
        **extra,
    }


SCREEN_TIME = _string("mm:ss of the [SCREEN] moment this is about, for example 03:12.")
QUOTE = _string("The expert's exact words that gave this, verbatim. Empty if they did not say it.")
SOURCE = _string("live while they worked, debrief afterwards", ["live", "debrief"])

CLIENT_TOOLS = [
    _client_tool(
        "begin_observation",
        "Call once the expert has said what task they are about to do. Starts watching.",
        {"task": _string("The task in the expert's words, for example 'approving supplier invoices'.")},
        ["task"],
    ),
    _client_tool(
        "record_step",
        "Record a step of the work together with the reason the expert gave for it. "
        "Call silently, as soon as you learn the reason behind a step.",
        {
            "step": _string("What was done, for example 'coded invoice 4471 to a cost center'."),
            "decision": _string("The specific choice made, for example 're-coded from 4711 to 0400'. Empty if none."),
            "reason": _string("Why, in the expert's own words wherever possible."),
            "quote": QUOTE,
            "screen_time": SCREEN_TIME,
            "source": SOURCE,
        },
        ["step", "reason", "screen_time", "source"],
    ),
    _client_tool(
        "record_guardrail",
        "Record a limit, an exception, or a moment to stop and ask someone. Call silently.",
        {
            "rule": _string("The rule, for example 'equipment over 5,000 euros is always capex'."),
            "kind": _string("What sort of guardrail", ["limit", "exception", "stop_and_ask"]),
            "applies_when": _string("The situation it applies to."),
            "ask_whom": _string("Who to stop and ask, if anyone. Empty if nobody."),
            "step": _string("The step it belongs to, in a few words."),
            "quote": QUOTE,
            "screen_time": SCREEN_TIME,
            "source": SOURCE,
        },
        ["rule", "kind", "screen_time", "source"],
    ),
    _client_tool(
        "note_open_question",
        "Keep a question for the debrief: something worth asking that could not be asked yet.",
        {"question": _string("The question, in one sentence."), "screen_time": SCREEN_TIME},
        ["question"],
    ),
    _client_tool(
        "start_debrief",
        "Call when the expert has finished the task. Returns the draft Work Map and the gaps to ask about.",
        {},
        [],
        expects_response=True,
        response_timeout_secs=90,
        pre_tool_speech="force",
    ),
    _client_tool(
        "start_teach_back",
        "Call when you could explain the whole task yourself, right before explaining it back.",
        {},
        [],
    ),
    _client_tool(
        "record_correction",
        "Record a correction the expert made to your teach-back.",
        {"correction": _string("What was wrong and what is right."), "quote": QUOTE},
        ["correction"],
    ),
    _client_tool(
        "confirm_work_map",
        "Call only when the expert has confirmed your teach-back is right. Saves the Work Map.",
        {},
        [],
        expects_response=True,
        response_timeout_secs=90,
    ),
]


TUTOR_NAME = "AI Apprentice Tutor"

TUTOR_PROMPT = """You are a tutor teaching a new hire to do this task the way the expert does it: {{task}}.

Everything you know about the task comes from the expert's confirmed Work Map below: the steps, the decision at each step, the expert's reasons in their own words, and the guardrails (limits, exceptions, moments to stop and ask someone). Teach only what is in it. Never invent rules. When you explain, use the expert's own words ("the expert says: ...").

WORK MAP
{{work_map}}

You speak out loud. One or two short sentences per turn, no lists or markdown. Warm, patient and direct, like a senior colleague sitting next to them. Never lecture.

HOW IT WORKS
The new hire is working a real case on their own screen. Messages starting with [SCREEN mm:ss] are what changed on their screen; never read them out. The pill watching their screen sends you these cues:

[PREDICT step=<id>] They are about to reach a judgment call. Before they act, ask them to predict the decision, in one short question that names what is on their screen ("Before you code this one, which cost center would you pick, and why?"). When they answer, say whether that is what the expert would do and give the expert's reason in their words, then call record_prediction.

[STOP step=<id> guardrail=<id>] They just did something the expert would not, and have not saved it yet. Step in right away, even mid-sentence: one short sentence such as "Wait, the expert would stop here. Why do you think?". Call show_expert_moment for that step so they see the expert's screen. Let them think and answer, then explain with the expert's reason and ask them to fix it. Be kind: catching this now is the point.

[FIXED step=<id>] They corrected it. Confirm in a few words.

[DONE step=<id>] They did a judgment step the way the expert does. Say in one sentence why the expert does it that way, using their words. Skip this if you already explained that step.

[LESSON DONE] The case is finished. Call finish_lesson.

OTHERWISE
- While they work and talk to themselves, call skip_turn and say nothing.
- If they ask you something, answer from the Work Map in one or two sentences, in the expert's words. If the Work Map does not say, tell them to ask the person the expert would ask.
- When they say they are done, call finish_lesson.
- finish_lesson returns what they mastered and what to practice. Tell them in two or three sentences, encouraging and specific, say goodbye, and call end_call. Do not offer more help or ask if there is anything else."""

TUTOR_FIRST_MESSAGE = "Hi, I'll watch while you work this case and step in if the expert would do something differently. Go ahead whenever you're ready."

TUTOR_TOOLS = [
    _client_tool(
        "show_expert_moment",
        "Replay the expert's screen moment for a step on the new hire's screen, so they see how the expert did it.",
        {"step_id": _string("The id of the step in the Work Map, for example s3.")},
        ["step_id"],
    ),
    _client_tool(
        "record_prediction",
        "Record how the new hire did when asked to predict a decision.",
        {
            "step_id": _string("The id of the step in the Work Map."),
            "correct": {"type": "boolean", "description": "True if their prediction matched the expert's decision."},
            "answer": _string("What they predicted, in a few words."),
        },
        ["step_id", "correct"],
    ),
    _client_tool(
        "finish_lesson",
        "Call when the case is done. Returns what the new hire mastered and what to practice next.",
        {},
        [],
        expects_response=True,
        response_timeout_secs=30,
    ),
]


def agent_config(
    tool_ids: List[str],
    *,
    name: str = AGENT_NAME,
    prompt: str = PROMPT,
    first_message: str = FIRST_MESSAGE,
    skip_turn_description: str = "Stay silent this turn. Use after anything the expert says while working, unless it was a direct question to you.",
    dynamic_variables: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    return {
        "name": name,
        "tags": ["ai-apprentice"],
        "conversation_config": {
            # Scribe realtime listens; turn_v3 with patient eagerness waits for the expert to finish.
            "asr": {"provider": "scribe_realtime", "quality": "high"},
            "turn": {
                "mode": "turn",
                "turn_model": "turn_v3",
                "turn_eagerness": "patient",
                # The expert works in silence for minutes: -1 never re-engages them, and they are
                # never hung up on. Pauses come from the pill instead ([PAUSE]).
                "turn_timeout": -1,
                "silence_end_call_timeout": -1,
                "soft_timeout_config": {"timeout_seconds": -1},
            },
            "tts": {
                "model_id": os.getenv("APPRENTICE_TTS_MODEL", "eleven_v3_conversational"),
                "voice_id": os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9"),
                "expressive_mode": True,
                "stability": 0.5,
                "speed": 1.0,
            },
            "conversation": {
                "max_duration_seconds": 1800,
                "client_events": [
                    "audio",
                    "interruption",
                    "user_transcript",
                    "tentative_user_transcript",
                    "agent_response",
                    "agent_response_correction",
                    "client_tool_call",
                    "vad_score",
                ],
            },
            "agent": {
                "first_message": first_message,
                "language": "en",
                "dynamic_variables": {"dynamic_variable_placeholders": dynamic_variables or {}},
                "prompt": {
                    "prompt": prompt,
                    "llm": os.getenv("APPRENTICE_LLM", "gpt-4.1"),
                    "temperature": 0.3,
                    "tool_ids": tool_ids,
                    "built_in_tools": {
                        "skip_turn": {
                            "type": "system",
                            "name": "skip_turn",
                            "description": skip_turn_description,
                            "params": {"system_tool_type": "skip_turn", "wait_timeout_secs": -1},
                        },
                        "end_call": {
                            "type": "system",
                            "name": "end_call",
                            "description": "",
                            "params": {"system_tool_type": "end_call"},
                        },
                    },
                },
            },
        },
    }


class ElevenLabsError(Exception):
    pass


def _api_key() -> str:
    key = os.getenv("ELEVENLABS_API_KEY", "")
    if not key:
        raise ElevenLabsError("ELEVENLABS_API_KEY is not set")
    return key


def _call(path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    request = urllib.request.Request(
        API + path,
        method=method,
        headers={"xi-api-key": _api_key(), "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise ElevenLabsError(f"{method} {path} failed with {e.code}: {e.read()[:800].decode()}") from e
    except urllib.error.URLError as e:
        raise ElevenLabsError(f"{method} {path} failed: {e.reason}") from e


ROLES = {"apprentice": AGENT_NAME, "tutor": TUTOR_NAME}
_agent_ids: Dict[str, str] = {}


def find_agent_id(role: str = "apprentice") -> Optional[str]:
    """The id of the workspace agent for a role (apprentice or tutor), looked up by name."""
    if role in _agent_ids:
        return _agent_ids[role]
    name = ROLES[role]
    agents = _call(f"/v1/convai/agents?page_size=100&search={urllib.request.quote(name)}")
    match = next((a for a in agents.get("agents", []) if a.get("name") == name), None)
    if match:
        _agent_ids[role] = match["agent_id"]
    return _agent_ids.get(role)


def conversation_token(role: str = "apprentice") -> Dict[str, str]:
    """A short-lived WebRTC token so the pill can talk to an agent without holding the API key."""
    agent_id = find_agent_id(role)
    if not agent_id:
        raise ElevenLabsError(
            f"No {ROLES[role]} agent found. Run `uv run python -m src.services.apprentice_agent`."
        )
    token = _call(f"/v1/convai/conversation/token?agent_id={agent_id}")["token"]
    return {"token": token, "agent_id": agent_id}


def _sync_tools(tools: List[Dict[str, Any]], existing: Dict[str, str]) -> List[str]:
    tool_ids = []
    for tool in tools:
        if tool["name"] in existing:
            tool_id = existing[tool["name"]]
            _call(f"/v1/convai/tools/{tool_id}", "PATCH", {"tool_config": tool})
            logger.info(f"Updated tool {tool['name']} ({tool_id})")
        else:
            tool_id = _call("/v1/convai/tools", "POST", {"tool_config": tool})["id"]
            logger.info(f"Created tool {tool['name']} ({tool_id})")
        tool_ids.append(tool_id)
    return tool_ids


def _sync_agent(role: str, config: Dict[str, Any]) -> str:
    agent_id = find_agent_id(role)
    if agent_id:
        _call(f"/v1/convai/agents/{agent_id}", "PATCH", config)
        logger.info(f"Updated agent {config['name']} ({agent_id})")
    else:
        agent_id = _call("/v1/convai/agents/create", "POST", config)["agent_id"]
        _agent_ids[role] = agent_id
        logger.info(f"Created agent {config['name']} ({agent_id})")
    return agent_id


def sync() -> Dict[str, str]:
    """Create or update both agents and their client tools so they match this file."""
    existing = {
        t.get("tool_config", {}).get("name"): t["id"]
        for t in _call("/v1/convai/tools").get("tools", [])
    }
    apprentice = _sync_agent("apprentice", agent_config(_sync_tools(CLIENT_TOOLS, existing)))
    tutor = _sync_agent(
        "tutor",
        agent_config(
            _sync_tools(TUTOR_TOOLS, existing),
            name=TUTOR_NAME,
            prompt=TUTOR_PROMPT,
            first_message=TUTOR_FIRST_MESSAGE,
            skip_turn_description="Stay silent this turn. Use while the new hire works or thinks aloud, unless they asked you something or a cue asks you to speak.",
            dynamic_variables={"task": "the task", "work_map": "(no Work Map loaded)"},
        ),
    )
    return {"apprentice": apprentice, "tutor": tutor}


if __name__ == "__main__":
    from src.core.config import Config  # noqa: F401  (loads .env.development)

    print(sync())
