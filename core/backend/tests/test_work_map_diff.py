"""Diff of two experts' Work Maps of the same task: pure, no LLM."""

import copy

from src.services import work_map_diff
from src.services.work_map_diff import diff, similarity


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


def _ids(lst, key="a"):
    return [item[key] for item in lst]


def test_identical_maps_are_all_same():
    out = diff(_map(), _map())
    assert _ids(out["steps"]["same"]) == ["s1", "s2", "s3"]
    assert _ids(out["steps"]["same"], "b") == ["s1", "s2", "s3"]
    assert _ids(out["guardrails"]["same"]) == ["g1", "g2"]
    for part in ("steps", "guardrails"):
        assert out[part]["differs"] == out[part]["only_a"] == out[part]["only_b"] == []
    assert out["steps"]["same"][0] == {
        "a": "s1",
        "b": "s1",
        "title": "Open the invoice",
        "score": 1.0,
    }


def test_reordered_steps_still_match():
    b = _map()
    b["steps"] = [b["steps"][2], b["steps"][0], b["steps"][1]]
    out = diff(_map(), b)
    pairs = {(p["a"], p["b"]) for p in out["steps"]["same"]}
    assert pairs == {("s1", "s1"), ("s2", "s2"), ("s3", "s3")}
    assert out["steps"]["only_a"] == out["steps"]["only_b"] == []


def test_reworded_step_still_matches():
    b = _map()
    b["steps"][1].update(
        id="x2",
        title="Book to the right account",
        decision="Moved it to capex 0400.",
        quote_translation="Anything above 5000 is an asset.",
    )
    out = diff(_map(), b)
    pairs = [(p["a"], p["b"]) for p in out["steps"]["same"] + out["steps"]["differs"]]
    assert ("s2", "x2") in pairs
    assert out["steps"]["only_a"] == out["steps"]["only_b"] == []


def test_changed_threshold_is_a_difference():
    b = _map()
    b["guardrails"][0].update(applies_when="the invoice is over 5,000")
    out = diff(_map(), b)
    [d] = out["guardrails"]["differs"]
    assert (d["a"], d["b"]) == ("g1", "g1")
    assert d["fields"] == [{"field": "numbers", "kind": "changed", "a": ["10000"], "b": ["5000"]}]
    assert d["words_a"] == {
        "quote": "Über 10.000 frage ich immer Petra.",
        "quote_translation": "Over 10,000 I always ask Petra.",
        "reason": "",
    }


def test_different_ask_whom():
    b = _map()
    b["guardrails"][0].update(ask_whom="Petra in accounting")
    out = diff(_map(), b)
    [d] = out["guardrails"]["differs"]
    assert d["fields"] == [
        {"field": "ask_whom", "kind": "changed", "a": "the controller", "b": "Petra in accounting"}
    ]


def test_rewording_alone_is_not_a_difference():
    b = _map()
    b["guardrails"][0].update(ask_whom="Controller", applies_when="The invoice is over 10000!")
    b["steps"][2].update(decision="applied  reverse-charge")
    out = diff(_map(), b)
    assert out["guardrails"]["differs"] == out["steps"]["differs"] == []


def test_step_and_guardrail_only_one_expert_has():
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
    out = diff(b, _map())
    assert out["steps"]["only_a"] == [
        {
            "id": "s9",
            "title": "Attach the delivery note",
            "words": {
                "quote": "Der Lieferschein muss dran.",
                "quote_translation": "The delivery note has to be attached.",
                "reason": "Audit wants proof of receipt.",
            },
        }
    ]
    assert out["guardrails"]["only_a"] == [
        {
            "id": "g7",
            "title": "Never pay a supplier without a bank check.",
            "words": {"quote": "", "quote_translation": "", "reason": ""},
        }
    ]
    assert out["steps"]["only_b"] == out["guardrails"]["only_b"] == []
    assert _ids(out["steps"]["same"]) == ["s1", "s2", "s3"]


def test_field_left_empty_is_missing_not_changed():
    b = _map()
    b["steps"][2]["reason"] = None
    b["guardrails"][0]["ask_whom"] = ""
    out = diff(_map(), b)
    [step] = out["steps"]["differs"]
    assert step["fields"] == [
        {
            "field": "reason",
            "kind": "missing_b",
            "a": "The supplier is in another EU country.",
            "b": None,
        }
    ]
    [guard] = out["guardrails"]["differs"]
    assert guard["fields"] == [
        {"field": "ask_whom", "kind": "missing_b", "a": "the controller", "b": None}
    ]


