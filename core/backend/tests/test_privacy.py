"""privacy.redact: the regex rules always, names only when Presidio is there.

Presidio is faked here, so these never need spaCy or the network. The one real-Presidio test
skips unless the privacy extra (and its model) is installed.
"""

import sys
from types import SimpleNamespace
from typing import Any, List, Optional

import pytest

from src.services import privacy


def use_analyzer(monkeypatch, analyzer: Optional[Any]) -> None:
    """Make privacy use this analyzer (None: regex only) without trying to load Presidio."""
    monkeypatch.setattr(privacy, "_presidio", analyzer)
    monkeypatch.setattr(privacy, "_presidio_tried", True)


class FakeAnalyzer:
    """Finds the given words as PERSON results, plus any extra (start, end) spans."""

    def __init__(self, names: List[str], spans: Optional[List[tuple]] = None):
        self.names = names
        self.spans = spans or []
        self.calls: List[dict] = []

    def analyze(self, text: str, language: str, entities: List[str]) -> List[SimpleNamespace]:
        self.calls.append({"text": text, "language": language, "entities": entities})
        found = [SimpleNamespace(start=s, end=e) for s, e in self.spans]
        for name in self.names:
            i = text.find(name)
            if i >= 0:
                found.append(SimpleNamespace(start=i, end=i + len(name)))
        return found


class BrokenAnalyzer:
    def analyze(self, text: str, language: str, entities: List[str]) -> list:  # noqa: ARG002
        raise RuntimeError("model fell over")


@pytest.fixture
def regex_only(monkeypatch) -> None:
    use_analyzer(monkeypatch, None)


@pytest.mark.usefixtures("regex_only")
class TestRegex:
    def test_email(self):
        assert privacy.redact("Write to anna.novak+erp@example.co.uk today") == (
            "Write to [email] today"
        )

    def test_iban(self):
        assert privacy.redact("Pay DE89 3704 0044 0532 0130 00 by Friday") == (
            "Pay [iban] by Friday"
        )
        assert privacy.redact("IBAN GB82WEST12345698765432.") == "IBAN [iban]."

    def test_card_needs_luhn(self):
        assert privacy.redact("Card 4111 1111 1111 1111 on file") == "Card [card] on file"
        assert privacy.redact("Ref 4111 1111 1111 1112 on file") == (
            "Ref 4111 1111 1111 1112 on file"
        )

    def test_phone(self):
        assert privacy.redact("Call +49 30 1234567 or (030) 123-4567") == (
            "Call [phone] or [phone]"
        )
        assert privacy.redact("Order 1234 of 2026") == "Order 1234 of 2026"

    def test_non_str_and_empty_unchanged(self):
        assert privacy.redact("") == ""
        assert privacy.redact(None) is None  # type: ignore[arg-type]
        assert privacy.redact(42) == 42  # type: ignore[arg-type]

    def test_honorific_names(self):
        assert privacy.redact("geht an Frau Weber.") == "geht an [name]."
        assert privacy.redact("Ich frage Herrn Dr. Klaus Meyer") == "Ich frage [name]"
        assert privacy.redact("Mr. Smith approved it") == "[name] approved it"
        assert privacy.redact("Pregunta a la Sra. Núñez") == "Pregunta a la [name]"
        assert privacy.redact("Frau des Lieferanten") == "Frau des Lieferanten"
        assert privacy.redact("Herr und Frau") == "Herr und Frau"
        assert privacy.redact("Mrs Ölund") == "[name]"

    def test_names_kept_without_presidio(self):
        assert privacy.redact("Anna Novak approved it") == "Anna Novak approved it"

    def test_redact_deep(self):
        value = {
            "quote": "mail me at a@b.cz",
            "steps": [{"note": "IBAN GB82WEST12345698765432"}, "call +420 601 123 456", 7],
            "count": 3,
            "ok": True,
            "none": None,
        }
        assert privacy.redact_deep(value) == {
            "quote": "mail me at [email]",
            "steps": [{"note": "IBAN [iban]"}, "call [phone]", 7],
            "count": 3,
            "ok": True,
            "none": None,
        }


