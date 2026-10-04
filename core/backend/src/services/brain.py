"""What the apprentice already knows, carried from one session into the next.

Without this every session starts from zero: the apprentice re-asks what an
expert already told it last week, and the open questions it wrote down are
saved and never read again. The brain closes that loop.

It is read twice in a session and written once:

  connect        index()        the tasks it has learned before, as a dynamic
                                variable, so its first question can be smarter
  begin_observation
                 known(task)    everything it knows about *this* task, handed
                                back through the tool call that names the task
  merge (final)  prior(task)    what it knew going in, so the Work Map it
                                writes reconciles with it instead of replacing it

Memory is the confirmed Work Maps themselves: knowledge an expert has heard
read back to them and agreed with. Drafts and abandoned sessions never become
something the apprentice believes.

At this size the brain is a prompt, not a retrieval system. A workspace holds
tens of Work Maps and each is a few hundred words, so the matching ones fit in
context with room to spare; embeddings would be the right answer at a thousand
Work Maps, not at twenty.
"""

import re
from typing import Any, Dict, List, Optional

from src.utils.logger import logger
from storage import work_maps as work_map_store

# How many confirmed Work Maps the brain holds at once.
RECALL_LIMIT = 50
# Share of words two task names must have in common to count as the same work.
MATCH_RATIO = 0.4
# Nothing matched well enough to say "you told me this before".
NO_MATCH = ""

_STOP = {
    "a", "an", "and", "the", "to", "for", "of", "in", "on", "at", "my", "our",
    "this", "that", "with", "some", "doing", "do", "work", "working", "task",
}


def _stem(word: str) -> str:
    """Crude suffix stripping, so "downloading PDFs" matches "download a PDF".

    An expert names the same task differently every time; exact words would
    make the apprentice forget a task it watched last week.
    """
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 4:
            return word[: -len(suffix)]
    return word


def _words(task: Optional[str]) -> set:
    """The meaningful words of a task name, for comparing one task with another."""
    found = re.findall(r"[a-z0-9]+", (task or "").lower())
    return {_stem(w) for w in found if w not in _STOP and len(w) > 2}


def _overlap(a: set, b: set) -> float:
    """How much two task names have in common, 0 to 1, against the shorter one."""
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


def _matching(task: Optional[str], maps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The confirmed Work Maps that are about the same work as `task`, best first."""
    wanted = _words(task)
    if not wanted:
        return []
    scored = [(_overlap(wanted, _words(m.get("task"))), m) for m in maps]
    return [m for score, m in sorted(scored, key=lambda p: -p[0]) if score >= MATCH_RATIO]


def _confirmed(limit: int = RECALL_LIMIT) -> List[Dict[str, Any]]:
    """Confirmed Work Maps, or nothing at all if the store cannot be reached.

    A session must still run when the brain is empty or the database is down:
    an apprentice with no memory is the old behaviour, not a broken one.
    """
    try:
        return work_map_store.confirmed_maps(limit)
    except Exception as e:
        logger.error(f"Brain couldn't read what it knows: {e}")
        return []


def index() -> str:
    """The tasks the apprentice has already learned, for the {{known}} variable."""
    maps = _confirmed()
    if not maps:
        return "You have not learned any task yet. This is your first session."
    lines = []
    for m in maps[:12]:
        task = (m.get("task") or "an unnamed task").strip()
        steps = len(m.get("steps") or [])
        guards = len(m.get("guardrails") or [])
        lines.append(f"- {task} ({steps} steps, {guards} guardrails)")
    return "You have already learned these tasks from an expert:\n" + "\n".join(lines)


def known(task: Optional[str]) -> str:
    """Everything the apprentice knows about this task, or "" if it is new work.

    Handed back through begin_observation, so it arrives exactly when the task
    is named rather than being carried through the whole session.
    """
    matches = _matching(task, _confirmed())
    if not matches:
        return NO_MATCH

    steps: List[str] = []
    guards: List[str] = []
    open_questions: List[str] = []
    for m in matches[:3]:
        for s in m.get("steps") or []:
            title = s.get("title") or s.get("step") or ""
            if not title:
                continue
            line = f"- {title}"
            if s.get("reason"):
                line += f" — because {s['reason']}"
            steps.append(line)
        for g in m.get("guardrails") or []:
            rule = g.get("rule") or ""
            if not rule:
                continue
            line = f"- {rule}"
            if g.get("applies_when"):
                line += f" (when {g['applies_when']})"
            if g.get("ask_whom"):
                line += f" — ask {g['ask_whom']}"
            guards.append(line)
        open_questions.extend(q for q in m.get("open_questions") or [] if q)

    when = matches[0].get("recorded_at") or ""
    parts = [
        f"[KNOWN] You have watched this task before{f' ({when[:10]})' if when else ''}. "
        "Treat all of it as already learned: do NOT ask about any of it again."
    ]
    if steps:
        parts.append("Steps you already know:\n" + "\n".join(_unique(steps)[:12]))
    if guards:
        parts.append("Guardrails you already know:\n" + "\n".join(_unique(guards)[:10]))
    if open_questions:
        parts.append(
            "Still unanswered from last time. These are your best questions today:\n"
            + "\n".join(f"- {q}" for q in _unique(open_questions)[:6])
        )
    parts.append(
        "Spend this session on what is new: anything the expert does differently from the above "
        "(say so and ask why), any step you have not seen before, and the unanswered questions."
    )
    return "\n\n".join(parts)


def _unique(lines: List[str]) -> List[str]:
    """Keep order, drop repeats: several sessions on one task say the same things."""
    seen = set()
    out = []
    for line in lines:
        key = re.sub(r"[^a-z0-9]+", " ", line.lower()).strip()
        if key not in seen:
            seen.add(key)
            out.append(line)
    return out


def prior(task: Optional[str]) -> Optional[Dict[str, Any]]:
    """What was known before this session, for the final merge to reconcile against."""
    matches = _matching(task, _confirmed())
    if not matches:
        return None
    steps: List[str] = []
    guards: List[str] = []
    questions: List[str] = []
    for m in matches[:3]:
        steps.extend(s.get("title") or s.get("step") or "" for s in m.get("steps") or [])
        guards.extend(g.get("rule") or "" for g in m.get("guardrails") or [])
        questions.extend(m.get("open_questions") or [])
    return {
        "steps": _unique([s for s in steps if s])[:15],
        "guardrails": _unique([g for g in guards if g])[:12],
        "open_questions": _unique([q for q in questions if q])[:8],
    }
