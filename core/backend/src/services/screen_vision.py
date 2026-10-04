"""Screen understanding for the AI Apprentice.

Turns a stream of screen frames into *events* ("invoice 4471 opened",
"cost center changed from 4711 to 0400") rather than video, so the voice
agent knows what the expert is doing without being shown the raw screen.

The vision backend is pluggable: set VISION_PROVIDER to "openai" (default)
or "fastvlm" to run Apple's FastVLM locally instead.
"""

from abc import ABC, abstractmethod
import base64
import datetime
import json
import os
import pathlib

from openai import AsyncOpenAI

from src.utils.logger import logger

# Where to drop the frames the model actually looked at, so what it saw can be
# checked against what it reported. Off by default: these are full screenshots of the
# expert's screen that nothing else tracks. Set SCREEN_DEBUG=true while debugging vision.
SCREEN_DEBUG = os.getenv("SCREEN_DEBUG", "false").lower() == "true"
SCREEN_DEBUG_DIR = pathlib.Path(os.getenv("SCREEN_DEBUG_DIR", "uploads/screen_debug"))


def log_frame(image_b64: str, result: dict, backend_name: str) -> None:
    """Log what the vision model saw, and keep the frame it saw it in."""
    event = result.get("event")
    description = result.get("description", "")

    if event:
        logger.info(f"[{backend_name}] EVENT: {event}")
    else:
        logger.info(f"[{backend_name}] no change | sees: {description}")

    if not SCREEN_DEBUG:
        return

    try:
        SCREEN_DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
        (SCREEN_DEBUG_DIR / f"{stamp}.jpg").write_bytes(base64.b64decode(image_b64))
        with (SCREEN_DEBUG_DIR / "frames.jsonl").open("a") as f:
            f.write(
                json.dumps(
                    {
                        "frame": f"{stamp}.jpg",
                        "backend": backend_name,
                        "description": description,
                        "event": event,
                        "changed": result.get("changed", False),
                    }
                )
                + "\n"
            )
    except Exception as e:  # never let debug output break a live session
        logger.warning(f"Could not write screen debug frame: {e}")

SYSTEM_PROMPT = """You watch an expert's screen while they do real work.

You are given the previous description of the screen and the current frame.
Report only what a colleague looking over their shoulder would notice.

Return STRICT JSON:
{
  "description": "<one sentence describing the current screen>",
  "event": "<what changed since the previous description, or null if nothing meaningful changed>",
  "changed": <true|false>,
  "kind": "<action|navigation|null>"
}

Rules:
- Default to no change. Most frames are the same screen a moment later.
  If the current frame still matches the previous description, return
  "event": null and "changed": false.
- "changed" is false for cursor movement, scrolling, blinking carets or
  re-rendering. Only report changes that a person would describe out loud.
- Report a change only if you can see BOTH states: the old value in the
  previous description AND the new value in the current frame. Never infer a
  change from the previous description alone, and never carry forward a
  change you reported earlier.
- Name concrete values you can read: document numbers, field names, amounts,
  codes, statuses. Write "<field> changed from <old value> to <new value>"
  using the values actually on screen, not "a field was edited". Never copy
  example values from these instructions into your answer.
- Never guess at text you cannot actually read in the frame.
- "changed" must be true if and only if "event" is a non-null string.
- Keep "event" under 20 words.
- "kind" is "action" when the expert did something to the work: a value was
  entered or changed, something was saved, approved, held, rejected, sent or
  deleted. It is "navigation" when they only moved to something new to look
  at: a document, record, tab or page opened or switched. null when there is
  no event."""


def _normalize(result: dict) -> dict:
    """Keep 'changed' and 'event' consistent regardless of what the model says.

    Models like to report something, so an empty event with changed=True is a
    common failure; treat the event as the source of truth.
    """
    event = result.get("event")
    if isinstance(event, str) and not event.strip():
        event = None
    if isinstance(event, str) and event.strip().lower() in {"null", "none", "no change"}:
        event = None
    kind = result.get("kind") if result.get("kind") in ("action", "navigation") else None
    return {
        "description": result.get("description") or "",
        "event": event,
        "changed": event is not None,
        # An event the model didn't classify is treated as an action: worth a question.
        "kind": (kind or "action") if event is not None else None,
    }


class VisionBackend(ABC):
    """A model that can describe what changed between screen frames."""

    @abstractmethod
    async def describe(self, image_b64: str, previous: str | None) -> dict:
        """Return {"description": str, "event": str|None, "changed": bool, "kind": str|None}."""


class OpenAIVision(VisionBackend):
    def __init__(self, model: str | None = None):
        self.model = model or os.getenv("VISION_MODEL", "gpt-4.1-mini-2025-04-14")
        self.client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    async def describe(self, image_b64: str, previous: str | None) -> dict:
        prior = previous or "(nothing seen yet - this is the first frame)"
        response = await self.client.chat.completions.create(
            model=self.model,
            max_tokens=200,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Previous description: {prior}"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_b64}",
                                "detail": "high",
                            },
                        },
                    ],
                },
            ],
        )
        return _normalize(json.loads(response.choices[0].message.content))


class FastVLMVision(VisionBackend):
    """Apple FastVLM running locally (github.com/apple/ml-fastvlm).

    Keeps frames on the machine, which matters for the screens this
    product is pointed at. Loaded lazily so the import cost is only paid
    when this backend is actually selected.
    """

    def __init__(self, model_path: str | None = None):
        self.model_path = model_path or os.getenv("FASTVLM_MODEL_PATH", "")
        self._model = None

    def _ensure_loaded(self):
        if self._model is not None:
            return
        if not self.model_path:
            raise RuntimeError(
                "FASTVLM_MODEL_PATH is not set. Download a checkpoint from "
                "github.com/apple/ml-fastvlm and point FASTVLM_MODEL_PATH at it."
            )
        from llava.model.builder import load_pretrained_model  # noqa: PLC0415

        logger.info(f"Loading FastVLM from {self.model_path}")
        tokenizer, model, image_processor, _ = load_pretrained_model(
            self.model_path, None, "fastvlm", device="mps"
        )
        self._model = (tokenizer, model, image_processor)
        logger.info("FastVLM loaded")

    async def describe(self, image_b64: str, previous: str | None) -> dict:
        self._ensure_loaded()
        raise NotImplementedError(
            "FastVLM inference is not wired up yet; run with VISION_PROVIDER=openai."
        )


_BACKENDS = {"openai": OpenAIVision, "fastvlm": FastVLMVision}
_backend: VisionBackend | None = None


def get_backend() -> VisionBackend:
    """Return the configured vision backend, building it on first use."""
    global _backend
    if _backend is None:
        name = os.getenv("VISION_PROVIDER", "openai").lower()
        if name not in _BACKENDS:
            raise ValueError(
                f"Unknown VISION_PROVIDER '{name}'. Expected one of: {', '.join(_BACKENDS)}"
            )
        logger.info(f"Using '{name}' vision backend for screen understanding")
        _backend = _BACKENDS[name]()
    return _backend
