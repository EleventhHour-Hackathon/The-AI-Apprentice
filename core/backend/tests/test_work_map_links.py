from src.services import work_map_links as links


def test_mmss():
    assert links.mmss(192) == "03:12"
    assert links.mmss(None) == "00:00"


def test_step_without_words_asks_why_at_its_moment():
    step = {
        "title": "Code the invoice",
        "decision": "re-coded from 4711 to 0400.",
        "at": 192,
        "quote": "",
    }
    assert links.gap_question(step, "step") == "Why 're-coded from 4711 to 0400' at 03:12?"


def test_step_without_decision_uses_its_title():
    step = {"title": "SAP posting", "decision": "  ", "at": 5, "quote": ""}
    assert links.gap_question(step, "step") == "Why 'SAP posting' at 00:05?"


def test_step_drops_the_time_when_there_is_none():
    step = {"title": "Check VAT", "decision": "I held it", "at": None, "quote": ""}
    assert links.gap_question(step, "step") == "Why 'I held it'?"


def test_empty_labels_fall_back_to_plain_words():
    blank_step = {"title": "", "decision": "", "at": 5, "quote": ""}
    assert links.gap_question(blank_step, "step") == "Why this step at 00:05?"
    assert links.gap_question({"title": " . ", "at": None, "quote": ""}, "step") == "Why this step?"
    no_moment = {"title": "", "at": None, "quote": "said it"}
    assert links.gap_question(no_moment, "step") == "When in the task does this step come up?"
    blank_rule = {"rule": "", "at": 5, "quote": ""}
    assert (
        links.gap_question(blank_rule, "guardrail") == "When does this rule apply, in your words?"
    )
    unplaced_rule = {"rule": None, "at": None, "quote": "said it"}
    assert (
        links.gap_question(unplaced_rule, "guardrail") == "When in the task does this rule come up?"
    )


def test_step_with_words_but_no_moment_asks_when():
    step = {"title": "Hold the payment.", "at": None, "quote": "we never pay those"}
    assert links.gap_question(step, "step") == "When in the task does 'Hold the payment' come up?"


def test_guardrail_without_words_asks_when_it_applies():
    guard = {"rule": "Ask the controller above 5,000 euros.", "at": 30, "quote": ""}
    assert (
        links.gap_question(guard, "guardrail")
        == "When does 'Ask the controller above 5,000 euros' apply, in your words?"
    )


def test_guardrail_with_words_but_no_moment_asks_when():
    guard = {"rule": "Foreign suppliers need a VAT check", "at": None, "quote": "always the VAT"}
    assert (
        links.gap_question(guard, "guardrail")
        == "When in the task does 'Foreign suppliers need a VAT check' come up?"
    )


def test_gap_questions_have_no_em_dashes():
    items = [
        ({"title": "A", "at": None, "quote": ""}, "step"),
        ({"title": "A", "at": 1, "quote": ""}, "step"),
        ({"title": "A", "at": None, "quote": "x"}, "step"),
        ({"rule": "B", "at": None, "quote": ""}, "guardrail"),
        ({"rule": "B", "at": None, "quote": "x"}, "guardrail"),
    ]
    for item, kind in items:
        assert "—" not in links.gap_question(item, kind)


def test_unlinked_gaps_lists_steps_then_guardrails_and_skips_linked_items():
    work_map = {
        "guardrails": [
            {"rule": "Rule one", "at": 10, "quote": ""},
            {"rule": "Rule two", "at": 10, "quote": "said it"},
        ],
        "steps": [
            {"title": "Linked", "at": 5, "quote": "said it"},
            {"title": "Open the queue", "decision": "", "at": 5, "quote": ""},
            {"title": "Approve", "at": None, "quote": "said it"},
        ],
    }
    assert links.unlinked_gaps(work_map) == [
        "Why 'Open the queue' at 00:05?",
        "When in the task does 'Approve' come up?",
        "When does 'Rule one' apply, in your words?",
    ]


def test_unlinked_gaps_on_an_empty_map():
    assert links.unlinked_gaps({"steps": [], "guardrails": []}) == []
    assert links.unlinked_gaps({}) == []


def test_match_quote_forgives_number_words_and_fillers():
    lines = [{"t": 40, "text": "Um, anything over five thousand euros goes to the controller."}]
    found = links.match_quote("anything over €5,000 goes to the controller", lines)
    assert found is not None
    text, line = found
    assert text == "anything over five thousand euros goes to the controller"
    assert line["t"] == 40


def test_match_quote_across_two_lines():
    lines = [
        {"t": 10, "text": "I check the asset number first"},
        {"t": 12, "text": "because uh the old ones are retired."},
    ]
    text, line = links.match_quote("number first because the old ones", lines)
    assert text == "number first because uh the old ones"
    assert line["t"] == 10


def test_ground_quote_keeps_the_transcript_words_or_drops_the_quote():
    lines = [{"t": 7, "text": "We code these to 0400, never 4711.", "phase": "debrief"}]
    kept = {"quote": "we code these to 0400"}
    assert links.ground_quote(kept, lines)
    assert kept["quote"] == "We code these to 0400"
    assert kept["quote_at"] == 7 and kept["quote_source"] == "debrief"
    assert kept["quote_kind"] == "reason"

    invented = {"quote": "the auditor told me so"}
    assert not links.ground_quote(invented, lines)
    assert invented["quote"] == "" and invented["quote_kind"] == "none"
