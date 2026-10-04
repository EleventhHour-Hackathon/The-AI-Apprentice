"""Shared test setup: import the backend as `src...`, and never reach a real LLM."""

import json
import pathlib
import sys
from types import SimpleNamespace
from typing import Any, Callable, Dict, List

import pytest

BACKEND = pathlib.Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


class FakeAsyncOpenAI:
    """Stands in for openai.AsyncOpenAI: chat.completions.create returns the next canned reply.

    Each reply is a dict (sent as JSON) or a string. Every call's kwargs are kept in `calls`.
    """

    def __init__(self, replies: List[Any]):
        self.replies = list(replies)
        self.calls: List[Dict[str, Any]] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def __call__(self, *args, **kwargs) -> "FakeAsyncOpenAI":  # noqa: ARG002
        return self  # used as the client class: AsyncOpenAI(api_key=...) gives this fake

    async def _create(self, **kwargs) -> Any:
        self.calls.append(kwargs)
        if not self.replies:
            raise AssertionError("FakeAsyncOpenAI got more calls than canned replies")
        reply = self.replies.pop(0)
        content = reply if isinstance(reply, str) else json.dumps(reply)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


@pytest.fixture(autouse=True)
def _no_real_keys(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-real")


@pytest.fixture(autouse=True)
def _regex_only_redaction(monkeypatch):
    """Redact with the regex rules only, so results don't depend on whether the privacy extra
    (Presidio) is installed. Tests that need Presidio set privacy's state themselves."""
    from src.services import privacy

    monkeypatch.setattr(privacy, "_presidio", None)
    monkeypatch.setattr(privacy, "_presidio_tried", True)


@pytest.fixture(autouse=True)
def _empty_memory(monkeypatch):
    """The apprentice remembers nothing (no confirmed Work Maps), instead of reading Supabase.
    Tests of the brain set work_maps.confirmed_maps themselves."""
    from storage import work_maps

    monkeypatch.setattr(work_maps, "confirmed_maps", lambda _limit=50: [])


@pytest.fixture
def fake_openai(monkeypatch) -> Callable[..., FakeAsyncOpenAI]:
    """fake_openai(module, *replies) patches module.AsyncOpenAI with a FakeAsyncOpenAI."""

    def install(module: Any, *replies: Any) -> FakeAsyncOpenAI:
        fake = FakeAsyncOpenAI(list(replies))
        monkeypatch.setattr(module, "AsyncOpenAI", fake)
        return fake

    return install


@pytest.fixture
def no_translation(monkeypatch) -> None:
    """Quotes are left untranslated instead of calling OpenAI."""
    from src.services import languages

    async def translate_quotes(items: list) -> None:  # noqa: ARG001
        return None

    monkeypatch.setattr(languages, "translate_quotes", translate_quotes)


@pytest.fixture
def merge_llm(fake_openai, no_translation) -> Callable[..., FakeAsyncOpenAI]:  # noqa: ARG001
    """merge_llm(work_map) makes work_map_merge.merge get this canned map from the LLM."""
    from src.services import work_map_merge

    return lambda *work_maps: fake_openai(work_map_merge, *work_maps)
