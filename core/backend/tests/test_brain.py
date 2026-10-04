"""What the apprentice carries between sessions (src/services/brain.py)."""

import pytest

from src.services import brain
from storage import work_maps

INVOICES = {
    "task": "Approving supplier invoices",
    "recorded_at": "2026-10-01T10:00:00",
    "steps": [{"title": "Match the invoice to the PO", "reason": "to catch overbilling"}],
    "guardrails": [{"rule": "Stop above $10,000", "ask_whom": "the controller"}],
    "open_questions": ["What about foreign suppliers?"],
}


@pytest.fixture
def remembers(monkeypatch):
    monkeypatch.setattr(work_maps, "confirmed_maps", lambda _limit=50: [INVOICES])


def test_a_new_apprentice_knows_nothing():
    assert "not learned any task" in brain.index()
    assert brain.known("approving supplier invoices") == ""
    assert brain.prior("approving supplier invoices") is None


@pytest.mark.usefixtures("remembers")
def test_the_same_task_in_other_words_brings_back_what_was_learned():
    known = brain.known("approving the invoices from our suppliers")
    assert known.startswith("[KNOWN]")
    assert "Match the invoice to the PO — because to catch overbilling" in known
    assert "Stop above $10,000 — ask the controller" in known
    assert "What about foreign suppliers?" in known


@pytest.mark.usefixtures("remembers")
def test_other_work_is_new():
    assert brain.known("onboarding a new hire") == ""


@pytest.mark.usefixtures("remembers")
def test_the_final_merge_is_given_what_was_known():
    assert brain.prior("supplier invoices") == {
        "steps": ["Match the invoice to the PO"],
        "guardrails": ["Stop above $10,000"],
        "open_questions": ["What about foreign suppliers?"],
    }


def test_memory_down_means_knowing_nothing(monkeypatch):
    def down(_limit=50):
        raise RuntimeError("down")

    monkeypatch.setattr(work_maps, "confirmed_maps", down)
    assert brain.known("supplier invoices") == ""
