"""Questions for each expert from the diff of two Work Maps: pure, no LLM."""

import copy

from src.services.diff_questions import number, questions, trim
from src.services.work_map_diff import diff


def _map() -> dict:
    return {
        "id": "m1",
        "task": "Code a supplier invoice",
        "steps": [
            {
                "id": "s1",
                "title": "Open the invoice",
                "decision": "Opened invoice 4711 from the inbox.",
                "reason": "",
                "judgment": False,
                "quote": "Ich mache erst mal die Rechnung auf.",
                "quote_kind": "narration",
                "quote_translation": "First I open the invoice.",
            },
            {
                "id": "s2",
                "title": "Code the cost account",
                "decision": "Re-coded from opex 4711 to capex 0400.",
                "reason": "Anything over 5,000 is a fixed asset.",
                "judgment": True,
                "quote": "Alles über 5.000 ist Anlagevermögen.",
                "quote_kind": "reason",
                "quote_translation": "Anything over 5,000 is a fixed asset.",
            },
            {
                "id": "s3",
                "title": "Check the VAT",
                "decision": "Applied reverse charge.",
                "reason": "The supplier is in another EU country.",
                "judgment": True,
                "quote": None,
                "quote_kind": "none",
            },
        ],
        "guardrails": [
            {
                "id": "g1",
                "kind": "stop_and_ask",
                "rule": "Ask before posting a large invoice.",
                "applies_when": "the invoice is over 10,000",
                "ask_whom": "the controller",
                "step": "s3",
                "quote": "Über 10.000 frage ich immer Petra.",
                "quote_translation": "Over 10,000 I always ask Petra.",
            },
            {
                "id": "g2",
                "kind": "exception",
                "rule": "Software licences stay opex",
                "applies_when": "the item is a software licence",
                "ask_whom": None,
                "step": "s2",
                "quote": "",
            },
        ],
        "open_questions": [],
    }


def _words(quote="", translation="", reason=""):
    return {"quote": quote, "quote_translation": translation, "reason": reason}


def _differs(section, a, b, fields, words_a=None, words_b=None, title="", score=0.5):
    return {
        section: {
            "same": [],
            "differs": [
                {
                    "a": a,
                    "b": b,
                    "title_a": title,
                    "title_b": title,
                    "score": score,
                    "fields": fields,
                    "words_a": words_a or _words(),
                    "words_b": words_b or _words(),
                }
            ],
            "only_a": [],
            "only_b": [],
        }
    }


def _field(name, a, b, kind="changed"):
    return {"field": name, "kind": kind, "a": a, "b": b}


def test_threshold_difference_asks_each_side_with_their_words_and_the_other_number():
    b = _map()
    b["guardrails"][0].update(
        applies_when="the invoice is over 5,000",
        quote="Ab 5.000 frage ich immer Petra.",
        quote_translation="From 5,000 on I always ask Petra.",
    )
    out = questions(diff(_map(), b))
    [qa], [qb] = out["a"], out["b"]
    assert qa == {
        "id": "guardrails:g1:g1:numbers",
        "section": "guardrails",
        "item": "g1",
        "other": "g1",
        "field": "numbers",
        "text": 'You said "Over 10,000 I always ask Petra." You went with 10,000; '
        "in another session it was 5,000. Which holds, and when?",
        "quote": "Over 10,000 I always ask Petra.",
    }
    assert qb["quote"] == "From 5,000 on I always ask Petra."
    assert "You went with 5,000; in another session it was 10,000." in qb["text"]


def test_ask_whom_and_kind():
    d = _differs(
        "guardrails",
        "g1",
        "g4",
        [_field("ask_whom", "the controller", "Petra in accounting")],
        _words(translation="I ask the controller."),
        title="Ask before posting a large invoice.",
    )
    out = questions(d)
    assert out["a"][0]["text"] == (
        'You said "I ask the controller." You would ask the controller; '
        "in another session it was Petra in accounting. Who should it be, and why?"
    )
    # No words on b's side: the question names the rule instead, without a stray full stop.
    assert out["b"][0]["text"] == (
        'On "Ask before posting a large invoice", you would ask Petra in accounting; '
        "in another session it was the controller. Who should it be, and why?"
    )
    assert out["b"][0]["quote"] == ""

    d = _differs("guardrails", "g1", "g1", [_field("kind", "stop_and_ask", "limit")])
    out = questions(d)
    assert out["a"][0]["text"] == (
        "On this rule, you treat this as a point to stop and ask; "
        "in another session it was a hard limit. Why?"
    )
    assert out["b"][0]["text"].startswith("On this rule, you treat this as a hard limit;")


