from typing import Any, Dict, Optional

from pipecat_flows import FlowArgs, FlowManager

from src.utils.logger import logger


# --------------------------------------------------------------------------
# AI Apprentice
#
# These build the Work Map while the expert works: the steps they took, the
# judgment behind each one and the guardrails around it. Everything is kept
# on flow_manager.state so the debrief and the teach-back can read back what
# was actually captured rather than re-deriving it from the transcript.
# --------------------------------------------------------------------------


def _work_map(flow_manager: FlowManager) -> Dict[str, Any]:
    """Return the Work Map being assembled for this session."""
    return flow_manager.state.setdefault(
        "work_map", {"task": None, "steps": [], "guardrails": [], "open_questions": []}
    )


async def begin_observation(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Record which task the expert is about to walk through."""
    task = args["task"]
    _work_map(flow_manager)["task"] = task
    logger.info(f"Apprentice observing task: {task}")
    return {"task": task}


async def record_step(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Record a step together with the reason the expert gave for it."""
    step = {
        "step": args["step"],
        "decision": args.get("decision", ""),
        "reason": args["reason"],
        "screen_moment": args.get("screen_moment", ""),
    }
    _work_map(flow_manager)["steps"].append(step)
    logger.info(f"Work Map step {len(_work_map(flow_manager)['steps'])}: {step['step']}")
    return step


async def record_guardrail(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Record a limit, an exception, or a moment to stop and ask someone."""
    guardrail = {
        "rule": args["rule"],
        "applies_when": args.get("applies_when", ""),
        "stop_and_ask": args.get("stop_and_ask", ""),
    }
    _work_map(flow_manager)["guardrails"].append(guardrail)
    logger.info(f"Work Map guardrail: {guardrail['rule']}")
    return guardrail


async def note_open_question(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Park something that is still unclear so the debrief can close it."""
    question = args["question"]
    _work_map(flow_manager)["open_questions"].append(question)
    logger.info(f"Apprentice unsure about: {question}")
    return {"question": question}


async def start_debrief(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Close out observation and hand the open questions to the debrief."""
    work_map = _work_map(flow_manager)
    logger.info(
        f"Debrief starting with {len(work_map['steps'])} steps, "
        f"{len(work_map['guardrails'])} guardrails, "
        f"{len(work_map['open_questions'])} open questions"
    )
    return {
        "steps": work_map["steps"],
        "guardrails": work_map["guardrails"],
        "open_questions": work_map["open_questions"],
    }


async def record_correction(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Apply a correction the expert made during the teach-back."""
    correction = args["correction"]
    _work_map(flow_manager).setdefault("corrections", []).append(correction)
    logger.info(f"Expert corrected the teach-back: {correction}")
    return {"correction": correction}


async def confirm_work_map(
    args: FlowArgs, flow_manager: FlowManager, result: Optional[Any] = None
) -> Dict[str, Any]:
    """Mark the Work Map as confirmed by the expert."""
    work_map = _work_map(flow_manager)
    work_map["confirmed"] = True
    logger.info(
        f"Work Map confirmed: {len(work_map['steps'])} steps, "
        f"{len(work_map['guardrails'])} guardrails"
    )
    return work_map
