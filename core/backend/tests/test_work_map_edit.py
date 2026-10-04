"""Voice edits to a saved Work Map: change, remove and add a step or a rule."""

import copy

import pytest

from src.services import tutor, work_map_diff, work_map_edit
from src.services.work_map_edit import EditError, apply, summary_for_agent

WORK_MAP = {
    "task": "Code a supplier invoice",
    "steps": [
        {"id": "s1", "title": "Open the invoice", "decision": "", "reason": ""},
        {
            "id": "s2",
            "title": "Code the cost account",
            "decision": "Coded the laptop to capex 0400.",
            "reason": "because equipment over 5,000 is capex",
            "quote": "Over 5,000 it's always capex.",
            "quote_source": "live",
        },
        {"id": "s3", "title": "Approve the invoice", "decision": "", "reason": ""},
    ],
    "guardrails": [
        {
            "id": "g1",
            "rule": "Equipment over 5,000 goes to capex",
            "kind": "limit",
            "applies_when": "when the invoice is for equipment",
            "ask_whom": "",
            "step": "s2",
        },
        {
            "id": "g2",
            "rule": "Ask the controller before approving a supplier with no VAT id",
            "kind": "stop_and_ask",
            "applies_when": "",
            "ask_whom": "the controller",
            "step": "s3",
        },
    ],
}


@pytest.fixture
def work_map():
    return copy.deepcopy(WORK_MAP)


def _ids(items):
    return [item["id"] for item in items]


def _assert_unique(work_map):
    for key in ("steps", "guardrails"):
        ids = _ids(work_map.get(key) or [])
        assert len(ids) == len(set(ids)), f"duplicate {key} ids: {ids}"


# Change


def test_change_a_step_title(work_map):
    out, change, stale = apply(work_map, {"action": "change", "item_id": "s1", "title": "Open it"})
    assert change == "Changed step s1 (Open the invoice): title is now 'Open it'"
    assert stale == ""
    assert out["steps"][0]["title"] == "Open it"
    assert out["steps"][0]["id"] == "s1"
    _assert_unique(out)


def test_change_drops_a_leading_because_and_keeps_what_the_expert_said(work_map):
    out, change, _ = apply(
        work_map,
        {
            "action": "change",
            "item_id": "s2",
            "reason": "Because the auditors want it",
            "said": "  Actually it's because the auditors want it.  ",
        },
    )
    step = out["steps"][1]
    assert step["reason"] == "the auditors want it"
    assert step["quote"] == "Actually it's because the auditors want it."
    assert step["quote_source"] == "debrief"
    assert change == (
        "Changed step s2 (Code the cost account): reason is now 'the auditors want it'"
    )


def test_change_without_said_keeps_the_old_quote(work_map):
    out, _, _ = apply(work_map, {"action": "change", "item_id": "s2", "decision": "Opex."})
    assert out["steps"][1]["quote"] == "Over 5,000 it's always capex."
    assert out["steps"][1]["quote_source"] == "live"


def test_change_a_rule_and_ignore_an_unknown_kind(work_map):
    out, change, _ = apply(
        work_map,
        {"action": "change", "item_id": "g2", "kind": "whenever", "ask_whom": "the CFO"},
    )
    rule = out["guardrails"][1]
    assert rule["kind"] == "stop_and_ask"
    assert rule["ask_whom"] == "the CFO"
    assert change == (
        "Changed rule g2 (Ask the controller before approving a supplier with no VAT id): "
        "ask_whom is now 'the CFO'"
    )


def test_change_a_rule_kind_to_a_known_one(work_map):
    out, change, _ = apply(work_map, {"action": "change", "item_id": "g1", "kind": "exception"})
    assert out["guardrails"][0]["kind"] == "exception"
    assert change.endswith("kind is now 'exception'")


def test_changing_a_number_lists_the_items_that_still_carry_the_old_one(work_map):
    out, change, stale = apply(
        work_map,
        {"action": "change", "item_id": "g1", "rule": "Equipment over 10,000 goes to capex"},
    )
    assert out["guardrails"][0]["rule"] == "Equipment over 10,000 goes to capex"
    assert change.endswith("rule is now 'Equipment over 10,000 goes to capex'")
    # The step's reason still says 5,000; the edited rule itself isn't listed.
    assert stale == 's2 reason "because equipment over 5,000 is capex"'
    assert "g1" not in stale


def test_a_change_that_keeps_the_numbers_has_nothing_stale(work_map):
    _, _, stale = apply(
        work_map,
        {"action": "change", "item_id": "g1", "rule": "Any equipment over 5,000 is capex"},
    )
    assert stale == ""