def test_flipped_rule():
    b = _map()
    b["guardrails"][1].update(rule="Software licences never stay opex")
    out = questions(diff(_map(), b))
    [qa] = out["a"]
    assert qa["field"] == "rule"
    assert qa["text"] == (
        'On "Software licences stay opex", your rule is "Software licences stay opex"; '
        'in another session it was "Software licences never stay opex". Which is right, and when?'
    )


def test_missing_field_asks_the_empty_side_for_theirs_and_the_other_if_it_always_holds():
    b = _map()
    b["steps"][2]["reason"] = None
    out = questions(diff(_map(), b))
    [qa], [qb] = out["a"], out["b"]
    assert qa["id"] == qb["id"] == "steps:s3:s3:reason"
    assert qb["text"] == (
        'On "Check the VAT", in another session the reason given was '
        '"The supplier is in another EU country". What\'s yours?'
    )
    assert qb["quote"] == ""
    # A's words are that very reason; it is quoted once, in the question.
    assert qa["text"] == (
        'On "Check the VAT", your reason was "The supplier is in another EU country"; '
        "in another session none was given. Is that always why?"
    )
    assert qa["quote"] == "The supplier is in another EU country."


def test_only_one_expert_has_it():
    b = _map()
    b["steps"].insert(
        2,
        {
            "id": "s9",
            "title": "Attach the delivery note",
            "decision": "Scanned the delivery note and attached it.",
            "reason": "Audit wants proof of receipt.",
            "quote": "Der Lieferschein muss dran.",
            "quote_kind": "reason",
            "quote_translation": "The delivery note has to be attached.",
        },
    )
    b["guardrails"].append(
        {"id": "g7", "kind": "limit", "rule": "Never pay a supplier without a bank check."}
    )
    out = questions(diff(b, _map()))
    assert out["b"] == []
    assert [q["id"] for q in out["a"]] == ["guardrails:g7:-:only", "steps:s9:-:only"]
    assert out["a"][0]["text"] == (
        'Your rule "Never pay a supplier without a bank check" didn\'t come up in another '
        "session. When does it apply?"
    )
    assert out["a"][0]["other"] is None
    assert out["a"][1]["text"] == (
        'You said "The delivery note has to be attached." You did "Attach the delivery note"; '
        "in another session this step wasn't there. When is it needed?"
    )
    mirrored = questions(diff(_map(), b))
    assert mirrored["a"] == []
    assert [q["id"] for q in mirrored["b"]] == ["guardrails:-:g7:only", "steps:-:s9:only"]


def test_numbers_rank_above_a_reworded_decision():
    d = _differs("steps", "s2", "s2", [_field("decision", "Coded to capex.", "Kept opex.")])
    d.update(_differs("guardrails", "g1", "g1", [_field("numbers", ["10000"], ["5000"])]))
    out = questions(d)
    assert [q["field"] for q in out["a"]] == ["numbers", "decision"]
    assert [q["field"] for q in out["b"]] == ["numbers", "decision"]


def test_one_question_per_item_its_most_telling_field():
    d = _differs(
        "steps",
        "s2",
        "s5",
        [
            _field("decision", "Coded to capex.", "Kept opex."),
            _field("reason", "It is an asset.", "It is a repair."),
            _field("judgment", True, False),
        ],
    )
    out = questions(d)
    assert [q["id"] for q in out["a"]] == ["steps:s2:s5:judgment"]
    assert [q["id"] for q in out["b"]] == ["steps:s2:s5:judgment"]
    assert out["b"][0]["text"] == (
        "On this step, you treat this as routine; in another session it was a judgment call. Why?"
    )


def test_cap_and_no_item_asked_twice():
    only = [{"id": f"s{i}", "title": f"Step {i}", "words": _words()} for i in range(1, 9)]
    d = {"steps": {"only_a": only + [dict(only[0], title="Again")]}}
    out = questions(d, limit=5)
    assert [q["item"] for q in out["a"]] == ["s1", "s2", "s3", "s4", "s5"]
    assert questions(d, limit=20)["a"][-1]["item"] == "s8"
    assert questions(d, limit=0) == {"a": [], "b": []}


