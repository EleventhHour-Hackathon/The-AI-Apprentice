"""Personal data in what was said or seen never reaches a model or the database.

The pill hides personal data on screen before any frame leaves the machine (the
privacy shield, pixel-perfect-capture/src/hooks/use-privacy-shield.ts). This is
the same rule for text: transcripts, screen events, quotes, answers and edits are
redacted on the way in, so emails, IBANs, card and phone numbers are stored and
merged as [email], [iban], [card] and [phone].

If Microsoft Presidio is installed (`uv pip install presidio-analyzer` plus a spaCy
model), people's names are redacted as well; without it the structured identifiers
above still are. Places are kept: "the Czech subsidiary" is a rule, not personal data.
"""

import re
from typing import Any, Callable, List, Optional, Tuple

from src.utils.logger import logger

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b")
CARD = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")
PHONE = re.compile(r"(?:\+|\(0|\b0)[\d ()/.-]{7,}\d")


def _luhn(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return total % 10 == 0


RULES: List[Tuple[str, re.Pattern, Callable[[str], bool]]] = [
    ("[email]", EMAIL, lambda m: True),
    ("[iban]", IBAN, lambda m: len(re.sub(r"\s", "", m)) >= 15),
    ("[card]", CARD, lambda m: _luhn(re.sub(r"\D", "", m))),
    ("[phone]", PHONE, lambda m: len(re.sub(r"\D", "", m)) >= 8),
]

_presidio: Optional[Any] = None
_presidio_tried = False


def _analyzer() -> Optional[Any]:
    global _presidio, _presidio_tried
    if not _presidio_tried:
        _presidio_tried = True
        try:
            from presidio_analyzer import AnalyzerEngine  # type: ignore

            _presidio = AnalyzerEngine()
            logger.info("[privacy] Presidio found: names are redacted too")
        except Exception:
            _presidio = None
    return _presidio


def redact(text: str) -> str:
    """The text with personal data replaced by [email], [iban], [card], [phone] (and [name])."""
    if not isinstance(text, str) or not text:
        return text
    for label, pattern, keep in RULES:
        text = pattern.sub(lambda m: label if keep(m.group(0)) else m.group(0), text)
    analyzer = _analyzer()
    if analyzer is not None:
        try:
            found = analyzer.analyze(text=text, language="en", entities=["PERSON"])
            for r in sorted(found, key=lambda r: r.start, reverse=True):
                text = text[: r.start] + "[name]" + text[r.end :]
        except Exception as e:
            logger.warning(f"[privacy] Presidio failed, structured redaction only: {e}")
    return text


def redact_deep(value: Any) -> Any:
    """redact() every string inside a JSON-like value."""
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, list):
        return [redact_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: redact_deep(v) for k, v in value.items()}
    return value