def test_change_with_nothing_to_change_is_an_error(work_map):
    with pytest.raises(EditError, match="Nothing to change"):
        apply(work_map, {"action": "change", "item_id": "s1", "title": "   ", "decision": 3})


# Remove


def test_remove_a_step_detaches_its_rules(work_map):
    out, change, stale = apply(work_map, {"action": "remove", "item_id": "s2"})
    assert change == "Removed step s2: Code the cost account"
    assert stale == ""
    assert _ids(out["steps"]) == ["s1", "s3"]
    assert out["guardrails"][0]["step"] == ""
    assert out["guardrails"][1]["step"] == "s3"


def test_remove_a_rule(work_map):
    out, change, _ = apply(work_map, {"action": "remove", "item_id": "g1"})
    assert change == "Removed rule g1: Equipment over 5,000 goes to capex"
    assert _ids(out["guardrails"]) == ["g2"]
    assert len(out["steps"]) == 3


# Add


def test_add_a_step_after_another(work_map):
    out, change, stale = apply(
        work_map,
        {
            "action": "add",
            "what": "step",
            "title": "Check the VAT id",
            "decision": "Looked it up",
            "after_id": "s1",
            "said": "Then I check the VAT id.",
        },
    )
    assert change == "Added step s4: Check the VAT id"
    assert stale == ""
    assert _ids(out["steps"]) == ["s1", "s4", "s2", "s3"]
    new = out["steps"][1]
    assert new["quote"] == "Then I check the VAT id."
    assert new["quote_source"] == "debrief"
    assert new["judgment"] is True
    assert new["at"] is None
    _assert_unique(out)


def test_add_a_step_without_after_goes_last_and_without_said_has_no_quote(work_map):
    out, _, _ = apply(work_map, {"action": "add", "what": "step", "title": "File it"})
    assert out["steps"][-1]["id"] == "s4"
    assert out["steps"][-1]["quote"] == ""
    assert out["steps"][-1]["quote_source"] == "none"
    assert out["steps"][-1]["judgment"] is False


def test_add_a_rule_defaults_to_a_limit(work_map):
    out, change, _ = apply(work_map, {"action": "add", "what": "rule", "rule": "Never pay twice"})
    assert change == "Added rule g3: Never pay twice"
    new = out["guardrails"][-1]
    assert new["kind"] == "limit"
    assert new["step"] == ""
    _assert_unique(out)


def test_add_after_a_remove_never_reuses_an_id(work_map):
    apply(work_map, {"action": "remove", "item_id": "s3"})
    apply(work_map, {"action": "remove", "item_id": "s1"})
    out, change, _ = apply(work_map, {"action": "add", "what": "step", "title": "New"})
    # The highest id is s2, so the next one is s3; s1 is free but the number keeps going up.
    assert change == "Added step s3: New"
    _assert_unique(out)
    out, _, _ = apply(out, {"action": "add", "what": "step", "title": "Newer"})
    assert _ids(out["steps"]) == ["s2", "s3", "s4"]


def test_next_id_ignores_ids_that_are_not_numbered():
    assert work_map_edit._next_id([{"id": "s2"}, {"id": "intro"}, {"id": None}, {}], "s") == "s3"
    assert work_map_edit._next_id([], "g") == "g1"


def test_add_needs_a_title_or_a_rule(work_map):
    with pytest.raises(EditError, match="A new step needs its title"):
        apply(work_map, {"action": "add", "what": "step", "decision": "x"})
    with pytest.raises(EditError, match="A new rule needs its rule"):
        apply(work_map, {"action": "add", "what": "rule", "ask_whom": "x"})


def test_add_to_a_map_with_no_rules_yet():
    work_map = {"steps": []}
    out, change, _ = apply(work_map, {"action": "add", "what": "rule", "rule": "Ask first"})
    assert change == "Added rule g1: Ask first"
    assert _ids(out["guardrails"]) == ["g1"]


# Errors


def test_an_unknown_item_id(work_map):
    with pytest.raises(EditError, match="There is no step with id s9"):
        apply(work_map, {"action": "change", "item_id": "s9", "title": "x"})
    with pytest.raises(EditError, match="There is no rule with id g7"):
        apply(work_map, {"action": "remove", "item_id": "g7"})
    with pytest.raises(EditError, match=r"There is no rule with id \(none\)"):
        apply(work_map, {"action": "remove"})
    assert work_map == WORK_MAP


