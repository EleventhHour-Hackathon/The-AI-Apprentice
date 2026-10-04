"""Updating a Work Map from a repeat session of the same task: pure, no LLM."""

import copy

from src.services.work_map_update import MAX_GAPS, _question, update


def _parent() -> dict:
    return {
        "id": "m1",
        "task": "Code a supplier invoice",
        "transcript": "first session",
        "steps": [
            {
                "id": "s1",
                "title": "Open the invoice",
                "decision": "Opened invoice 4711 from the inbox.",
                "reason": "",
                "judgment": False,
                "at": 4.0,
                "quote": "Ich mache erst mal die Rechnung auf.",
                "quote_kind": "narration",
                "quote_translation": "First I open the invoice.",
            },
            {
                "id": "s2",
                "title": "Code the cost account",
                "decision": "Re-coded from opex to capex 0400.",
                "reason": "Anything over 5,000 is a fixed asset.",
                "judgment": True,
                "at": 31.5,
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
                "at": 62.0,
                "quote": None,
                "quote_kind": "none",
            },
            {
                "id": "s4",
                "title": "Print a copy for the binder",
                "decision": "Printed the invoice and filed the paper copy.",
                "reason": "The auditor wanted paper.",
                "judgment": False,
                "at": 80.0,
                "quote": "",
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
                "at": 70.0,
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
                "at": 40.0,
                "quote": "",
            },
        ],
        "open_questions": ["Who signs off travel costs?"],
    }


def _repeat() -> dict:
    """The same expert a week later: one decision changed, a step added, a new threshold, and
    the paper copy dropped."""
    new = copy.deepcopy(_parent())
    new.update(id="m2", transcript="second session")
    s1, s2, s3, _s4 = new["steps"]
    s2.update(decision="Booked it as opex 4400.", at=12.0, quote="Ist jetzt Aufwand.")
    for step in (s1, s2, s3):
        step["at"] = (step["at"] or 0) + 100
    s3["id"] = "s4"
    added = {
        "id": "s3",
        "title": "Check the purchase order",
        "decision": "Matched the invoice against PO 8812.",
        "reason": "No PO, no payment.",
        "judgment": False,
        "at": 140.0,
        "quote": "Ohne Bestellung keine Zahlung.",
    }
    new["steps"] = [s1, s2, added, s3]
    g1, g2 = new["guardrails"]
    g1.update(applies_when="the invoice is over 5,000", step="s4", at=170.0)
    new["open_questions"] = ["  ", "who signs off travel costs?", "Is 4400 the right account?"]
    return new


def _expected_invoice_changes():
    return {
        "new": [{"section": "steps", "id": "s5", "title": "Check the purchase order"}],
        "changed": [
            {
                "section": "steps",
                "id": "s2",
                "title": "Code the cost account",
                "fields": ["decision"],
            },
            {
                "section": "guardrails",
                "id": "g1",
                "title": "Ask before posting a large invoice.",
                "fields": ["numbers"],
            },
        ],
        "removed": [{"section": "steps", "id": "s4", "title": "Print a copy for the binder"}],
        "unchanged": [
            {"section": "steps", "id": "s1", "title": "Open the invoice"},
            {"section": "steps", "id": "s3", "title": "Check the VAT"},
            {"section": "guardrails", "id": "g2", "title": "Software licences stay opex"},
        ],
    }


def test_invoice_repeat_session():
    parent, new = _parent(), _repeat()
    before = (copy.deepcopy(parent), copy.deepcopy(new))
    out = update(parent, new)
    assert (parent, new) == before  # inputs untouched

    assert out["changes"] == _expected_invoice_changes()
    assert out["gaps"] == [
        "Last time you 'Re-coded from opex to capex 0400'; now you 'Booked it as opex 4400'."
        " What changed?",
        "This time you 'Matched the invoice against PO 8812'. What made you add that?",
        "Last time you 'Printed the invoice and filed the paper copy'. Do you still do that?",
        "Last time the number in 'Ask before posting a large invoice' was 10,000; now it's 5,000."
        " What changed?",
    ]

    m = out["map"]
    assert (m["id"], m["task"], m["transcript"]) == (
        "m2",
        "Code a supplier invoice",
        "second session",
    )
    assert [(s["id"], s["source"]) for s in m["steps"]] == [
        ("s1", "parent"),
        ("s2", "new"),
        ("s5", "new"),
        ("s3", "parent"),
        ("s4", "parent"),
    ]
    s1, s2, s5, s3, s4 = m["steps"]
    # Unchanged steps keep the parent's moment and words.
    assert s1 == {**parent["steps"][0], "source": "parent"}
    assert s3 == {**parent["steps"][2], "source": "parent"}
    # A changed step is the new version under the parent's id.
    assert s2 == {**new["steps"][1], "id": "s2", "source": "new", "changed": ["decision"]}
    assert s5["added"] is True and s5["at"] == 140.0
    assert s4 == {**parent["steps"][3], "source": "parent", "removed": True}
    g1, g2 = m["guardrails"]
    # The new g1 pointed at the new session's "s4", which is the parent's s3.
    assert (g1["id"], g1["source"], g1["changed"], g1["step"]) == ("g1", "new", ["numbers"], "s3")
    assert g1["applies_when"] == "the invoice is over 5,000"
    assert g2 == {**parent["guardrails"][1], "source": "parent"}
    assert m["open_questions"] == out["gaps"] + [
        "who signs off travel costs?",
        "Is 4400 the right account?",
    ]


