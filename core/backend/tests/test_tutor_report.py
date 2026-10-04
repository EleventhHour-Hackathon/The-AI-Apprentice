"""The tutor's end-of-lesson report, and the Work Map as the tutor reads it."""

from src.services import tutor

WORK_MAP = {
    "task": "Code a supplier invoice",
    "steps": [
        {
            "id": "s1",
            "title": "Open the invoice",
            "quote": "Ich mache erst mal die Rechnung auf.",
            "quote_kind": "narration",
            "quote_translation": "First I open the invoice.",
        },
        {
            "id": "s2",
            "title": "Code the cost account",
            "judgment": True,
            "decision": "Coded the laptop to capex 0400.",
            "reason": "because equipment over 5,000 is capex",
            "quote": "Over 5,000 it's always capex.",
        },
        {
            "id": "s3",
            "title": "Check the VAT id",
            "decision": "Looked up the VAT id.",
            "reason": "because the auditors check it",
            "quote": "Jetzt die USt-ID.",
            "quote_kind": "narration",
        },
        {"id": "s4", "title": "Approve the invoice"},
    ],
    "guardrails": [
        {
            "id": "g1",
            "kind": "limit",
            "rule": "Equipment over 5,000 goes to capex",
            "step": "s2",
            "applies_when": "the invoice is for equipment",
            "quote": "Über 5.000 immer Anlagevermögen.",
            "quote_translation": "Over 5,000 always fixed assets.",
        },
        {"kind": "stop_and_ask", "rule": "No VAT id, no approval", "ask_whom": "the controller"},
    ],
}


def _by_step(entries):
    return {e["step"]: e for e in entries}


def test_a_step_done_right_is_mastered():
    out = tutor.report(WORK_MAP, [{"type": "done", "step": "s1"}])
    assert out["mastered"] == [{"step": "s1", "title": "Open the invoice"}]
    assert out["practice"] == []
    assert [n["step"] for n in out["not_covered"]] == ["s2", "s3", "s4"]


def test_a_right_prediction_is_mastered():
    out = tutor.report(WORK_MAP, [{"type": "prediction", "step": "s2", "correct": True}])
    assert [m["step"] for m in out["mastered"]] == ["s2"]


def test_an_intervention_is_practice_with_why_expected_and_the_experts_words():
    attempts = [
        {"type": "done", "step": "s2"},  # caught counts more than a later step done right
        {
            "type": "intervention",
            "step": "s2",
            "what_happened": "Coded 7,200 equipment to opex 4711",
            "expected": "Capex 0400, it is over 5,000",
        },
    ]
    out = tutor.report(WORK_MAP, attempts)
    assert out["mastered"] == []
    assert out["practice"] == [
        {
            "step": "s2",
            "title": "Code the cost account",
            "why": "Caught before saving: Coded 7,200 equipment to opex 4711.",
            "expected": "Capex 0400, it is over 5,000",
            "expert_words": "Over 5,000 it's always capex.",
        }
    ]


def test_an_intervention_fixed_later_says_so():
    attempts = [
        {"type": "intervention", "step": "s2", "what_happened": "Coded to opex"},
        {"type": "fixed", "step": "s2"},
    ]
    entry = tutor.report(WORK_MAP, attempts)["practice"][0]
    assert entry["why"] == "Caught before saving: Coded to opex; fixed after the tutor stepped in."
    assert entry["expected"] == ""


def test_an_intervention_with_no_details():
    entry = tutor.report(WORK_MAP, [{"type": "intervention", "step": "s4"}])["practice"][0]
    assert entry["why"] == "Caught before saving: a wrong decision."
    assert entry["expected"] == ""
    assert entry["expert_words"] == ""


def test_narration_is_not_used_as_the_experts_words():
    entry = tutor.report(WORK_MAP, [{"type": "intervention", "step": "s3"}])["practice"][0]
    assert entry["expert_words"] == "because the auditors check it"
    entry = tutor.report(WORK_MAP, [{"type": "intervention", "step": "s1"}])["practice"][0]
    assert entry["expert_words"] == ""


