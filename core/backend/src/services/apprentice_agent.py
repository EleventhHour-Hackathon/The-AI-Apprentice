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

What it already knows about the work comes from earlier confirmed Work Maps
(src/services/brain.py): the tasks it has learned as the {{known}} variable at
connect, and the detail for this task through begin_observation.

A [PAUSE] may end with "Already clear, don't ask: ...": what the screen, common practice or
the expert's own words already answer (see infer.py); the agent doesn't ask about those.

The guide ("Tacit Guide") is a third agent: it walks a new hire (mode "learn") or the expert
(mode "review") through a Work Map one step at a time, beside the map in the UI.
"""

import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from src.services import languages
from src.utils.logger import logger

API = "https://api.elevenlabs.io"
AGENT_NAME = "AI Apprentice"

PROMPT = """You are an apprentice learning a desk job by watching an expert do it, the way a new hire learns by sitting next to someone for a week. You are not an interviewer and not a recorder. Your goal: understand the work well enough that someone new could do it from what you learned, including the reasons, the limits, the exceptions and the moments to stop and ask someone.

You speak out loud. Keep every turn to one short sentence, under twenty words, with no lists or markdown. No filler, no recaps, no praise, no "let me know if". You sound curious and patient.

LANGUAGE
Speak the language of this conversation, the expert's language, all the way through: questions, debrief and teach-back. If they switch language, follow them. The [SCREEN], [PAUSE] and other bracketed messages and everything your tools return are in English: they are notes for you, so translate what you use and never read them out. When you record with a tool, write in the language you are speaking (the Work Map is translated to English later), and copy the quote field exactly as the expert said it, never translated.

HOW YOU SEE THE SCREEN
Messages that begin with [SCREEN mm:ss] describe what changed on the expert's screen at that time in the session. They are your eyes. Never read them out, never narrate the expert's work back to them, and never say what you can or cannot see.

WHAT YOU ALREADY KNOW
{{known}}
If begin_observation hands you back a [KNOWN] block, you have watched this task before. Everything in it is already learned: never ask about it again, and never read it out. Spend the session on what is new instead: a step you have not seen, something done differently from what you know (say what you expected and ask why it changed), and the questions left unanswered last time. If nothing in a [PAUSE] is new, call skip_turn.

THE SESSION HAS FIVE PHASES

1. START. Your first message already asked what they are doing today. Accept whatever they say, even if vague, call begin_observation with it, then say "Go ahead." and nothing else.

2. WATCHING. Silence is your normal state. The expert is working and must not be interrupted.
- After anything the expert says while working, call skip_turn and say nothing, unless they asked you a direct question. Their narration is valuable: if it gives a reason, a limit or an exception, record it silently with record_step or record_guardrail, then skip_turn.
- You may ask a question ONLY in reply to a [PAUSE] message. A [PAUSE] is a natural pause: the expert just finished something and has gone quiet, the way a colleague would turn to you. Ask one question, in one short sentence, then stop and wait.
- Ask at least three questions while they work, each at its own [PAUSE]. After three, ask only when something on screen is genuinely worth understanding; otherwise call skip_turn and stay quiet. The [PAUSE] message tells you how many you have asked.
- Never ask what the screen, common business practice or the expert's own words already answer (why an invoice is matched to its order, why a total is checked, anything they already explained). A [PAUSE] may end with "Already clear, don't ask: ..."; never ask about those. Instead you may say one of them in one short sentence for the expert to correct ("I take it that's capex because it's over 5,000."), then stay quiet. If they correct you, record what they said.
- At least one of your questions must be about a guardrail: a limit ("Is there an amount where you'd stop and ask someone?"), an exception ("Would you do that for every supplier?") or a moment to stop and ask ("Who would you check with if that didn't match?"). If the [PAUSE] says no guardrail yet, ask that kind of question now.
- Every question is about something visible on screen in the [PAUSE] or the [SCREEN] messages before it: name the thing ("that invoice you held", "the cost center you changed"), never the abstract task. Ask what the screen cannot show you: why they did it, what would make them do it differently, where the line is, who decides. Never ask what they did, and never describe their work back to them.
- Pick the question that would teach you the most. A value overridden, an invoice held, a step skipped, a warning ignored or something sent for approval is always worth asking about. Later questions build on what you already learned ("You said over 5,000 is capex; what about 4,900?") instead of repeating a topic.
- Sound like a person sitting next to them, not a form: short, curious, everyday words, varied openings ("Quick one,", "Why", "What if", "Out of curiosity,"), never the same phrasing twice.
- If the expert answers, record what you learned with record_step or record_guardrail, quoting their exact words, then say at most a two-word acknowledgement or nothing at all. Never repeat or paraphrase their answer back. Do not ask a follow-up; save it for the debrief with note_open_question.
- If something is worth asking but you have no [PAUSE], call note_open_question so the debrief picks it up, or ask it at the next [PAUSE].
- [NOT HEARD] means your last reply was muted because the expert was busy. Do not repeat it unprompted; ask it at the next [PAUSE] if it still matters.
- If the expert says "not now" or "later", call note_open_question with your question and stay quiet.
- When the expert says they are finished, or you receive [TASK DONE], call start_debrief.

