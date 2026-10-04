"""Personal data in what was said or seen never reaches a model or the database.

The pill hides personal data on screen before any frame leaves the machine (the
privacy shield, pixel-perfect-capture/src/hooks/use-privacy-shield.ts). This is
the same rule for text: transcripts, screen events, quotes, answers and edits are
redacted on the way in, so emails, IBANs, card and phone numbers are stored and
merged as [email], [iban], [card] and [phone]. A name after an honorific ("Frau Weber",
"Mr. Smith", "Herrn Dr. Klaus Meyer") becomes [name] in every language, honorific included.

With the privacy extra (`uv sync --extra privacy`: Microsoft Presidio and the small
English spaCy model), other people's names are redacted as [name] as well; without it the
rules above still run. Names are fully redacted only in English; in other languages only
spans of two or more capitalized words ("Petra Weber") are, since the English model
mistakes ordinary nouns for names there. PRIVACY_SPACY_MODEL picks another installed
spaCy model. Places are kept: "the Czech subsidiary" is a rule, not personal data.
"""

import os
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from src.utils.logger import logger

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b")
CARD = re.compile(r"\b\d(?:[ -]?\d){12,18}\b")
PHONE = re.compile(r"(?:\+|\(0|\b0)[\d ()/.-]{7,}\d")
# One or more honorifics, then one or two capitalized words. The whole span becomes [name],
# so neither the name nor the gender is kept. "Frau des Lieferanten" is left alone.
_HONORIFIC = (
    r"(?:Frau|Herrn|Herr|Fr\.|Hr\.|Dr\.|Prof\.|Mrs\.?|Mr\.?|Ms\.?|Miss|Madame|Mme|Monsieur"
    r"|M\.|Señora|Señor|Sra\.|Sr\.|Signora|Signor|Sig\.ra|Sig\.)"
)
_CAPITALIZED = r"[A-ZÀ-ÖØ-Þ][\w'-]+"
HONORIFIC_NAME = re.compile(rf"\b(?:{_HONORIFIC}\s+)+{_CAPITALIZED}(?:\s+{_CAPITALIZED})?")


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
    ("[name]", HONORIFIC_NAME, bool),
]

# Named explicitly so Presidio never reaches for the large en_core_web_lg.
MODEL = os.getenv("PRIVACY_SPACY_MODEL", "en_core_web_sm")

_presidio: Optional[Any] = None
_presidio_tried = False


def _analyzer() -> Optional[Any]:
    global _presidio, _presidio_tried
    if not _presidio_tried:
        _presidio_tried = True
        try:
            from presidio_analyzer import AnalyzerEngine  # type: ignore
            from presidio_analyzer.nlp_engine import NlpEngineProvider  # type: ignore
            import spacy.util  # type: ignore

            # Presidio downloads a missing model; a server shouldn't, so say so instead.
            if not spacy.util.is_package(MODEL) and not os.path.isdir(MODEL):
                raise RuntimeError(f"spaCy model {MODEL} isn't installed")
            nlp = NlpEngineProvider(
                nlp_configuration={
                    "nlp_engine_name": "spacy",
                    "models": [{"lang_code": "en", "model_name": MODEL}],
                }
            ).create_engine()
            _presidio = AnalyzerEngine(nlp_engine=nlp, supported_languages=["en"])
            logger.info(f"[privacy] Presidio with {MODEL}: names are redacted too")
        except ImportError:
            _presidio = None
            logger.info(
                "[privacy] Presidio isn't installed, names are kept (uv sync --extra privacy)"
            )
        except Exception as e:
            _presidio = None
            logger.warning(f"[privacy] Presidio couldn't start, names are kept: {e}")
    return _presidio


def status() -> Dict[str, Any]:
    """Which redaction is on: Presidio (names too) or the regex rules alone."""
    on = _analyzer() is not None
    return {"names": on, "engine": "presidio" if on else "regex"}


# The spaCy model is English. On other languages it tags ordinary capitalized nouns as people
# ("die Rechnung", "Anlagevermögen"), which would wreck the expert's rules. So outside English
# only "Firstname Lastname"-shaped spans count as names. German-shared words (in, an, was, will)
# are left out of this list so they don't make German look English.
# fmt: off
ENGLISH_WORDS = frozenset([
    "the", "is", "are", "and", "of", "to", "it", "that", "this", "with", "you", "we", "they",
    "she", "he", "i", "be", "have", "has", "for", "from", "not", "what", "when", "which",
    "then", "if", "always", "my", "our", "your", "on",
])
# fmt: on
WORD = re.compile(r"[^\W\d_]+")


def _looks_english(text: str) -> bool:
    words = WORD.findall(text.lower())
    return bool(words) and sum(w in ENGLISH_WORDS for w in words) >= 0.15 * len(words)


def _looks_like_full_name(span: str) -> bool:
    parts = span.split()
    return len(parts) >= 2 and all(p[0].isupper() for p in parts)


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
            if not _looks_english(text):
                found = [r for r in found if _looks_like_full_name(text[r.start : r.end])]
            # Results can overlap ("Anna" inside "Anna Novak"): keep the first of each run.
            kept: List[Any] = []
            for r in sorted(found, key=lambda r: (r.start, -r.end)):
                if not kept or r.start >= kept[-1].end:
                    kept.append(r)
            for r in reversed(kept):
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