def test_narration_is_not_quoted_as_the_experts_reason():
    b = _map()
    b["steps"][0]["decision"] = "Downloaded the PDF from the supplier portal."
    out = diff(_map(), b)
    [d] = out["steps"]["differs"]
    assert d["fields"][0]["field"] == "decision"
    assert d["words_a"] == {"quote": "", "quote_translation": "", "reason": ""}


def test_changed_decision_judgment_and_attached_guardrails():
    b = _map()
    b["steps"][2].update(decision="Charged local VAT.", judgment=False)
    b["guardrails"][0]["step"] = "s2"
    out = diff(_map(), b)
    by_id = {d["a"]: d for d in out["steps"]["differs"]}
    assert [f["field"] for f in by_id["s3"]["fields"]] == ["decision", "judgment", "guardrails"]
    assert by_id["s3"]["fields"][2] == {
        "field": "guardrails",
        "kind": "missing_b",
        "a": ["g1"],
        "b": None,
    }
    assert by_id["s2"]["fields"] == [
        {"field": "guardrails", "kind": "changed", "a": ["g2"], "b": ["g1", "g2"]}
    ]
    [g] = out["guardrails"]["differs"]
    assert g["fields"] == [{"field": "step", "kind": "changed", "a": "s3", "b": "s2"}]


def test_older_maps_with_step_field_and_no_ids():
    a = _map()
    b = _map()
    for m in (a, b):
        for s in m["steps"]:
            s["step"] = s.pop("title")
            del s["id"]
        for g in m["guardrails"]:
            del g["id"]
            g["step"] = None
    b["steps"].pop(0)
    out = diff(a, b)
    assert [(p["a"], p["b"]) for p in out["steps"]["same"]] == [("s2", "s1"), ("s3", "s2")]
    assert out["steps"]["same"][0]["title"] == "Code the cost account"
    assert out["steps"]["only_a"][0]["id"] == "s1"
    assert out["steps"]["only_a"][0]["title"] == "Open the invoice"
    assert _ids(out["guardrails"]["same"]) == ["g1", "g2"]


def test_empty_and_missing_parts():
    empty = {"steps": [], "guardrails": []}
    out = diff(empty, {})
    for part in ("steps", "guardrails"):
        assert out[part] == {"same": [], "differs": [], "only_a": [], "only_b": []}
    out = diff({"steps": None}, _map())
    assert _ids(out["steps"]["only_b"], "id") == ["s1", "s2", "s3"]
    assert _ids(out["guardrails"]["only_b"], "id") == ["g1", "g2"]


def test_none_fields_everywhere():
    blank = {"steps": [{"title": None, "decision": None}], "guardrails": [{"rule": None}]}
    out = diff(blank, copy.deepcopy(blank))
    # Nothing to compare by, so nothing is called the same.
    assert _ids(out["steps"]["only_a"], "id") == ["s1"]
    assert out["steps"]["only_a"][0]["words"] == {
        "quote": "",
        "quote_translation": "",
        "reason": "",
    }
    assert _ids(out["guardrails"]["only_b"], "id") == ["g1"]


def test_inputs_are_not_changed():
    a, b = _map(), _map()
    b["steps"].reverse()
    b["guardrails"][0]["applies_when"] = "over 5,000"
    a_before, b_before = copy.deepcopy(a), copy.deepcopy(b)
    diff(a, b)
    assert a == a_before and b == b_before


def test_similarity():
    a = "Ask before posting a large invoice over 10,000"
    b = "Check the VAT because the supplier is in another EU country"
    assert similarity(a, a) == 1.0
    assert similarity(a, b) == similarity(b, a)
    assert similarity(a, b) < work_map_diff.RULE_MATCH
    assert (
        similarity("Ask before posting a large invoice", "Ask before posting a big invoice") > 0.5
    )
    # Numbers don't count toward likeness; they are compared on their own.
    assert similarity("Rule over 5,000", "Rule over 10,000") == 1.0
    assert work_map_diff.numbers("over five thousand", "or €10,000") == ["5000", "10000"]
    assert similarity("", "") == similarity("", a) == 0.0
    assert similarity("请问发票", "请问发票") == 1.0


def _step(sid, title, decision, reason, **more):
    return {"id": sid, "title": title, "decision": decision, "reason": reason, **more}


