"""What sync() would send ElevenLabs for each agent, built without any network call."""

import pytest

from src.services import (
    apprentice_agent as agent,
    languages,
)

ROLES = ("apprentice", "tutor", "guide")


@pytest.fixture
def configs(monkeypatch):
    for key in (
        "APPRENTICE_LLM",
        "APPRENTICE_TTS_MODEL",
        "APPRENTICE_TURN_EAGERNESS",
        "AGENT_SPECULATIVE_TURN",
        *(
            f"{r.upper()}_{s}"
            for r in ROLES
            for s in ("LLM", "TTS_MODEL", "TURN_EAGERNESS", "SOFT_TIMEOUT")
        ),
    ):
        monkeypatch.delenv(key, raising=False)
    greetings = languages.first_messages(
        {
            "apprentice": agent.FIRST_MESSAGE,
            "tutor": agent.TUTOR_FIRST_MESSAGE,
            "guide": agent.GUIDE_FIRST_MESSAGE,
        }
    )
    return lambda: agent.configs({r: [f"{r}-tool"] for r in ROLES}, greetings)


def test_every_role_has_an_agent_and_a_first_message_in_every_language(configs):
    # The guide's greetings are in the repo: building its config never calls a translator.
    built = configs()
    assert set(built) == set(ROLES) == set(agent.ROLES)
    for role, config in built.items():
        assert config["name"] == agent.ROLES[role]
        presets = config["conversation_config"]["language_presets"]
        assert set(presets) == set(languages.LANGUAGES) - {"en"}
        assert all(p["overrides"]["agent"]["first_message"] for p in presets.values())


def test_fast_defaults(configs):
    for config in configs().values():
        cc = config["conversation_config"]
        assert cc["agent"]["prompt"]["llm"] == agent.DEFAULT_LLM == "gpt-6-luna"
        assert cc["tts"]["model_id"] == agent.DEFAULT_TTS == "eleven_v4_turbo"
        assert cc["tts"]["expressive_mode"] is False  # v3 only
        assert cc["turn"]["speculative_turn"] is True
        assert cc["turn"]["turn_timeout"] == -1


def test_the_apprentice_stays_patient_and_silent_while_the_expert_works(configs):
    built = configs()
    turn = built["apprentice"]["conversation_config"]["turn"]
    assert turn["turn_eagerness"] == "patient"
    assert turn["soft_timeout_config"] == {"timeout_seconds": -1}
    for role in ("tutor", "guide"):
        turn = built[role]["conversation_config"]["turn"]
        assert turn["turn_eagerness"] == "normal"
        assert turn["soft_timeout_config"] == {
            "timeout_seconds": 3,
            "use_llm_generated_message": True,
        }


def test_env_overrides(configs, monkeypatch):
    monkeypatch.setenv("APPRENTICE_LLM", "gpt-4.1")
    monkeypatch.setenv("GUIDE_LLM", "gemini-2.5-flash")
    monkeypatch.setenv("APPRENTICE_TTS_MODEL", "eleven_v3_conversational")
    monkeypatch.setenv("TUTOR_TURN_EAGERNESS", "eager")
    monkeypatch.setenv("GUIDE_SOFT_TIMEOUT", "-1")
    monkeypatch.setenv("AGENT_SPECULATIVE_TURN", "0")
    built = configs()
    cc = {role: c["conversation_config"] for role, c in built.items()}
    assert cc["apprentice"]["agent"]["prompt"]["llm"] == "gpt-4.1"
    assert cc["tutor"]["agent"]["prompt"]["llm"] == "gpt-4.1"
    assert cc["guide"]["agent"]["prompt"]["llm"] == "gemini-2.5-flash"
    assert cc["apprentice"]["tts"] == {
        **cc["apprentice"]["tts"],
        "model_id": "eleven_v3_conversational",
        "expressive_mode": True,
    }
    assert cc["tutor"]["turn"]["turn_eagerness"] == "eager"
    assert cc["guide"]["turn"]["soft_timeout_config"] == {"timeout_seconds": -1}
    assert all(c["turn"]["speculative_turn"] is False for c in cc.values())


def test_guide_knows_the_map_the_step_and_the_mode(configs):
    guide = configs()["guide"]["conversation_config"]["agent"]
    variables = guide["dynamic_variables"]["dynamic_variable_placeholders"]
    assert set(variables) == {"task", "work_map", "focused_step", "mode"}
    assert variables["mode"] == "learn"
    for name in variables:
        assert "{{" + name + "}}" in guide["prompt"]["prompt"]
    assert guide["prompt"]["tool_ids"] == ["guide-tool"]
    assert {"skip_turn", "end_call"} <= set(guide["prompt"]["built_in_tools"])


def test_guide_tools_reuse_the_edit_contract():
    tools = {t["name"]: t for t in agent.GUIDE_TOOLS}
    assert set(tools) == {"focus_step", "next_step", "edit_work_map"}
    assert tools["edit_work_map"] is next(
        t for t in agent.CLIENT_TOOLS if t["name"] == "edit_work_map"
    )
    assert tools["focus_step"]["parameters"]["required"] == ["step_id"]
    assert tools["focus_step"]["expects_response"] is False
    assert tools["next_step"]["expects_response"] is True
    for tool in agent.GUIDE_TOOLS:
        assert tool["type"] == "client"


def test_a_shared_tool_is_created_once(monkeypatch):
    calls = []

    def call(path, method="GET", body=None):  # noqa: ARG001
        calls.append((method, path))
        return {"id": f"id-{len(calls)}"}

    monkeypatch.setattr(agent, "_call", call)
    existing = {}
    first = agent._sync_tools(agent.CLIENT_TOOLS, existing)
    second = agent._sync_tools(agent.GUIDE_TOOLS, existing)
    edit = [t["name"] for t in agent.CLIENT_TOOLS].index("edit_work_map")
    assert second[-1] == first[edit]
    posts = [c for c in calls if c[0] == "POST"]
    assert len(posts) == len(agent.CLIENT_TOOLS) + 2


def test_teach_back_is_short_and_stops_when_the_expert_agrees():
    prompt = agent.PROMPT
    assert "under thirty seconds" in prompt
    assert "at any point, even in the middle of your summary" in prompt
    assert "Already clear, don't ask" in prompt
    # The client-tool contract of the teach-back is unchanged.
    names = [t["name"] for t in agent.CLIENT_TOOLS]
    for name in ("start_teach_back", "record_correction", "confirm_work_map"):
        assert name in names