def test_narration_falls_back_to_reason_then_to_no_quote():
    b = _map()
    b["steps"][0].update(decision="Opened invoice 4711 from the portal.", judgment=True)
    b["steps"][0]["reason"] = "Portal invoices come first."
    out = questions(diff(_map(), b))
    [qa], [qb] = out["a"], out["b"]
    assert qa["field"] == qb["field"] == "judgment"
    # Both quotes are narration. B gave a reason, A gave nothing.
    assert qb["quote"] == "Portal invoices come first."
    assert qb["text"].startswith('You said "Portal invoices come first." You treat this as')
    assert qa["quote"] == ""
    assert qa["text"].startswith('On "Open the invoice", you treat this as routine')
    assert '""' not in qa["text"]


def test_empty_or_partial_input():
    assert questions({}) == {"a": [], "b": []}
    assert questions(None) == {"a": [], "b": []}
    assert questions(diff(_map(), _map())) == {"a": [], "b": []}
    assert questions({"steps": None, "guardrails": {"differs": None}}) == {"a": [], "b": []}
    d = {
        "steps": {
            "differs": [
                {"a": "s1", "b": "s1", "fields": [_field("decision", None, None)]},
                {"a": "s2", "b": "s2", "fields": None},
                {"a": "s3", "b": "s3", "fields": [_field("unknown", "x", "y")]},
                {"a": "s4", "title_a": None, "fields": [_field("judgment", None, False)]},
            ],
            "only_b": [{"id": "s7", "title": None, "words": None}],
        }
    }
    out = questions(d)
    [qa] = out["a"]
    assert qa["id"] == "steps:s4:-:judgment"
    assert qa["text"] == "On this step, in another session this was routine. What is it for you?"
    assert [q["text"] for q in out["b"]] == [
        "On this step, you treat this as routine; in another session that wasn't said. Why?",
        "You did a step another session didn't have. When is it needed?",
    ]


def test_ids_match_across_sides():
    b = _map()
    b["guardrails"][0].update(id="x1", ask_whom="Petra in accounting")
    b["steps"][1].update(id="x2", judgment=False)
    b["guardrails"][1]["step"] = "x2"
    out = questions(diff(_map(), b))
    assert [q["id"] for q in out["a"]] == [q["id"] for q in out["b"]]
    assert {q["id"] for q in out["a"]} == {"guardrails:g1:x1:ask_whom", "steps:s2:x2:judgment"}
    assert [q["item"] for q in out["b"]] == ["x1", "x2"]
    assert [q["other"] for q in out["b"]] == ["g1", "s2"]


def test_input_unchanged_and_deterministic():
    b = _map()
    b["guardrails"][0].update(applies_when="the invoice is over 5,000", ask_whom="Petra")
    b["steps"][2]["reason"] = None
    d = diff(_map(), b)
    before = copy.deepcopy(d)
    first = questions(d)
    assert d == before
    assert questions(copy.deepcopy(d)) == first == questions(d)


def test_numbers_and_long_text_read_well():
    assert number("5000") == "5,000"
    assert number("1234567.5") == "1,234,567.5"
    assert number("0400") == "0400"
    long = "Anything over five thousand euros is a fixed asset unless it is a software licence " * 2
    cut = trim(long)
    assert cut.endswith("...") and len(cut) <= 83
    assert not cut[:-3].endswith(" ")
    d = _differs("guardrails", "g1", "g1", [_field("numbers", ["5000", "10000"], ["2500"])])
    assert questions(d)["a"][0]["text"] == (
        "On this rule, you went with 5,000 and 10,000; in another session it was 2,500. "
        "Which holds, and when?"
    )


def test_end_to_end_two_sessions():
    a = _map()
    b = _map()
    b["guardrails"][0].update(
        applies_when="the invoice is over 5,000",
        ask_whom="Petra in accounting",
        quote="Ab 5.000 frage ich Petra.",
        quote_translation="From 5,000 on I ask Petra.",
    )
    b["steps"][1].update(
        decision="Left it on opex 4711.",
        reason="It is a repair, not an asset.",
        quote_translation="That's just a repair.",
        judgment=False,
    )
    b["steps"][2]["reason"] = None
    b["steps"].insert(
        2,
        {
            "id": "s9",
            "title": "Attach the delivery note",
            "decision": "Attached it.",
            "reason": "Audit wants proof of receipt.",
            "quote": "Der Lieferschein muss dran.",
            "quote_kind": "reason",
            "quote_translation": "The delivery note has to be attached.",
        },
    )
    out = questions(diff(a, b))
    assert [q["id"] for q in out["a"]] == [
        "guardrails:g1:g1:numbers",
        "steps:s2:s2:judgment",
        "steps:s3:s3:reason",
    ]
    assert [q["id"] for q in out["b"]] == [
        "guardrails:g1:g1:numbers",
        "steps:s2:s2:judgment",
        "steps:s3:s3:reason",
        "steps:-:s9:only",
    ]
    # The person to ask differs as well: one sentence after the question says so.
    assert out["a"][0]["text"] == (
        'You said "Over 10,000 I always ask Petra." You went with 10,000; '
        "in another session it was 5,000. Which holds, and when? The person to ask differs too."
    )
    assert out["b"][0]["text"] == (
        'You said "From 5,000 on I ask Petra." You went with 5,000; '
        "in another session it was 10,000. Which holds, and when? The person to ask differs too."
    )


