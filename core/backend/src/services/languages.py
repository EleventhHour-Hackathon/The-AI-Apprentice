"""The languages the apprentice and the tutor can speak.

Every language an ElevenLabs agent accepts as a conversation language (the
`ConversationConfigOverrideAgentLanguage` codes of @elevenlabs/types, all spoken by
eleven_v3_conversational). The expert picks one in the pill, the new hire another
for the tutor; the Work Map in between is kept in English, with the expert's words
as they said them (and an English translation).

Keep in sync with pixel-perfect-capture/src/lib/languages.ts.
"""

import json
import os
import pathlib
from typing import Dict

from openai import OpenAI

from src.utils.logger import logger

# code -> English name
LANGUAGES: Dict[str, str] = {
    "en": "English", "ja": "Japanese", "zh": "Chinese", "de": "German", "hi": "Hindi",
    "fr": "French", "ko": "Korean", "pt": "Portuguese", "pt-br": "Portuguese (Brazil)",
    "it": "Italian", "es": "Spanish", "id": "Indonesian", "nl": "Dutch", "tr": "Turkish",
    "pl": "Polish", "sv": "Swedish", "bg": "Bulgarian", "ro": "Romanian", "ar": "Arabic",
    "cs": "Czech", "el": "Greek", "fi": "Finnish", "ms": "Malay", "da": "Danish",
    "ta": "Tamil", "uk": "Ukrainian", "ru": "Russian", "hu": "Hungarian", "hr": "Croatian",
    "sk": "Slovak", "no": "Norwegian", "vi": "Vietnamese", "tl": "Filipino",
    "af": "Afrikaans", "hy": "Armenian", "as": "Assamese", "az": "Azerbaijani",
    "be": "Belarusian", "bn": "Bengali", "bs": "Bosnian", "ca": "Catalan", "et": "Estonian",
    "gl": "Galician", "ka": "Georgian", "gu": "Gujarati", "ha": "Hausa", "he": "Hebrew",
    "is": "Icelandic", "ga": "Irish", "jv": "Javanese", "kn": "Kannada", "kk": "Kazakh",
    "ky": "Kyrgyz", "lv": "Latvian", "lt": "Lithuanian", "lb": "Luxembourgish",
    "mk": "Macedonian", "ml": "Malayalam", "mr": "Marathi", "ne": "Nepali", "ps": "Pashto",
    "fa": "Persian", "pa": "Punjabi", "sr": "Serbian", "sd": "Sindhi", "sl": "Slovenian",
    "so": "Somali", "sw": "Swahili", "te": "Telugu", "th": "Thai", "ur": "Urdu", "cy": "Welsh",
}
# Map language: what titles, decisions, rules and open questions are written in.
MAP_LANGUAGE = "en"

# First messages per language, translated once and kept in the repo (reviewable, no LLM at sync).
FIRST_MESSAGES_FILE = pathlib.Path(__file__).with_name("agent_first_messages.json")


def name(code: str) -> str:
    return LANGUAGES.get(code, code)


def first_messages(messages: Dict[str, str]) -> Dict[str, Dict[str, str]]:
    """{message key: {language code: translation}} for every language, translating what is missing.

    messages is {key: English text}, e.g. {"apprentice": "Hi, what are we doing today?"}.
    """
    cached: Dict[str, Dict[str, str]] = (
        json.loads(FIRST_MESSAGES_FILE.read_text()) if FIRST_MESSAGES_FILE.exists() else {}
    )
    changed = False
    client = None
    for key, english in messages.items():
        table = cached.setdefault(key, {})
        if table.get("en") != english:  # the English changed: translate it again everywhere
            table.clear()
            table["en"] = english
        missing = [code for code in LANGUAGES if code not in table]
        if not missing:
            continue
        client = client or OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        wanted = {code: LANGUAGES[code] for code in missing}
        response = client.chat.completions.create(
            model=os.getenv("TRANSLATE_MODEL", "gpt-4.1"),
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": "Translate what a friendly colleague says at the start of a work session. "
                    "Keep every part of its meaning; make it natural and spoken, informal where that is normal at work. "
                    "Return JSON: {language code: translation} for exactly the codes given.",
                },
                {"role": "user", "content": json.dumps({"text": english, "languages": wanted}, ensure_ascii=False)},
            ],
        )
        translated = json.loads(response.choices[0].message.content)
        table.update({code: str(text) for code, text in translated.items() if code in wanted and text})
        changed = True
        logger.info(f"Translated the {key} first message into {len(wanted)} languages")
    if changed:
        FIRST_MESSAGES_FILE.write_text(json.dumps(cached, ensure_ascii=False, indent=1, sort_keys=True) + "\n")
    return cached


async def translate_quotes(items: list) -> None:
    """Give every quote that isn't in English a quote_translation (English), in one call.

    The quote itself stays exactly as the expert said it; the translation is what the Work
    Map shows next to it and what a tutor teaching in another language works from.
    """
    from openai import AsyncOpenAI

    quoted = [i for i in items if isinstance(i, dict) and (i.get("quote") or "").strip()]
    if not quoted:
        return
    client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    try:
        response = await client.chat.completions.create(
            model=os.getenv("TRANSLATE_MODEL", "gpt-4.1"),
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": "For each numbered quote from a person explaining their work, give its language "
                    "(ISO 639-1 code, or pt-br) and a faithful, natural English translation. If it is already "
                    'English, the translation is "". Return JSON: {"quotes": [{"n": int, "language": str, '
                    '"translation": str}]}.',
                },
                {
                    "role": "user",
                    "content": json.dumps([{"n": n, "quote": i["quote"]} for n, i in enumerate(quoted)], ensure_ascii=False),
                },
            ],
        )
        rows = json.loads(response.choices[0].message.content).get("quotes", [])
    except Exception as e:
        logger.warning(f"Quotes not translated: {e}")
        return
    for row in rows:
        n = row.get("n")
        if not isinstance(n, int) or not 0 <= n < len(quoted):
            continue
        code = str(row.get("language") or "").lower()
        quoted[n]["quote_language"] = code if code in LANGUAGES else ""
        translation = str(row.get("translation") or "").strip()
        if code != MAP_LANGUAGE and translation:
            quoted[n]["quote_translation"] = translation