def test_a_wrong_prediction_is_practice_and_expects_the_experts_decision():
    attempts = [{"type": "prediction", "step": "s2", "correct": False, "answer": "Opex 4711"}]
    entry = tutor.report(WORK_MAP, attempts)["practice"][0]
    assert entry["why"] == 'Predicted "Opex 4711".'
    assert entry["expected"] == "Coded the laptop to capex 0400."
    assert entry["expert_words"] == "Over 5,000 it's always capex."


def test_a_wrong_prediction_and_an_intervention_both_count():
    attempts = [
        {"type": "prediction", "step": "s2", "correct": False},
        {"type": "intervention", "step": "s2", "what_happened": "Opex", "expected": "Capex"},
    ]
    entry = tutor.report(WORK_MAP, attempts)["practice"][0]
    assert entry["why"] == 'Caught before saving: Opex; Predicted "something else".'
    assert entry["expected"] == "Capex"


def test_steps_with_no_attempts_are_not_covered():
    out = tutor.report(WORK_MAP, [{"type": "done", "step": "s9"}, {"type": "done"}])
    assert out["mastered"] == [] and out["practice"] == []
    assert [n["step"] for n in out["not_covered"]] == ["s1", "s2", "s3", "s4"]
    assert out["summary"] == (
        "Mastered: nothing yet. Practice next: nothing. Not covered by this case: "
        "Open the invoice, Code the cost account, Check the VAT id, Approve the invoice."
    )


def test_steps_without_ids_fall_back_to_their_position():
    work_map = {"steps": [{"step": "Open it"}, {"title": "Code it", "id": ""}]}
    out = tutor.report(
        work_map,
        [{"type": "done", "step": "s1"}, {"type": "intervention", "step": "s2"}],
    )
    assert out["mastered"] == [{"step": "s1", "title": "Open it"}]
    assert _by_step(out["practice"])["s2"]["title"] == "Code it"


def test_summary_lists_all_three():
    attempts = [
        {"type": "done", "step": "s1"},
        {"type": "intervention", "step": "s2", "what_happened": "Opex"},
    ]
    assert tutor.report(WORK_MAP, attempts)["summary"] == (
        "Mastered: Open the invoice. "
        "Practice next: Code the cost account (Caught before saving: Opex.). "
        "Not covered by this case: Check the VAT id, Approve the invoice."
    )


def test_an_empty_map():
    out = tutor.report({}, [{"type": "done", "step": "s1"}])
    assert out == {
        "mastered": [],
        "practice": [],
        "not_covered": [],
        "summary": (
            "Mastered: nothing yet. Practice next: nothing. Not covered by this case: nothing."
        ),
    }


def test_work_map_text():
    assert tutor.work_map_text(WORK_MAP) == "\n".join(
        [
            "STEPS (in order)",
            "s1. Open the invoice",
            '   Said while doing it (not a reason): "Ich mache erst mal die Rechnung auf."'
            ' (in English: "First I open the invoice.")',
            "s2. Code the cost account [judgment call]",
            "   Decision the expert made on their case: Coded the laptop to capex 0400.",
            "   Expert's words: \"Over 5,000 it's always capex.\"",
            "s3. Check the VAT id",
            "   Decision the expert made on their case: Looked up the VAT id.",
            "   Reason: because the auditors check it",
            '   Said while doing it (not a reason): "Jetzt die USt-ID."',
            "s4. Approve the invoice",
            "\nGUARDRAILS",
            "g1. Limit: Equipment over 5,000 goes to capex (step s2)",
            "   Applies when: the invoice is for equipment",
            '   Expert\'s words: "Über 5.000 immer Anlagevermögen."'
            ' (in English: "Over 5,000 always fixed assets.")',
            "g2. Stop and ask: No VAT id, no approval",
            "   Ask: the controller",
        ]
    )


def test_work_map_text_labels_an_assumed_reason():
    assumed = {"reason": "it's standard practice", "reason_source": "inferred"}
    work_map = {
        "steps": [
            {"id": "s1", "title": "Match the order", **assumed},
            {"id": "s2", "title": "Hold it", "reason": "the supplier is new"},
        ]
    }
    text = tutor.work_map_text(work_map)
    assert "s1. Match the order\n   Assumed reason: it's standard practice" in text
    assert "s2. Hold it\n   Reason: the supplier is new" in text


def test_work_map_text_of_an_empty_map():
    assert tutor.work_map_text({}) == "STEPS (in order)\n\nGUARDRAILS\n(none)"