def test_presidio_names(monkeypatch):
    fake = FakeAnalyzer(["Anna Novak", "Petr"])
    use_analyzer(monkeypatch, fake)
    out = privacy.redact("Anna Novak sends it to Petr at petr@firm.cz")
    assert out == "[name] sends it to [name] at [email]"
    assert fake.calls[0]["language"] == "en"
    assert fake.calls[0]["entities"] == ["PERSON"]


def test_presidio_overlaps(monkeypatch):
    text = "Ask Anna Novak and Petr Svoboda"
    # "Anna Novak" is 4-14, "Petr Svoboda" 19-31; the rest overlap them.
    spans = [(4, 14), (4, 8), (9, 14), (19, 23), (19, 31), (22, 28)]
    use_analyzer(monkeypatch, FakeAnalyzer([], spans))
    assert privacy.redact(text) == "Ask [name] and [name]"


GERMAN_RULE = (
    "Alles über 5.000 ist Anlagevermögen, die Rechnung von Bauer Hydraulik geht an Frau Weber."
)


GERMAN_RULE_REDACTED = (
    "Alles über 5.000 ist Anlagevermögen, die Rechnung von Bauer Hydraulik geht an [name]."
)


def test_german_nouns_are_not_names(monkeypatch):
    use_analyzer(monkeypatch, FakeAnalyzer(["Anlagevermögen", "Rechnung von Bauer Hydraulik"]))
    assert privacy.redact(GERMAN_RULE) == GERMAN_RULE_REDACTED


def test_honorific_names_with_presidio(monkeypatch):
    # Presidio sees the text after the rules, so a name it also tags is replaced once.
    use_analyzer(monkeypatch, FakeAnalyzer(["Mr. Smith", "Smith", "[name]"]))
    assert privacy.redact("Mr. Smith approved it") == "[name] approved it"
    use_analyzer(monkeypatch, FakeAnalyzer(["Frau Weber", "Weber", "[name]"]))
    assert privacy.redact("geht an Frau Weber.") == "geht an [name]."


def test_german_full_name_is_redacted(monkeypatch):
    use_analyzer(monkeypatch, FakeAnalyzer(["immer", "Petra Weber"]))
    assert privacy.redact("Ich frage immer Petra Weber.") == "Ich frage immer [name]."


def test_english_single_name_is_redacted(monkeypatch):
    use_analyzer(monkeypatch, FakeAnalyzer(["Petra"]))
    assert privacy.redact("I always ask Petra when the invoice is late.") == (
        "I always ask [name] when the invoice is late."
    )


def test_german_email_is_redacted(monkeypatch):
    use_analyzer(monkeypatch, FakeAnalyzer(["Rechnung"]))
    assert privacy.redact("Die Rechnung geht an buchhaltung@bauer.de.") == (
        "Die Rechnung geht an [email]."
    )


def test_presidio_failure_falls_back_to_regex(monkeypatch):
    use_analyzer(monkeypatch, BrokenAnalyzer())
    assert privacy.redact("Anna Novak, a@b.cz") == "Anna Novak, [email]"


def test_status(monkeypatch):
    use_analyzer(monkeypatch, None)
    assert privacy.status() == {"names": False, "engine": "regex"}
    use_analyzer(monkeypatch, FakeAnalyzer([]))
    assert privacy.status() == {"names": True, "engine": "presidio"}


def test_missing_presidio_means_regex(monkeypatch):
    monkeypatch.setattr(privacy, "_presidio", None)
    monkeypatch.setattr(privacy, "_presidio_tried", False)
    monkeypatch.setitem(sys.modules, "presidio_analyzer", None)
    assert privacy.status() == {"names": False, "engine": "regex"}
    assert privacy._presidio_tried is True


def test_real_presidio(monkeypatch):
    pytest.importorskip("presidio_analyzer")
    monkeypatch.setattr(privacy, "_presidio", None)
    monkeypatch.setattr(privacy, "_presidio_tried", False)
    if privacy._analyzer() is None:
        pytest.skip(f"spaCy model {privacy.MODEL} couldn't load")
    assert privacy.status() == {"names": True, "engine": "presidio"}
    out = privacy.redact("Yesterday John Smith approved the invoice from Prague.")
    assert "John" not in out and "Smith" not in out
    assert "[name]" in out and "Prague" in out
    out = privacy.redact(GERMAN_RULE)
    assert "Anlagevermögen" in out and "Rechnung" in out