def _invoice_a() -> dict:
    """One expert's invoice map."""
    return {
        "steps": [
            _step(
                "s1",
                "Check the supplier",
                "Looked up Müller GmbH in the vendor master.",
                "We only pay suppliers we know.",
            ),
            _step(
                "s2",
                "Match the PO",
                "Matched the invoice lines to PO 4500123 and the goods receipt.",
                "Quantities must agree before we pay.",
            ),
            _step(
                "s3",
                "Code the invoice",
                "Coded it to capex account 0400.",
                "Anything over 5,000 is a fixed asset.",
            ),
            _step(
                "s4",
                "Check the VAT",
                "Applied reverse charge.",
                "The supplier is in another EU country.",
            ),
            _step(
                "s5",
                "Get approval",
                "Sent it to the controller for approval.",
                "Over 10,000 needs a second signature.",
            ),
            _step(
                "s6",
                "Post the invoice",
                "Posted it and scheduled the payment for the due date.",
                "Paying early gains us nothing.",
            ),
        ],
        "guardrails": [
            {
                "id": "g1",
                "kind": "stop_and_ask",
                "rule": "Ask before posting a large invoice.",
                "applies_when": "the invoice is over 10,000",
                "ask_whom": "the controller",
                "step": "s5",
            },
            {
                "id": "g2",
                "kind": "limit",
                "rule": "Never pay an invoice without a purchase order.",
                "step": "s2",
            },
            {
                "id": "g3",
                "kind": "exception",
                "rule": "Software licences stay opex.",
                "applies_when": "the item is a software licence",
                "step": "s3",
            },
        ],
    }


def _invoice_b() -> dict:
    """A second expert's map of the same task, in their own words."""
    return {
        "steps": [
            _step(
                "s1",
                "Verify the vendor",
                "Searched the vendor list for the company.",
                "Unknown vendors are a fraud risk.",
            ),
            _step(
                "s2",
                "Three-way match",
                "Compared the invoice with the purchase order and the delivery.",
                "Amounts and quantities have to line up.",
            ),
            _step(
                "s3",
                "Assign the cost center",
                "Booked it to capex account 0400.",
                "Anything above 5000 counts as a fixed asset.",
            ),
            _step(
                "s4",
                "Review the tax",
                "Used the reverse charge.",
                "Supplier is based in another EU country.",
            ),
            _step(
                "s5",
                "Approval",
                "Forwarded it to the head of finance to approve.",
                "Above 5,000 a second signature is needed.",
            ),
            _step(
                "s6",
                "Post and schedule payment",
                "Posted it and set the payment run for the due date.",
                "Pay on the due date.",
            ),
        ],
        "guardrails": [
            {
                "id": "g1",
                "kind": "stop_and_ask",
                "rule": "Get sign-off on big invoices.",
                "applies_when": "the invoice amount is above 5,000",
                "ask_whom": "the head of finance",
                "step": "s5",
            },
            {
                "id": "g2",
                "kind": "limit",
                "rule": "Never pay without a PO number.",
                "step": "s2",
            },
            {
                "id": "g3",
                "kind": "exception",
                "rule": "Licences for software are opex.",
                "applies_when": "the item is a software licence",
                "step": "s3",
            },
        ],
    }


def _pairs(part):
    return sorted((p["a"], p["b"]) for p in part["same"] + part["differs"])


def test_paraphrased_maps_pair_every_step():
    out = diff(_invoice_a(), _invoice_b())
    assert _pairs(out["steps"]) == [(f"s{n}", f"s{n}") for n in range(1, 7)]
    assert _pairs(out["guardrails"]) == [("g1", "g1"), ("g2", "g2"), ("g3", "g3")]
    for part in ("steps", "guardrails"):
        assert out[part]["only_a"] == out[part]["only_b"] == []
    # Reworded decisions and reasons with the same numbers are the same.
    assert {"s3", "s4"} <= {p["a"] for p in out["steps"]["same"]}
    differs = {d["a"]: d for d in out["guardrails"]["differs"]}
    fields = {f["field"]: f for f in differs["g1"]["fields"]}
    assert fields["numbers"] == {
        "field": "numbers",
        "kind": "changed",
        "a": ["10000"],
        "b": ["5000"],
    }
    assert fields["ask_whom"]["kind"] == "changed"
    assert "rule" not in fields and "applies_when" not in fields
    assert {g["a"] for g in out["guardrails"]["same"]} == {"g2", "g3"}