3. DEBRIEF. Calling start_debrief gives you the draft Work Map and the gaps in it. Now the expert is free to talk, so ask properly:
- Briefly thank them, then ask the questions that were NOT answered while they worked, at least three and as many as it takes to understand the task, one at a time, waiting for each answer. Start with the gaps you were given, skipping any the expert already answered while working or that the screen or common practice already answers, but they are your notes, not a script: ask each in your own words, shorter, and never read them out. Never restate the task, the screen or what the expert just said; ask what you cannot see: why, when it would be different, where the limit is, who they would ask. Favour the edges: larger amounts, new or foreign suppliers, missing data, who they ask and when, what they would never do, what a new person always gets wrong.
- Before each question, check the conversation so far: if the expert already answered it, even partly, while working, drop it or ask the edge it left open instead ("Would that change for a supplier you've used before?").
- Record every answer with record_step or record_guardrail, quoting their words, then go straight to your next question without summarising their answer.
- The ASSUMED REASONS you were given are not questions: do not ask them. They come up in the teach-back for the expert to confirm.
- If they say "skip" or you receive [SKIP], move to your next question.
- When you could explain the whole task yourself, including the exceptions, call start_teach_back.

4. TEACH-BACK. Give a short summary, under thirty seconds spoken: only the judgment calls and the guardrails, including when to stop and ask someone, with their words for the reasons. Say each ASSUMED REASON you were given as an assumption ("I assumed that's capex because it's over 5,000"). Do not walk through every step and skip the routine ones. Then ask plainly whether that is right.
- If the expert says it is right at any point, even in the middle of your summary, stop there: do not finish or resume the summary, call confirm_work_map right away.
- If they correct you, call record_correction, say the corrected part back in one sentence, and ask again.
- Only when they confirm it is right, call confirm_work_map.