def test_an_unknown_action(work_map):
    with pytest.raises(EditError, match="action must be change, remove or add"):
        apply(work_map, {"action": "rename", "item_id": "s1", "title": "x"})


# Maps saved before ids existed


def test_a_map_without_ids_gets_them_and_a_title():
    work_map = {
        "steps": [{"step": "Open the invoice"}, {"title": "Code it", "id": ""}],
        "guardrails": [{"rule": "Ask first"}],
    }
    out, change, _ = apply(work_map, {"action": "change", "item_id": "s1", "decision": "Opened"})
    assert _ids(out["steps"]) == ["s1", "s2"]
    assert _ids(out["guardrails"]) == ["g1"]
    assert out["steps"][0]["title"] == "Open the invoice"
    assert change == "Changed step s1 (Open the invoice): decision is now 'Opened'"


def test_a_map_with_some_ids_missing_keeps_them_unique():
    work_map = {"steps": [{"id": "s2", "title": "Code it"}, {"title": "Approve it"}]}
    apply(work_map, {"action": "change", "item_id": "s2", "title": "Code the account"})
    _assert_unique(work_map)
    assert _ids(work_map["steps"]) == ["s2", "s3"]
    assert work_map["steps"][0]["title"] == "Code the account"


def test_an_id_less_item_before_one_with_its_id_gets_a_new_one():
    work_map = {"steps": [{"title": "Open it"}, {"id": "s1", "title": "Code it"}]}
    apply(work_map, {"action": "change", "item_id": "s1", "decision": "Coded"})
    _assert_unique(work_map)
    assert _ids(work_map["steps"]) == ["s2", "s1"]
    assert work_map["steps"][1]["decision"] == "Coded"


def test_guardrails_with_some_ids_missing_keep_them_unique():
    work_map = {
        "steps": [{"title": "Code it"}],
        "guardrails": [{"rule": "Ask first"}, {"id": "g1", "rule": "Over 5,000 is capex"}, {}],
    }
    apply(work_map, {"action": "change", "item_id": "g1", "rule": "Over 10,000 is capex"})
    _assert_unique(work_map)
    assert _ids(work_map["guardrails"]) == ["g2", "g1", "g3"]
    assert work_map["guardrails"][1]["rule"] == "Over 10,000 is capex"


def test_a_map_with_no_ids_keeps_numbering_by_position():
    work_map = {
        "steps": [{"title": "Open it"}, {"title": "Code it"}, {"title": "Approve it"}],
        "guardrails": [{"rule": "Ask first"}, {"rule": "Over 5,000 is capex"}],
    }
    as_saved = copy.deepcopy(work_map)
    apply(work_map, {"action": "change", "item_id": "s2", "decision": "Coded"})
    assert _ids(work_map["steps"]) == ["s1", "s2", "s3"]
    assert _ids(work_map["guardrails"]) == ["g1", "g2"]
    # The lesson report and the diff fall back to the same ids for a map saved without them.
    assert work_map_diff._ids(as_saved["steps"], "s") == ["s1", "s2", "s3"]
    assert work_map_diff._ids(as_saved["guardrails"], "g") == ["g1", "g2"]
    lesson = tutor.report(as_saved, [])
    assert [entry["step"] for entry in lesson["not_covered"]] == ["s1", "s2", "s3"]


# What the agent reads back


def test_summary_for_agent(work_map):
    assert summary_for_agent(work_map) == "\n".join(
        [
            "STEPS",
            "Step 1 [id s1] title: Open the invoice",
            "Step 2 [id s2] title: Code the cost account"
            " | decision: Coded the laptop to capex 0400."
            " | reason: equipment over 5,000 is capex",
            "Step 3 [id s3] title: Approve the invoice",
            "RULES",
            "Rule 1 [id g1] rule: Equipment over 5,000 goes to capex | kind: limit"
            " | applies_when: the invoice is for equipment",
            "Rule 2 [id g2] rule: Ask the controller before approving a supplier with no VAT id"
            " | kind: stop_and_ask | ask_whom: the controller",
        ]
    )


def test_summary_for_an_empty_map():
    assert summary_for_agent({}) == "STEPS\n(none)\nRULES\n(none)"


def test_summary_gives_ids_to_a_map_without_them_and_a_kind_to_rules():
    out = summary_for_agent({"steps": [{"step": "Open it"}], "guardrails": [{"rule": "Ask"}]})
    assert (
        out == "STEPS\nStep 1 [id s1] title: Open it\nRULES\nRule 1 [id g1] rule: Ask | kind: limit"
    )