def test_identical_maps_change_nothing():
    out = update(_parent(), _parent())
    assert out["gaps"] == []
    assert out["changes"]["new"] == out["changes"]["changed"] == out["changes"]["removed"] == []
    assert [c["id"] for c in out["changes"]["unchanged"]] == ["s1", "s2", "s3", "s4", "g1", "g2"]
    assert out["map"]["steps"] == [{**s, "source": "parent"} for s in _parent()["steps"]]
    assert out["map"]["guardrails"] == [{**g, "source": "parent"} for g in _parent()["guardrails"]]
    assert out["map"]["open_questions"] == ["Who signs off travel costs?"]


def test_parent_without_steps_makes_everything_new():
    parent = {"task": "Code a supplier invoice", "steps": [], "guardrails": []}
    new = _parent()
    new["task"] = "  "
    out = update(parent, new)
    m = out["map"]
    assert m["task"] == "Code a supplier invoice"
    assert [s["id"] for s in m["steps"]] == ["s1", "s2", "s3", "s4"]
    assert all(s["added"] and s["source"] == "new" for s in m["steps"] + m["guardrails"])
    # Rules follow their new steps to the fresh ids.
    assert [g["step"] for g in m["guardrails"]] == ["s3", "s2"]
    assert len(out["changes"]["new"]) == 6
    assert out["changes"]["unchanged"] == out["changes"]["removed"] == []
    assert len(out["gaps"]) == 6
    assert (
        out["gaps"][0]
        == "This time you 'Opened invoice 4711 from the inbox'. What made you add that?"
    )
    assert out["gaps"][4] == (
        "This time you said 'Ask before posting a large invoice'. When does that apply?"
    )


def test_new_map_without_steps_removes_everything():
    new = {"task": "Code a supplier invoice", "steps": [], "guardrails": [], "open_questions": []}
    out = update(_parent(), new)
    m = out["map"]
    assert [s["id"] for s in m["steps"]] == ["s1", "s2", "s3", "s4"]
    assert all(it["removed"] and it["source"] == "parent" for it in m["steps"] + m["guardrails"])
    # Removed steps stay in the map, so the removed rules still point at them.
    assert [g["step"] for g in m["guardrails"]] == ["s3", "s2"]
    assert out["changes"]["new"] == out["changes"]["changed"] == out["changes"]["unchanged"] == []
    assert len(out["changes"]["removed"]) == 6
    assert (
        out["gaps"][-1]
        == "Last time you said 'Software licences stay opex'. Does that still apply?"
    )


def test_items_without_ids_get_positional_ids():
    parent, new = _parent(), _repeat()
    for m in (parent, new):
        for item in m["steps"] + m["guardrails"]:
            item.pop("id")
    for g in parent["guardrails"]:
        g["step"] = {"s3": "s3", "s2": "s2"}[g["step"]]
    new["guardrails"][0]["step"] = "s4"  # the VAT step is 4th in the repeat
    out = update(parent, new)
    assert [s["id"] for s in out["map"]["steps"]] == ["s1", "s2", "s5", "s3", "s4"]
    assert [g["id"] for g in out["map"]["guardrails"]] == ["g1", "g2"]
    assert [g["step"] for g in out["map"]["guardrails"]] == ["s3", "s2"]
    assert out["changes"]["new"] == [
        {"section": "steps", "id": "s5", "title": "Check the purchase order"}
    ]


def test_new_rule_on_a_new_step_points_at_its_fresh_id():
    new = _parent()
    new["steps"].append(
        {
            "id": "s9",
            "title": "Check the purchase order",
            "decision": "Matched the invoice against PO 8812.",
            "judgment": False,
        }
    )
    new["guardrails"].append(
        {
            "id": "g7",
            "kind": "limit",
            "rule": "Never pay without a purchase order",
            "step": "s9",
        }
    )
    out = update(_parent(), new)
    step = out["map"]["steps"][-1]
    guard = out["map"]["guardrails"][-1]
    assert (step["id"], step["added"]) == ("s5", True)
    assert (guard["id"], guard["added"], guard["step"]) == ("g3", True, "s5")
    assert out["gaps"] == [
        "This time you 'Matched the invoice against PO 8812'. What made you add that?",
        "This time you said 'Never pay without a purchase order'. When does that apply?",
    ]