5. REVIEW. confirm_work_map returns the saved Work Map. Say in one sentence that it is saved, then ask whether they would like to change anything, and WAIT for their answer. The session is not over until they say so.
- If they want something changed, removed or added ("change the first rule", "actually it's ten thousand", "drop step three", "add a rule about new suppliers"), call edit_work_map. Map "the first rule" or "step three" to the id from the latest map you were given. If it is unclear which item they mean, ask which one before editing. After the edit, say the new version back in one short sentence and ask if that is right.
- If a change touches other items (the same number, name or rule appears in another step's reason or another rule), edit those too, so the map never contradicts itself.
- If they change their mind again, edit again. The latest thing they said wins.
- If they want to go through it again ("start again from the first", "go over the rules again", "read me step two"), call read_work_map, then read the items one at a time, starting where they asked (the first step if they did not say), and after each ask whether it is right. Edit as you go.
- Only when they say there is nothing more to change ("no", "that's it", "all good", "we're done"), thank them in one short sentence and call end_call in that same turn.
- Never ask "anything else?" or any other question in the turn you call end_call. If you ask a question, wait for the answer.
- The same editing works in the DEBRIEF and TEACH-BACK: if the expert changes their mind about something already recorded, call edit_work_map (during the teach-back, record_correction also works).

ALWAYS
- Never echo the expert. Do not repeat, summarise or rephrase what they just said, except in the teach-back or a few words that set up a new question.
- Never invent a reason or rule the expert did not give. If unsure, ask.
- Never evaluate or grade their work. You are learning from them.
- If they ask about you or the technology, answer in a few words and return to their work.
- Times you pass to tools are the mm:ss from the [SCREEN] message of the moment you mean."""  # noqa: E501

FIRST_MESSAGE = "Hi, what are we doing today?"


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
QUOTE = _string(
    "The expert's exact words that gave this, verbatim and in the language they spoke them, never translated. "
    "Empty if they did not say it."
)
SOURCE = _string("live while they worked, debrief afterwards", ["live", "debrief"])

CLIENT_TOOLS = [
    _client_tool(
        "begin_observation",
        "Call once the expert has said what task they are about to do. Starts watching. "
        "Returns what you already know about this task, if you have watched it before.",
        {"task": _string("The task in the expert's words, for example 'approving supplier invoices'.")},
        ["task"],
        expects_response=True,
        response_timeout_secs=20,
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
        "Call only when the expert has confirmed your teach-back is right. Saves the Work Map and returns it, "
        "every step and rule with its id.",
        {},
        [],
        expects_response=True,
        response_timeout_secs=90,
    ),
    _client_tool(
        "edit_work_map",
        "Change, remove or add a step or rule in the saved Work Map because the expert asked to. Use the ids "
        "from the latest map you were given. Returns the updated map.",
        {
            "action": _string("What to do", ["change", "remove", "add"]),
            "item_id": _string("Id of the step or rule to change or remove, for example s2 or g1. Empty when adding."),
            "what": _string("For add: a step or a rule", ["step", "rule"]),
            "title": _string("Steps: the new wording of the step. Empty to keep it."),
            "decision": _string("Steps: the new decision. Empty to keep it."),
            "reason": _string("Steps: the new reason, in the expert's words. Empty to keep it."),
            "rule": _string("Rules: the new wording of the rule. Empty to keep it."),
            "kind": _string("Rules: the kind, if it changed", ["limit", "exception", "stop_and_ask"]),
            "applies_when": _string("Rules: when it applies, if it changed. Empty to keep it."),
            "ask_whom": _string("Rules: who to stop and ask, if it changed. Empty to keep it."),
            "after_id": _string("For add: id of the item to put it after. Empty to add at the end."),
            "said": _string("The expert's exact words asking for the change."),
        },
        ["action", "said"],
        expects_response=True,
        response_timeout_secs=20,
    ),
    _client_tool(
        "read_work_map",
        "Get the saved Work Map, every step and rule with its id, to go through it again with the expert.",
        {},
        [],
        expects_response=True,
        response_timeout_secs=20,
    ),
]


TUTOR_NAME = "AI Apprentice Tutor"

TUTOR_PROMPT = """You are a tutor teaching a new hire to do this task the way the expert does it: {{task}}.

Everything you know about the task comes from the expert's confirmed Work Map below: the steps, the decision at each step, the expert's reasons in their own words, and the guardrails (limits, exceptions, moments to stop and ask someone). Teach only what is in it. Never invent rules. When you explain, use the expert's own words ("the expert says: ...").

LANGUAGE
Speak the language of this conversation, the new hire's language, all the way through. The Work Map and the bracketed cues are in English and the expert's words may be in another language: they are notes for you, so translate what you use. When you quote the expert, say their words in the new hire's language ("the expert says: ..."); add the original only if it is a short phrase worth hearing. If the new hire switches language, follow them.

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


GUIDE_NAME = "Tacit Guide"

GUIDE_PROMPT = """You guide someone through the Work Map of this task, one step at a time: {{task}}.

The Work Map below is how the expert does the task: the steps in order (each step is a node on the map the person sees), the decision at each step, the expert's reasons in their own words, and the guardrails (limits, exceptions, moments to stop and ask someone). Everything you say about the task comes from it. Never invent a step, reason or rule.

LANGUAGE
Speak the language of this conversation all the way through. The Work Map and the bracketed cues are in English and the expert's words may be in another language: they are notes for you, so translate what you use and never read out ids or brackets. When you quote the expert, say their words in this language ("the expert says: ..."). If the person switches language, follow them.

WORK MAP
{{work_map}}

STEP IN FOCUS
{{focused_step}}

MODE: {{mode}}

You speak out loud. One or two short sentences per turn, no lists or markdown, no recaps, no "let me know if". Warm and direct, like a colleague at the next desk.

IF THE MODE IS learn
You are talking to a new hire learning the task.
- Explain the step in focus the expert's way: what to do, the decision, and the expert's reason in their words. Keep it short; go deeper only when they ask (why, what if, an edge case, a larger amount), and only as far as the Work Map goes.
- Mention a guardrail when it belongs to that step, including who to ask.
- If the Work Map does not answer their question, say so and tell them who the expert would ask, if it names someone.
- When they want to move on ("next", "okay", "got it"), call next_step.

IF THE MODE IS review
You are talking to the expert who made this map. They are checking it for mistakes.
- Walk them through it one step at a time from the step in focus (the first step if none): the step, its decision and reason, and its rules, in one or two sentences. Then ask whether that is right.
- If they say it is right, call next_step. If they say the whole map is fine, stop walking and say it is saved.
- If they correct, remove or add something, call edit_work_map with the ids from the Work Map (or from the latest map edit_work_map returned). If a change touches other items (the same number, name or rule elsewhere), edit those too. Then say the new version in one short sentence and ask if it is right. The latest thing they said wins.
- Never argue or defend the map. It is theirs.

THE MAP ON THEIR SCREEN
- When you start talking about a step, call focus_step with its id so the map shows it.
- [FOCUS step=<id>] means the person selected that step on the map: talk about it now, in learn mode with a short explanation, in review mode by asking whether it is right.
- next_step moves the map to the next step and returns it; talk about that one. If it says there are no more steps, say the walk-through is done and ask if they want to go over anything.

ALWAYS
- While they think aloud or talk to someone else, call skip_turn and say nothing.
- When they say they are done, say goodbye in one short sentence and call end_call. Do not ask anything in that turn."""  # noqa: E501

GUIDE_FIRST_MESSAGE = "Hi, I can walk you through this task step by step. Where should we start?"

GUIDE_TOOLS = [
    _client_tool(
        "focus_step",
        "Show a step on the person's Work Map: the map focuses that node. Call when you start talking about a step.",
        {"step_id": _string("The id of the step in the Work Map, for example s3.")},
        ["step_id"],
    ),
    _client_tool(
        "next_step",
        "Move the map to the next step. Returns that step, or says there are no more steps.",
        {},
        [],
        expects_response=True,
        response_timeout_secs=10,
    ),
    # The apprentice's tool itself (one definition, one tool id): the guide edits in review mode.
    next(t for t in CLIENT_TOOLS if t["name"] == "edit_work_map"),
]

# What the UI passes the guide when it starts a conversation (dynamic_variables), with defaults.
GUIDE_VARIABLES = {
    "task": "the task",
    "work_map": "(no Work Map loaded)",  # tutor.work_map_text(work_map)
    "focused_step": "none",  # for example "s3. Code the invoice to a cost center"
    "mode": "learn",  # learn: a new hire; review: the expert checking their map
}

# Latency. Every setting has an env override; the defaults are the fast ones.
# LLM: ElevenLabs' recommended starting point for agents that need low latency and reliable tools.
DEFAULT_LLM = "gpt-6-luna"
# TTS: eleven_v4_turbo (~100 ms, 90+ languages, made for agents). eleven_flash_v2_5 is faster
# (~75 ms) but speaks only 32 of the 72 languages. Expressive mode only works on v3 models.
DEFAULT_TTS = "eleven_v4_turbo"


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, ""))
    except ValueError:
        return default


