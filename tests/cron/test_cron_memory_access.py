"""``cron.memory_access`` — opt-in memory reads for scheduled runs.

A cron run used to be hard-wired to ``skip_memory=True``, which withheld both
MEMORY.md/USER.md *and* the memory-provider tools.  For a persona-carrying job
that is crippling: the run cannot tell who the user is, so it either guesses or
falls back on whatever generic fact a tool can still produce — and it works
around the missing provider by writing notes through any file/MCP tool it can
reach, bypassing dedup, the index and the target/category contract.

The flag opens *reads* only.  USER.md writes stay refused downstream (see
``MemoryStore.user_profile_writable`` and the obsidian provider's two gates),
so the original hazard — a job description being filed as a user fact — is
still closed.
"""

import textwrap
from unittest.mock import MagicMock, patch

import pytest

from cron.scheduler import run_job


def _base_job(**overrides):
    job = {
        "id": "job-mem",
        "name": "heartbeat",
        "prompt": "醒一下，看看要不要说话",
        "enabled": True,
        "model": "test-model",
        "provider_snapshot": None,
        "base_url": None,
    }
    job.update(overrides)
    return job


def _skip_memory_for_config(config_yaml: str, tmp_path):
    """Run one job against *config_yaml* and report the AIAgent kwarg used."""
    (tmp_path / "config.yaml").write_text(
        textwrap.dedent(config_yaml), encoding="utf-8"
    )
    fake_db = MagicMock()
    with patch("cron.scheduler._get_hermes_home", return_value=tmp_path), \
         patch("cron.scheduler._hermes_home", tmp_path), \
         patch("cron.scheduler._resolve_origin", return_value=None), \
         patch("hermes_cli.env_loader.load_hermes_dotenv"), \
         patch("hermes_cli.env_loader.reset_secret_source_cache"), \
         patch("hermes_state.SessionDB", return_value=fake_db), \
         patch(
             "hermes_cli.runtime_provider.resolve_runtime_provider",
             return_value={
                 "api_key": "test-key",
                 "base_url": "https://example.invalid/v1",
                 "provider": "openrouter",
                 "api_mode": "chat_completions",
             },
         ), \
         patch("run_agent.AIAgent") as mock_agent_cls:
        mock_agent = MagicMock()
        mock_agent.run_conversation.return_value = {"final_response": "ok"}
        mock_agent_cls.return_value = mock_agent

        run_job(_base_job())

        if not mock_agent_cls.called:
            pytest.fail("AIAgent was never constructed; harness assumptions broke")
        return mock_agent_cls.call_args.kwargs["skip_memory"]


def test_memory_is_skipped_by_default(tmp_path):
    """Absent config keeps the historical behaviour."""
    assert _skip_memory_for_config("model: {}\n", tmp_path) is True


def test_memory_access_false_still_skips(tmp_path):
    assert _skip_memory_for_config(
        """
        cron:
          memory_access: false
        """,
        tmp_path,
    ) is True


def test_memory_access_true_enables_memory(tmp_path):
    assert _skip_memory_for_config(
        """
        cron:
          memory_access: true
        """,
        tmp_path,
    ) is False


def test_unrelated_cron_keys_do_not_enable_memory(tmp_path):
    """A profile that only tunes delivery must not silently gain memory."""
    assert _skip_memory_for_config(
        """
        cron:
          mirror_delivery: true
          wrap_response: false
        """,
        tmp_path,
    ) is True