def test_numbers_name_only_those_that_differ():
    d = _differs(
        "guardrails",
        "g1",
        "g1",
        [_field("numbers", ["0400", "5000"], ["0400", "10000"])],
        title="Equipment over 5,000 goes to capex account 0400.",
    )
    out = questions(d)
    assert out["a"][0]["text"] == (
        'On "Equipment over 5,000 goes to capex account 0400", you went with 5,000; '
        "in another session it was 10,000. Which holds, and when?"
    )
    assert "you went with 10,000; in another session it was 5,000." in out["b"][0]["text"]
    # A side with nothing of its own keeps its full list.
    d = _differs("guardrails", "g1", "g1", [_field("numbers", ["0400", "5000"], ["5000"])])
    out = questions(d)
    assert out["a"][0]["text"].startswith("On this rule, you went with 0400; ")
    assert "in another session it was 5,000." in out["a"][0]["text"]
    assert out["b"][0]["text"].startswith("On this rule, you went with 5,000; ")
    assert "in another session it was 0400." in out["b"][0]["text"]
    # One side without numbers: the empty-side templates as before.
    d = _differs("guardrails", "g1", "g1", [_field("numbers", ["5000"], None, "missing_b")])
    out = questions(d)
    assert out["b"][0]["text"] == (
        "On this rule, in another session the number here was 5,000. Is there one for you?"
    )


def test_a_second_hard_field_adds_one_sentence():
    d = _differs(
        "guardrails",
        "g1",
        "g1",
        [_field("ask_whom", "the controller", "Petra"), _field("numbers", ["5000"], ["10000"])],
    )
    out = questions(d)
    assert out["a"][0]["field"] == out["b"][0]["field"] == "numbers"
    assert out["a"][0]["text"] == (
        "On this rule, you went with 5,000; in another session it was 10,000. "
        "Which holds, and when? The person to ask differs too."
    )
    assert out["b"][0]["text"].endswith("Which holds, and when? The person to ask differs too.")
    assert out["a"][0]["id"] == "guardrails:g1:g1:numbers"


def test_no_extra_sentence_for_a_reworded_field():
    d = _differs(
        "steps",
        "s2",
        "s2",
        [_field("decision", "Coded to capex.", "Kept opex."), _field("judgment", True, False)],
    )
    out = questions(d)
    assert out["a"][0]["field"] == "judgment"
    assert out["a"][0]["text"] == (
        "On this step, you treat this as a judgment call; in another session it was routine. Why?"
    )
    d = _differs(
        "guardrails",
        "g1",
        "g1",
        [
            _field("applies_when", "the invoice is big", None, "missing_b"),
            _field("numbers", ["5000"], ["10000"]),
        ],
    )
    assert questions(d)["a"][0]["text"].endswith("Which holds, and when?")


def test_only_one_extra_sentence_with_three_hard_fields():
    d = _differs(
        "guardrails",
        "g1",
        "g1",
        [
            _field("kind", "limit", "stop_and_ask"),
            _field("ask_whom", "the controller", "Petra"),
            _field("numbers", ["5000"], ["10000"]),
        ],
    )
    [qa] = questions(d)["a"]
    assert qa["field"] == "numbers"
    assert qa["text"].endswith("Which holds, and when? The kind of rule differs too.")
    assert qa["text"].count("too.") == 1


def _rules_on_a_step(ids_a, ids_b, rules_a):
    d = _differs("steps", "s2", "s2", [_field("guardrails", ids_a, ids_b)], title="Code it")
    d["guardrails"] = {
        "same": [],
        "differs": [],
        "only_a": [{"id": g, "title": t, "words": _words()} for g, t in rules_a.items()],
        "only_b": [],
    }
    return d