def test_capex_vs_opex_is_a_difference():
    b = _invoice_b()
    b["steps"][2]["decision"] = "Booked it to opex account 4711."
    out = diff(_invoice_a(), b)
    [d] = [d for d in out["steps"]["differs"] if d["a"] == "s3"]
    assert [f["field"] for f in d["fields"]] == ["decision"]


def test_german_maps_with_step_titles():
    a = {
        "steps": [
            {"step": "Rechnung öffnen", "decision": "Rechnung aus dem Postfach geöffnet."},
            {"step": "Lieferant prüfen", "decision": "Lieferant in den Stammdaten gesucht."},
            {
                "step": "Konto kontieren",
                "decision": "Auf das Anlagenkonto 0400 gebucht.",
                "reason": "Alles über 5.000 ist Anlagevermögen.",
            },
            {"step": "Rechnung buchen", "decision": "Rechnung gebucht und Zahlung geplant."},
        ]
    }
    b = {
        "steps": [
            {"step": "Beleg aufmachen", "decision": "Die Rechnung im Posteingang geöffnet."},
            {"step": "Kreditor checken", "decision": "Kreditor in den Stammdaten nachgeschlagen."},
            {
                "step": "Kontierung",
                "decision": "Als Anlagevermögen auf 0400 kontiert.",
                "reason": "Ab 5.000 ist es Anlagevermögen.",
            },
            {"step": "Buchen", "decision": "Gebucht und die Zahlung eingeplant."},
        ]
    }
    out = diff(a, b)
    assert _pairs(out["steps"]) == [(f"s{n}", f"s{n}") for n in range(1, 5)]


def test_split_step_pairs_one_half():
    a = {
        "steps": [
            _step("s1", "Open the invoice", "Opened the invoice.", ""),
            _step(
                "s2",
                "Code the invoice",
                "Set the cost center to marketing.",
                "The campaign budget pays for it.",
            ),
            _step("s3", "Post the invoice", "Posted it.", ""),
        ]
    }
    b = {
        "steps": [
            _step("s1", "Open the invoice", "Opened the invoice.", ""),
            _step("s2", "Pick the GL account", "Chose GL account 6300.", "It is a service."),
            _step(
                "s3",
                "Pick the cost center",
                "Chose cost center marketing.",
                "Marketing's budget pays.",
            ),
            _step("s4", "Post the invoice", "Posted it.", ""),
        ]
    }
    out = diff(a, b)
    assert _pairs(out["steps"]) == [("s1", "s1"), ("s2", "s3"), ("s3", "s4")]
    assert _ids(out["steps"]["only_b"], "id") == ["s2"]


def test_never_vs_always_and_over_vs_under():
    a, b = _invoice_a(), _invoice_a()
    b["guardrails"][1]["rule"] = "Always pay an invoice without a purchase order."
    b["guardrails"][0]["applies_when"] = "the invoice is under 10,000"
    out = diff(a, b)
    differs = {d["a"]: d["fields"] for d in out["guardrails"]["differs"]}
    assert differs["g2"] == [
        {
            "field": "rule",
            "kind": "changed",
            "a": "Never pay an invoice without a purchase order.",
            "b": "Always pay an invoice without a purchase order.",
        }
    ]
    assert [f["field"] for f in differs["g1"]] == ["applies_when"]


def test_not_approve_is_a_difference():
    a, b = _invoice_a(), _invoice_a()
    b["steps"][4]["decision"] = "Did not send it to the controller for approval."
    out = diff(a, b)
    [d] = out["steps"]["differs"]
    assert d["fields"][0]["field"] == "decision"


def test_equal_crossing_pairs_mirror():
    a = {"steps": [{"title": "Check supplier bank account"}, {"title": "Check tax code"}]}
    b = {"steps": [{"title": "Verify tax code"}, {"title": "Verify supplier bank details"}]}
    ab, ba = diff(a, b)["steps"], diff(b, a)["steps"]
    assert _pairs(ab) == [(y, x) for x, y in _pairs(ba)]
    assert _ids(ab["only_a"], "id") == _ids(ba["only_b"], "id")
    assert _ids(ab["only_b"], "id") == _ids(ba["only_a"], "id")


def test_dropping_before_is_rewording_not_a_new_rule():
    a, b = _invoice_a(), _invoice_a()
    b["guardrails"][0]["rule"] = "Get sign-off on big invoices"
    out = diff(a, b)
    assert ("g1", "g1") in _pairs(out["guardrails"])
    assert out["guardrails"]["differs"] == []
