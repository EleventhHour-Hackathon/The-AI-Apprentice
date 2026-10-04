"""The coverage check: is a screen event already in a confirmed Work Map, and the endpoint."""

import copy
import os

import pytest

# Config checks these at import; nothing real is called.
for _key in ("OPENAI_API_KEY", "ELEVENLABS_API_KEY"):
    os.environ.setdefault(_key, "test-key-not-real")
os.environ.setdefault("SUPABASE_DB_URL", "postgresql://test@localhost/test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.router import coverage_router  # noqa: E402
from src.services import coverage  # noqa: E402

INVOICE_ID = "3f2c9a1e-5b7d-4c8e-9a0b-1c2d3e4f5a6b"
TRAVEL_ID = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
DRAFT_ID = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e"
URL = "/api/v1/coverage/check"

INVOICE = {
    "id": INVOICE_ID,
    "task": "Code incoming supplier invoices",
    "status": "confirmed",
    "steps": [
        {
            "id": "s1",
            "title": "Open the supplier invoice",
            "screen": "Inbox in DATEV",
            "decision": "Pick the oldest unpaid invoice first",
        },
        {
            "id": "s2",
            "title": "Check the supplier's VAT ID",
            "screen": "Supplier master data",
            "decision": "Compare the VAT ID on the invoice with the master record",
        },
        {
            "id": "s3",
            "title": "Assign the cost centre",
            "screen": "Coding form",
            "decision": "Machine parts go to cost centre 4711",
        },
        {
            "id": "s4",
            "title": "Book the invoice in the ERP",
            "screen": "SAP posting screen",
            "decision": "Post it with the payment terms from the order",
        },
    ],
    "guardrails": [
        {
            "id": "g1",
            "rule": "Invoices over 5,000 need the plant manager's approval",
            "applies_when": "the net amount is over 5,000",
            "kind": "limit",
        },
        {
            "id": "g2",
            "rule": "Never pay an invoice without a matching purchase order",
            "applies_when": "no purchase order number on the invoice",
            "kind": "never",
        },
    ],
}
TRAVEL = {
    "id": TRAVEL_ID,
    "task": "Approve travel expense reports",
    "status": "confirmed",
    "steps": [
        {
            "id": "s1",
            "title": "Open the expense report",
            "screen": "Travel portal",
            "decision": "Start with reports waiting longest",
        },
        {
            "id": "s2",
            "title": "Check each hotel receipt",
            "screen": "Receipt viewer",
            "decision": "Hotel nights must match the trip dates",
        },
        {
            "id": "s3",
            "title": "Approve or send back the report",
            "screen": "Approval dialog",
            "decision": "Send back when a receipt is missing",
        },
    ],
    "guardrails": [
        {
            "id": "g1",
            "rule": "Meals over 50 per person need the names of the guests",
            "applies_when": "a business meal receipt",
        },
    ],
}
MAPS = [INVOICE, TRAVEL]

# The calibration of coverage.COVERED: event, verdict, and the best item's map, id and score.
INV, TRV = INVOICE_ID, TRAVEL_ID
CALIBRATION = [
    ("Open the supplier invoice from the DATEV inbox", "covered", INV, "s1", 1.0),
    ("Compared the VAT ID with the supplier master data", "covered", INV, "s2", 1.0),
    ("Assigned cost centre 4711 to the machine parts invoice", "covered", INV, "s3", 1.0),
    ("Posted the invoice in the SAP posting screen", "covered", INV, "s4", 1.0),
    ("Invoice over 5,000 sent to the plant manager for approval", "covered", INV, "g1", 1.0),
    ("Opened a hotel receipt in the receipt viewer", "covered", TRV, "s2", 1.0),
    ("Checked the VAT ID of Kovotech s.r.o. against the master data", "covered", INV, "s2", 1.0),
    ("Coded the Kovotech invoice to cost centre 4711", "covered", INV, "s3", 1.0),
    ("Opened the expense report from the Munich trip", "covered", TRV, "s1", 1.0),
    ("Sent the expense report back: taxi receipt missing", "covered", TRV, "s3", 1.0),
    (
        "Opened invoice from Bauer Hydraulik: hydraulic press, coded to 4711",
        "covered",
        INV,
        "s1",
        0.667,
    ),
    ("Opened invoice 4482 from Kovotech s.r.o.", "covered", INV, "s1", 0.667),
    ("Posted invoice 4474 from Büro Hansen", "covered", INV, "s4", 0.667),
    ("Invoice in US dollars from an American vendor", "novel", INV, "g1", 0.333),
    ("Started onboarding a new freelance translator as a supplier", "novel", INV, "s1", 0.333),
    ("Answered a GDPR data access request from a customer", "novel", INV, "s2", 0.333),
    ("Opened a credit note from Bauer Hydraulik", "novel", INV, "s1", 0.333),
    ("Changed the bank details of a supplier", "novel", INV, "s1", 0.333),
    ("Opened a dunning letter from Kovotech s.r.o.", "novel", INV, "s1", 0.333),
]


def _map(map_id, task, steps=(), guardrails=(), status="confirmed"):
    return {
        "id": map_id,
        "task": task,
        "status": status,
        "steps": list(steps),
        "guardrails": list(guardrails),
    }


# --- check -------------------------------------------------------------------------------------


@pytest.mark.parametrize("event,verdict,map_id,item_id,score", CALIBRATION)
def test_calibration(event, verdict, map_id, item_id, score):
    result = coverage.check(event, MAPS)
    assert result["verdict"] == verdict
    best = result if verdict == "covered" else result["best"]
    assert (best["work_map_id"], best["item_id"], best["score"]) == (map_id, item_id, score)
    assert (best["score"] >= coverage.COVERED) == (verdict == "covered")


@pytest.mark.parametrize(
    "words,stem",
    [
        (["open", "opens", "opened", "opening"], "open"),
        (["code", "codes", "coded", "coding"], "code"),
        (["invoice", "invoices", "invoiced"], "invoic"),
        (["post", "posted", "posting"], "post"),
        (["stop", "stopped", "stopping"], "stop"),
        (["entry", "entries"], "entry"),
        (["note", "notes", "noted"], "note"),
        (["process", "processes"], "process"),
    ],
)
def test_stem_folds_tenses_and_plurals(words, stem):
    assert {coverage.stem(w) for w in words} == {stem}


def test_stem_leaves_short_and_non_ascii_words():
    assert [coverage.stem(w) for w in ("us", "id", "vat", "rechnung", "büro")] == [
        "us",
        "id",
        "vat",
        "rechnung",
        "büro",
    ]
    assert coverage.stem("not") != coverage.stem("notes")


def test_stems_drop_numbers_stopwords_single_letters_and_possessives():
    words = coverage.stems("Opened the supplier's invoice 4482 from Kovotech s.r.o.")
    assert words == {"open", "supplier", "invoic", "kovotech"}


def test_extra_detail_in_the_event_does_not_lower_the_score():
    plain = coverage.check("Opened the supplier invoice", MAPS)
    detailed = coverage.check(
        "Opened the supplier invoice from Bauer Hydraulik for a hydraulic press, net 12,400",
        MAPS,
    )
    assert plain["score"] == detailed["score"] == 1.0
    assert (plain["item_id"], detailed["item_id"]) == ("s1", "s1")


def test_one_shared_word_is_never_enough():
    # Only "open" in common with "Open the supplier invoice" and "Open the expense report".
    assert coverage.check("Opened the weekly sales dashboard", MAPS)["verdict"] == "novel"


def test_a_short_item_is_covered_by_all_of_its_words():
    work_map = _map(TRAVEL_ID, "Travel", steps=[{"id": "s1", "title": "Scan receipts"}])
    result = coverage.check("Scanned the receipts from Munich", [work_map])
    assert (result["verdict"], result["score"]) == ("covered", 1.0)


def test_equal_scores_go_to_the_item_more_like_the_event():
    # Both steps are fully in the event; the second shares more of it as a whole.
    steps = [
        {"id": "s1", "title": "Check receipt", "decision": "Look at it carefully before moving on"},
        {"id": "s2", "title": "Check hotel receipt"},
    ]
    work_map = _map(TRAVEL_ID, "Travel", steps=steps)
    result = coverage.check("Checked the hotel receipt", [work_map])
    assert (result["item_id"], result["score"]) == ("s2", 1.0)


def test_known_limit_a_new_case_reusing_an_items_words_is_covered():
    # "open" and "supplier" are both in "Open the supplier invoice": word overlap can't tell a
    # credit note from an invoice here. Kept as a test so a better matcher shows up as a change.
    result = coverage.check("Opened a credit note from supplier Bauer", MAPS)
    assert (result["verdict"], result["item_id"], result["score"]) == ("covered", "s1", 0.667)


def test_covered_shape():
    result = coverage.check("Compared the VAT ID with the supplier master data", MAPS)
    assert result == {
        "verdict": "covered",
        "work_map_id": INVOICE_ID,
        "task": "Code incoming supplier invoices",
        "section": "steps",
        "item_id": "s2",
        "title": "Check the supplier's VAT ID",
        "score": 1.0,
    }


def test_a_rule_covers_with_its_rule_as_title():
    result = coverage.check("Invoice over 5,000 sent to the plant manager for approval", MAPS)
    assert result["section"] == "guardrails"
    assert result["title"] == "Invoices over 5,000 need the plant manager's approval"


def test_novel_shape():
    result = coverage.check("Opened a credit note from Bauer Hydraulik", MAPS)
    assert result["verdict"] == "novel"
    assert result["question"] == (
        "I haven't seen 'Opened a credit note from Bauer Hydraulik' before. How do you handle it?"
    )
    assert set(result["best"]) == {"work_map_id", "task", "section", "item_id", "title", "score"}


def test_inputs_are_not_mutated():
    maps = copy.deepcopy(MAPS)
    coverage.check("Posted the invoice in the SAP posting screen", maps)
    assert maps == MAPS


def test_ties_go_to_the_earlier_map_then_steps_then_item_order():
    rule = {"id": "g1", "rule": "Check the hotel receipt"}
    step = {"id": "s1", "title": "Check the hotel receipt"}
    later = {"id": "s2", "title": "Check the hotel receipt"}
    a = _map(INVOICE_ID, "A", guardrails=[rule])
    b = _map(TRAVEL_ID, "B", steps=[step, later])
    event = "Check the hotel receipt"
    assert coverage.check(event, [a, b])["work_map_id"] == INVOICE_ID
    assert coverage.check(event, [b, a])["work_map_id"] == TRAVEL_ID
    both = _map(INVOICE_ID, "A", steps=[step, later], guardrails=[rule])
    result = coverage.check(event, [both])
    assert (result["section"], result["item_id"]) == ("steps", "s1")


def test_removed_items_do_not_cover():
    step = {"id": "s1", "title": "Check the hotel receipt", "removed": True}
    rule = {"id": "g1", "rule": "Check the hotel receipt", "removed": True}
    work_map = _map(TRAVEL_ID, "Travel", steps=[step], guardrails=[rule])
    result = coverage.check("Check the hotel receipt", [work_map])
    assert result["verdict"] == "novel"
    assert result["best"] is None


def test_items_without_ids_are_numbered_by_position():
    steps = [{"title": "Open the expense report"}, {"title": "Check the hotel receipt"}]
    guardrails = [{"rule": "Meals need guest names"}, {"rule": "Taxi receipts need a route"}]
    work_map = _map(TRAVEL_ID, "Travel", steps=steps, guardrails=guardrails)
    assert coverage.check("Check the hotel receipt", [work_map])["item_id"] == "s2"
    assert coverage.check("Taxi receipts need a route", [work_map])["item_id"] == "g2"


def test_a_map_without_id_or_task_still_answers():
    work_map = {"steps": [{"title": "Check the hotel receipt"}]}
    result = coverage.check("Check the hotel receipt", [work_map])
    assert (result["work_map_id"], result["task"]) == ("", "")


def test_no_maps_or_no_items_is_novel_without_best():
    for maps in ([], [_map(INVOICE_ID, "Empty")]):
        result = coverage.check("Opened a credit note from Bauer Hydraulik", maps)
        assert result["verdict"] == "novel"
        assert result["best"] is None


@pytest.mark.parametrize("event", ["", "   ", "Scrolled", "Idle", "4711", "the it of", "Scrolled."])
def test_events_with_too_few_words_are_ignored(event):
    assert coverage.check(event, MAPS) == {"verdict": "ignored"}


def test_scripts_without_spaces_are_not_ignored():
    # One token is a whole phrase here; it must not be dropped as "too few words".
    assert coverage.check("打开了一张新的贷项通知单", MAPS)["verdict"] == "novel"
    assert coverage.check("ใบลดหนี้ใหม่จากซัพพลายเออร์", MAPS)["verdict"] == "novel"


def test_the_question_is_redacted_and_trimmed():
    event = "Refund to DE89 3704 0044 0532 0130 00 requested by anna.novak@example.com today"
    question = coverage.check(event, MAPS)["question"]
    assert "DE89" not in question and "anna.novak" not in question
    assert "[iban]" in question and "[email]" in question
    long = "Opened a credit note " + "with a very long description " * 10
    question = coverage.check(long, MAPS)["question"]
    label = question[len("I haven't seen '") : question.index("' before")]
    assert len(label) <= coverage.MAX_LABEL + 3 and label.endswith("...")
    assert question.endswith("before. How do you handle it?")


# --- endpoint ----------------------------------------------------------------------------------


DRAFT = _map(
    DRAFT_ID,
    "Book credit notes",
    steps=[{"id": "s1", "title": "Match the credit note to the cancelled delivery"}],
    status="draft",
)


class FakeStore:
    def __init__(self, maps):
        self.maps = {m["id"]: m for m in maps}
        self.got = []

    def list_summaries(self):
        return [
            {
                "id": m["id"],
                "task": m["task"],
                "status": m["status"],
                "confirmed": m["status"] == "confirmed",
            }
            for m in self.maps.values()
        ]

    def get(self, work_map_id):
        self.got.append(work_map_id)
        return copy.deepcopy(self.maps.get(work_map_id))


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore([INVOICE, TRAVEL, DRAFT])
    for name in ("list_summaries", "get"):
        monkeypatch.setattr(coverage_router.work_map_store, name, getattr(fake, name))
    return fake


@pytest.fixture
def client(store):  # noqa: ARG001
    app = FastAPI()
    app.include_router(coverage_router.router)
    return TestClient(app)


def test_endpoint_covered(client):
    r = client.post(URL, json={"event": "Posted the invoice in the SAP posting screen"})
    assert r.status_code == 200
    assert r.json() == {
        "verdict": "covered",
        "work_map_id": INVOICE_ID,
        "task": "Code incoming supplier invoices",
        "section": "steps",
        "item_id": "s4",
        "title": "Book the invoice in the ERP",
        "score": 1.0,
        "maps_checked": 2,
    }


def test_endpoint_novel_reads_only_confirmed_maps(client, store):
    # The draft map would cover it; it isn't confirmed, so the case is still novel.
    r = client.post(URL, json={"event": "Match the credit note to the cancelled delivery"})
    body = r.json()
    assert r.status_code == 200
    assert body["verdict"] == "novel"
    assert body["question"].startswith("I haven't seen 'Match the credit note")
    assert body["best"]["work_map_id"] != DRAFT_ID
    assert body["maps_checked"] == 2
    assert DRAFT_ID not in store.got


def test_endpoint_ignored(client):
    r = client.post(URL, json={"event": "Scrolled"})
    assert r.json() == {"verdict": "ignored", "maps_checked": 2}


def test_endpoint_redacts_the_event_first(client, monkeypatch):
    seen = []
    real = coverage.check

    def spy(event, maps):
        seen.append(event)
        return real(event, maps)

    monkeypatch.setattr(coverage_router.coverage, "check", spy)
    r = client.post(URL, json={"event": "Credit note sent by anna.novak@example.com"})
    assert seen == ["Credit note sent by [email]"]
    assert "anna.novak" not in r.text


def test_endpoint_filters_by_work_map_ids(client, store):
    event = "Opened a hotel receipt in the receipt viewer"
    r = client.post(URL, json={"event": event, "work_map_ids": [INVOICE_ID.upper()]})
    body = r.json()
    assert body["verdict"] == "novel"
    assert body["maps_checked"] == 1
    assert store.got == [INVOICE_ID]
    r = client.post(URL, json={"event": event, "work_map_ids": [TRAVEL_ID, DRAFT_ID]})
    assert r.json()["verdict"] == "covered"
    assert r.json()["maps_checked"] == 1


def test_endpoint_without_confirmed_maps(client, store):
    store.maps = {DRAFT_ID: DRAFT}
    r = client.post(URL, json={"event": "Match the credit note to the cancelled delivery"})
    assert r.json()["verdict"] == "novel"
    assert r.json()["best"] is None
    assert r.json()["maps_checked"] == 0


def test_endpoint_skips_a_map_deleted_meanwhile(client, monkeypatch):
    monkeypatch.setattr(
        coverage_router.work_map_store, "get", lambda i: None if i == TRAVEL_ID else INVOICE
    )
    r = client.post(URL, json={"event": "Opened a hotel receipt in the receipt viewer"})
    assert r.json()["maps_checked"] == 1


def test_endpoint_bad_id_is_404(client):
    r = client.post(URL, json={"event": "Opened a hotel receipt", "work_map_ids": ["nope"]})
    assert r.status_code == 404
    assert r.json()["detail"] == "Work Map not found"


@pytest.mark.parametrize(
    "body",
    [
        {"event": "   "},
        {"event": ""},
        {"event": "x" * 501},
        {},
        {"event": "Opened a hotel receipt", "work_map_ids": [INVOICE_ID] * 51},
    ],
)
def test_endpoint_rejects_bad_bodies(client, body):
    assert client.post(URL, json=body).status_code == 422


def test_endpoint_blank_event_message(client):
    r = client.post(URL, json={"event": "  \n "})
    assert r.status_code == 422
    assert r.json()["detail"] == "An event needs its text"


def test_endpoint_store_error_is_503(client, monkeypatch):
    def broken(*_):
        raise RuntimeError("db down")

    monkeypatch.setattr(coverage_router.work_map_store, "list_summaries", broken)
    r = client.post(URL, json={"event": "Opened a hotel receipt"})
    assert r.status_code == 503