def test_rules_on_a_step_are_named():
    d = _rules_on_a_step(
        ["g1", "g2"],
        None,
        {
            "g1": "Equipment over 5,000 goes to capex account 0400.",
            "g2": "Never pay an unlisted vendor.",
        },
    )
    [qa] = [q for q in questions(d)["a"] if q["section"] == "steps"]
    assert qa["text"] == (
        'On "Code it", you had "Equipment over 5,000 goes to capex account 0400" and '
        '"Never pay an unlisted vendor" here; in another session there were none. '
        "Why do they matter here?"
    )
    [qb] = questions(d)["b"]
    assert qb["text"] == (
        'On "Code it", in another session "Equipment over 5,000 goes to capex account 0400" and '
        '"Never pay an unlisted vendor" applied here. Do any apply for you?'
    )


def test_more_than_two_rules_and_rules_without_a_name():
    long = "Anything over five thousand euros is a fixed asset unless it is a licence"
    d = _rules_on_a_step(
        ["g1", "g2", "g3"], ["g9"], {"g1": long, "g2": "Never pay an unlisted vendor", "g3": "X"}
    )
    [qa] = [q for q in questions(d)["a"] if q["section"] == "steps"]
    assert qa["text"].startswith(
        'On "Code it", you had "Anything over five thousand euros is a fixed asset...", '
        '"Never pay an unlisted vendor" and 1 more here;'
    )
    [qb] = questions(d)["b"]
    # b's rule g9 has no name anywhere in the diff: counted, not named.
    assert qb["text"].startswith('On "Code it", you had one rule here;')
    # A rule without a name next to named ones counts toward "N more".
    d = _rules_on_a_step(["g1", "g7", "g2"], None, {"g1": "Rule one", "g2": "Rule two"})
    [qa] = [q for q in questions(d)["a"] if q["section"] == "steps"]
    assert 'you had "Rule one", "Rule two" and 1 more here;' in qa["text"]
    d = _rules_on_a_step(["g7", "g8"], None, {})
    [qa] = questions(d)["a"]
    assert qa["text"].startswith('On "Code it", you had 2 rules here;')


def _rule_on_a_step(step_a, step_b, titles_a, titles_b):
    d = _differs("guardrails", "g1", "g1", [_field("step", step_a, step_b)], title="Ask Petra")
    d["steps"] = {
        "same": [],
        "differs": [],
        "only_a": [{"id": s, "title": t, "words": _words()} for s, t in titles_a.items()],
        "only_b": [{"id": s, "title": t, "words": _words()} for s, t in titles_b.items()],
    }
    return d


def test_the_step_a_rule_comes_in_at_is_named():
    d = _rule_on_a_step(
        "s2",
        "s4",
        {"s2": "Code the cost account"},
        {"s4": "Approve the invoice for payment"},
    )
    out = questions(d)
    [qa] = [q for q in out["a"] if q["section"] == "guardrails"]
    assert qa["text"] == (
        'On "Ask Petra", you tied this rule to "Code the cost account"; in another session it '
        'came in at "Approve the invoice for payment". Where does it come in, and why?'
    )
    [qb] = [q for q in out["b"] if q["section"] == "guardrails"]
    assert qb["text"] == (
        'On "Ask Petra", you tied this rule to "Approve the invoice for payment"; in another '
        'session it came in at "Code the cost account". Where does it come in, and why?'
    )
    d = _rule_on_a_step("s2", None, {"s2": "Code the cost account"}, {})
    out = questions(d)
    [qb] = [q for q in out["b"] if q["section"] == "guardrails"]
    assert qb["text"] == (
        'On "Ask Petra", in another session this rule came in at "Code the cost account". '
        "Where does it come in for you?"
    )


def test_the_step_without_titles_keeps_the_old_wording():
    d = _differs("guardrails", "g1", "g1", [_field("step", "s2", "s4")], title="Ask Petra")
    [qa] = questions(d)["a"]
    assert qa["text"] == (
        'On "Ask Petra", in another session this rule came in at a different step. '
        "Where does it come in for you, and why?"
    )
    # Only one side has a title: both sides keep the old wording.
    d = _rule_on_a_step("s2", "s4", {"s2": "Code the cost account"}, {})
    [qa] = [q for q in questions(d)["a"] if q["section"] == "guardrails"]
    assert "a different step" in qa["text"]
    d = _rule_on_a_step("s2", None, {}, {})
    [qa] = [q for q in questions(d)["a"] if q["section"] == "guardrails"]
    assert qa["text"] == (
        'On "Ask Petra", you tied this rule to a step; in another session it wasn\'t tied to one. '
        "Why there?"
    )