def test_fresh_ids_sit_above_the_parents_highest():
    parent = _parent()
    parent["steps"][0]["id"] = "s12"
    new = _parent()
    new["steps"][0]["id"] = "s12"
    new["steps"].append({"id": "s5", "title": "Archive the invoice", "decision": "Archived it."})
    out = update(parent, new)
    assert out["map"]["steps"][-1]["id"] == "s13"


def test_unresolved_rule_step_becomes_empty():
    new = _parent()
    new["guardrails"].append({"id": "g3", "kind": "limit", "rule": "Never pay twice", "step": "zz"})
    out = update(_parent(), new)
    assert out["map"]["guardrails"][-1]["step"] == ""


def test_rule_on_a_removed_step_keeps_pointing_at_it():
    new = _parent()
    del new["steps"][1]  # drop "Code the cost account"; g2 is not said again either
    del new["guardrails"][1]
    out = update(_parent(), new)
    g2 = out["map"]["guardrails"][-1]
    assert (g2["id"], g2["removed"], g2["step"]) == ("g2", True, "s2")
    assert out["map"]["steps"][-1]["id"] == "s2" and out["map"]["steps"][-1]["removed"]


def test_gaps_are_capped_steps_first():
    parent = {"task": "t", "steps": [], "guardrails": []}
    new = {
        "task": "t",
        "steps": [
            {"id": f"s{i}", "title": f"Step {w}", "decision": f"Did the {w} thing"}
            for i, w in enumerate(
                ["alpha", "bravo", "charlie", "delta", "echo", "fox", "golf", "hotel", "india"], 1
            )
        ],
        "guardrails": [{"id": "g1", "kind": "limit", "rule": "Never skip the kilo check"}],
    }
    out = update(parent, new)
    assert MAX_GAPS == 8
    assert len(out["gaps"]) == MAX_GAPS
    assert all(g.startswith("This time you 'Did the") for g in out["gaps"])
    assert out["map"]["open_questions"] == out["gaps"]


def test_only_guardrails_changed_on_a_step_asks_about_the_rule_only():
    new = _parent()
    new["guardrails"][1]["step"] = "s1"  # the licence rule moves to "Open the invoice"
    out = update(_parent(), new)
    changed = {(c["section"], c["id"]): c["fields"] for c in out["changes"]["changed"]}
    assert changed[("steps", "s2")] == ["guardrails"]
    assert changed[("guardrails", "g2")] == ["step"]
    assert out["gaps"] == [
        "Last time 'Software licences stay opex' came up at 'Code the cost account'; now at"
        " 'Open the invoice'. What changed?"
    ]


def test_question_wording_per_field():
    step = {"title": "Check the VAT", "decision": "Applied reverse charge."}
    rule = {"rule": "Ask before posting a large invoice"}
    assert (
        _question("steps", "changed", step, step, {"field": "judgment", "a": False, "b": True})
        == "Last time 'Applied reverse charge' was routine; now it's a judgment call."
        " What changed?"
    )
    assert _question(
        "steps", "changed", step, step, {"field": "reason", "a": None, "b": "EU supplier."}
    ) == ("This time your reason for 'Applied reverse charge' was 'EU supplier'. What changed?")
    assert _question(
        "guardrails",
        "changed",
        rule,
        rule,
        {"field": "kind", "a": "stop_and_ask", "b": "limit"},
    ) == (
        "Last time 'Ask before posting a large invoice' was a point to stop and ask;"
        " now it's a hard limit. What changed?"
    )
    assert _question(
        "guardrails",
        "changed",
        rule,
        rule,
        {"field": "ask_whom", "a": "the controller", "b": "Petra"},
    ) == (
        "Last time you asked 'the controller' about 'Ask before posting a large invoice';"
        " now 'Petra'. What changed?"
    )
    assert _question(
        "guardrails",
        "changed",
        {"rule": "Always ask Petra"},
        {"rule": "Never ask Petra"},
        {"field": "rule", "a": "Always ask Petra", "b": "Never ask Petra"},
    ) == ("Last time you said 'Always ask Petra'; now you say 'Never ask Petra'. What changed?")
    assert _question("steps", "removed", {}, None) == (
        "Last time you did this step. Do you still do that?"
    )
    assert all(
        q.endswith("?")
        for q in (
            _question("steps", "added", None, {"title": "x"}),
            _question("guardrails", "removed", {"rule": "y"}, None),
        )
    )
