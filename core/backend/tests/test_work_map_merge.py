import pytest

from src.services import work_map_merge

EVENTS = [
    {"t": 10, "event": "opened invoice 4471"},
    {"t": 60, "event": "asset number field filled"},
    {"t": 192, "event": "cost center changed from 4711 to 0400"},
]
TRANSCRIPT = [
    {
        "t": 12,
        "role": "expert",
        "text": "First I always check the asset number on these.",
        "phase": "live",
    },
    {"t": 14, "role": "apprentice", "text": "Why the asset number?"},
    {
        "t": 20,
        "role": "expert",
        "text": "Old assets are retired, so they can't be booked.",
        "phase": "live",
    },
]


def step(id, title, at, quote="", decision="", reason=""):
    return {
        "id": id,
        "title": title,
        "at": at,
        "start": at,
        "end": at,
        "screen": "",
        "decision": decision,
        "reason": reason,
        "quote": quote,
        "judgment": bool(decision),
    }


def guardrail(id, rule, at="", quote="", step_id=""):
    return {
        "id": id,
        "step": step_id,
        "kind": "limit",
        "rule": rule,
        "applies_when": "",
        "ask_whom": "",
        "quote": quote,
        "at": at,
    }


LINKED_STEP = step(
    "s1",
    "Check the asset number",
    "00:10",
    quote="Old assets are retired, so they can't be booked",
    reason="Retired assets can't be booked",
)
# The LLM gave no usable time and nothing the expert said backs it up.
UNLINKED_STEP = step(
    "s2", "Code the invoice", "", decision="Changed the cost center from 4711 to 0400"
)
UNLINKED_GUARD = guardrail("g1", "Ask the controller above 5,000 euros", quote="I made this up")
GAP_STEP = "Why 'Changed the cost center from 4711 to 0400'?"
GAP_GUARD = "When does 'Ask the controller above 5,000 euros' apply, in your words?"


def llm_map(steps, guardrails, questions):
    return {
        "task": "Invoice coding",
        "steps": steps,
        "guardrails": guardrails,
        "open_questions": questions,
    }


async def run_merge(final):
    return await work_map_merge.merge(
        task="Invoice coding", events=EVENTS, transcript=TRANSCRIPT, captures=[], final=final
    )


@pytest.mark.asyncio
async def test_draft_asks_about_unlinked_items_first(merge_llm):
    fake = merge_llm(
        llm_map(
            [LINKED_STEP, UNLINKED_STEP],
            [UNLINKED_GUARD],
            ["What would make you stop and ask someone?", GAP_STEP.upper(), "  "],
        )
    )
    work_map = await run_merge(final=False)

    assert work_map["open_questions"] == [
        GAP_STEP,
        GAP_GUARD,
        "What would make you stop and ask someone?",
    ]
    assert set(work_map) == {"task", "steps", "guardrails", "open_questions"}
    assert len(fake.calls) == 1
    assert "This is the DRAFT" in fake.calls[0]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_final_appends_what_is_still_unlinked(merge_llm):
    merge_llm(
        llm_map(
            [LINKED_STEP, UNLINKED_STEP],
            [UNLINKED_GUARD],
            ["Who covers when the controller is out?"],
        )
    )
    work_map = await run_merge(final=True)

    assert work_map["open_questions"] == [
        "Who covers when the controller is out?",
        GAP_STEP,
        GAP_GUARD,
    ]


@pytest.mark.asyncio
async def test_fully_linked_map_adds_nothing(merge_llm):
    guard = guardrail(
        "g1",
        "Retired assets are never booked",
        at="01:00",
        step_id="s1",
        quote="Old assets are retired",
    )
    merge_llm(llm_map([LINKED_STEP], [guard], []))
    work_map = await run_merge(final=True)

    assert work_map["open_questions"] == []
    assert work_map["steps"][0]["at"] == 10
    assert work_map["guardrails"][0]["quote"] == "Old assets are retired"


@pytest.mark.asyncio
async def test_a_step_with_narration_is_not_a_gap(merge_llm):
    # No reason was given, but the expert said something while doing it.
    merge_llm(llm_map([step("s1", "Check the asset number", "00:10")], [], []))
    work_map = await run_merge(final=False)

    assert work_map["steps"][0]["quote_kind"] == "narration"
    assert work_map["open_questions"] == []


@pytest.mark.asyncio
async def test_brief_for_agent_lists_the_gaps(merge_llm):
    merge_llm(
        llm_map(
            [LINKED_STEP, UNLINKED_STEP], [UNLINKED_GUARD], ["What changes for foreign suppliers?"]
        )
    )
    brief = work_map_merge.brief_for_agent(await run_merge(final=False))

    gaps = brief.split("GAPS TO ASK ABOUT FIRST", 1)[1]
    assert f"- {GAP_STEP}" in gaps
    assert f"- {GAP_GUARD}" in gaps
    assert gaps.index(GAP_STEP) < gaps.index("What changes for foreign suppliers?")


def inferred(base, reason, confidence):
    return {**base, "inferred_reason": reason, "inferred_confidence": confidence}


@pytest.mark.asyncio
async def test_a_reason_it_is_extremely_sure_of_is_assumed_not_asked(merge_llm):
    sure = inferred(UNLINKED_STEP, "Equipment over 5,000 is capex", 0.95)
    fake = merge_llm(llm_map([LINKED_STEP, sure], [], []))
    work_map = await run_merge(final=False)

    coded = work_map["steps"][1]
    assert coded["reason"] == "Equipment over 5,000 is capex"
    assert coded["reason_source"] == "inferred"
    assert "inferred_reason" not in coded and "inferred_confidence" not in coded
    assert GAP_STEP not in work_map["open_questions"]
    assert "inferred_reason" in fake.calls[0]["messages"][0]["content"]
    brief = work_map_merge.brief_for_agent(work_map)
    assumed = brief.split("ASSUMED REASONS", 1)[1]
    assert "s2 Code the invoice: Equipment over 5,000 is capex" in assumed


@pytest.mark.asyncio
async def test_a_reason_it_is_not_sure_of_is_still_asked(merge_llm):
    merge_llm(llm_map([LINKED_STEP, inferred(UNLINKED_STEP, "Maybe capex", 0.8)], [], []))
    work_map = await run_merge(final=False)

    coded = work_map["steps"][1]
    assert coded["reason"] == "" and "reason_source" not in coded
    assert "inferred_reason" not in coded
    assert work_map["open_questions"] == [GAP_STEP]
    assert "ASSUMED REASONS" not in work_map_merge.brief_for_agent(work_map)


@pytest.mark.asyncio
async def test_the_experts_reason_beats_an_inferred_one(merge_llm):
    merge_llm(llm_map([inferred(LINKED_STEP, "Something obvious", 0.99)], [], []))
    work_map = await run_merge(final=True)

    assert work_map["steps"][0]["reason"] == "Retired assets can't be booked"
    assert "reason_source" not in work_map["steps"][0]


def test_the_schema_asks_for_inferred_reasons():
    step_schema = work_map_merge.SCHEMA["schema"]["properties"]["steps"]["items"]
    assert {"inferred_reason", "inferred_confidence"} <= set(step_schema["required"])
    assert set(step_schema["required"]) == set(step_schema["properties"])