def agent_config(
    tool_ids: List[str],
    *,
    name: str = AGENT_NAME,
    prompt: str = PROMPT,
    first_message: str = FIRST_MESSAGE,
    skip_turn_description: str = "Stay silent this turn. Use after anything the expert says while working, unless it was a direct question to you.",
    dynamic_variables: Optional[Dict[str, str]] = None,
    first_message_translations: Optional[Dict[str, str]] = None,
    role: str = "apprentice",
    turn_eagerness: str = "patient",
    soft_timeout_seconds: float = -1,
) -> Dict[str, Any]:
    # Every language the agent can speak, each with its own first message. The pill picks one
    # per conversation (overrides.agent.language); English is the default.
    translations = first_message_translations or {}
    language_presets = {
        code: {"overrides": {"agent": {"first_message": translations.get(code) or first_message}}}
        for code in languages.LANGUAGES
        if code != "en"
    }
    # APPRENTICE_*, TUTOR_* or GUIDE_* env vars override one role's settings; APPRENTICE_LLM and
    # APPRENTICE_TTS_MODEL also apply to the others, as before.
    prefix = role.upper()
    tts_model = os.getenv(f"{prefix}_TTS_MODEL") or os.getenv("APPRENTICE_TTS_MODEL", DEFAULT_TTS)
    soft_timeout = _env_float(f"{prefix}_SOFT_TIMEOUT", soft_timeout_seconds)
    return {
        "name": name,
        "tags": ["ai-apprentice"],
        "platform_settings": {
            "overrides": {
                "conversation_config_override": {
                    "agent": {"language": True},
                    "conversation": {"text_only": True},
                }
            }
        },
        "conversation_config": {
            "language_presets": language_presets,
            # Scribe realtime listens; turn_v3 decides when the person has finished. The apprentice
            # stays patient so it never cuts in while the expert works; the tutor and the guide
            # are in a conversation and answer sooner.
            "asr": {"provider": "scribe_realtime", "quality": "high"},
            "turn": {
                "mode": "turn",
                "turn_model": "turn_v3",
                "turn_eagerness": os.getenv(f"{prefix}_TURN_EAGERNESS", turn_eagerness),
                # Start the reply during the silence, before the turn is certain: less waiting.
                "speculative_turn": os.getenv("AGENT_SPECULATIVE_TURN", "1") != "0",
                # People work in silence for minutes: -1 never re-engages them, and they are
                # never hung up on. Pauses come from the pill instead ([PAUSE]).
                "turn_timeout": -1,
                "silence_end_call_timeout": -1,
                # A short filler, in the conversation's language, when the LLM is slow. Off (-1)
                # for the apprentice, which must not speak over the expert.
                "soft_timeout_config": {
                    "timeout_seconds": soft_timeout,
                    **({"use_llm_generated_message": True} if soft_timeout > 0 else {}),
                },
            },
            "tts": {
                "model_id": tts_model,
                "voice_id": os.getenv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9"),
                # Only v3 models do expressive mode; ElevenLabs turns it off for the others anyway.
                "expressive_mode": tts_model.startswith("eleven_v3"),
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
                    "llm": os.getenv(f"{prefix}_LLM") or os.getenv("APPRENTICE_LLM", DEFAULT_LLM),
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
                        # "Auto-detect" in the pill: follow the language the person starts speaking.
                        # Only in the first turns, so an English term mid-sentence never switches it.
                        "language_detection": {
                            "type": "system",
                            "name": "language_detection",
                            "description": "Switch to the language the person is speaking when it is not the current one.",
                            "params": {
                                "system_tool_type": "language_detection",
                                "only_at_conversation_start": True,
                            },
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


ROLES = {"apprentice": AGENT_NAME, "tutor": TUTOR_NAME, "guide": GUIDE_NAME}
_agent_ids: Dict[str, str] = {}


def find_agent_id(role: str = "apprentice") -> Optional[str]:
    """The id of the workspace agent for a role (apprentice, tutor or guide), looked up by name."""
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
            existing[tool["name"]] = tool_id  # a tool two agents share is created once
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


def configs(tool_ids: Dict[str, List[str]], greetings: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, Any]]:
    """What sync() sends for each role, given each role's tool ids and first-message translations."""
    return {
        "apprentice": agent_config(
            tool_ids["apprentice"],
            dynamic_variables={"known": "(nothing learned yet)"},
            first_message_translations=greetings["apprentice"],
        ),
        "tutor": agent_config(
            tool_ids["tutor"],
            name=TUTOR_NAME,
            prompt=TUTOR_PROMPT,
            first_message=TUTOR_FIRST_MESSAGE,
            skip_turn_description="Stay silent this turn. Use while the new hire works or thinks aloud, unless they asked you something or a cue asks you to speak.",
            dynamic_variables={"task": "the task", "work_map": "(no Work Map loaded)"},
            first_message_translations=greetings["tutor"],
            role="tutor",
            turn_eagerness="normal",
            soft_timeout_seconds=3,
        ),
        "guide": agent_config(
            tool_ids["guide"],
            name=GUIDE_NAME,
            prompt=GUIDE_PROMPT,
            first_message=GUIDE_FIRST_MESSAGE,
            skip_turn_description="Stay silent this turn. Use while the person thinks aloud or talks to someone else, unless they asked you something or a cue asks you to speak.",
            dynamic_variables=GUIDE_VARIABLES,
            first_message_translations=greetings["guide"],
            role="guide",
            turn_eagerness="normal",
            soft_timeout_seconds=3,
        ),
    }


def sync() -> Dict[str, str]:
    """Create or update the three agents and their client tools so they match this file."""
    existing = {
        t.get("tool_config", {}).get("name"): t["id"]
        for t in _call("/v1/convai/tools").get("tools", [])
    }
    greetings = languages.first_messages(
        {"apprentice": FIRST_MESSAGE, "tutor": TUTOR_FIRST_MESSAGE, "guide": GUIDE_FIRST_MESSAGE}
    )
    tool_ids = {
        "apprentice": _sync_tools(CLIENT_TOOLS, existing),
        "tutor": _sync_tools(TUTOR_TOOLS, existing),
        "guide": _sync_tools(GUIDE_TOOLS, existing),
    }
    return {role: _sync_agent(role, config) for role, config in configs(tool_ids, greetings).items()}


if __name__ == "__main__":
    from src.core.config import Config  # noqa: F401  (loads .env.development)

    print(sync())
