"""Tests for agent/system_prompt.py — context-file cwd wiring."""

import datetime
from types import SimpleNamespace
from unittest.mock import patch

from agent.system_prompt import (
    build_system_prompt_parts,
    build_time_awareness_lines,
    conversation_gap_label,
    daypart_label,
)


def _make_agent(**overrides):
    base = dict(
        load_soul_identity=False,
        skip_context_files=False,
        valid_tool_names=[],
        _task_completion_guidance=False,
        _tool_use_enforcement=False,
        _environment_probe=False,
        _kanban_worker_guidance="",
        _memory_store=None,
        _memory_manager=None,
        model="",
        provider="",
        platform="",
        pass_session_id=False,
        session_id="",
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _captured_context_cwd(agent):
    """The cwd build_system_prompt_parts hands to build_context_files_prompt."""
    captured = {}

    def fake_context_files(
        cwd=None, skip_soul=False, context_length=None,
        allow_install_tree_fallback=False,
    ):
        captured["cwd"] = cwd
        return ""

    with (
        patch("run_agent.load_soul_md", return_value=""),
        patch("run_agent.build_nous_subscription_prompt", return_value=""),
        patch("run_agent.build_environment_hints", return_value=""),
        patch("run_agent.build_context_files_prompt", side_effect=fake_context_files),
    ):
        build_system_prompt_parts(agent)
    return captured["cwd"]


class TestContextFileCwd:
    def test_none_when_terminal_cwd_unset(self, monkeypatch):
        # Unset → None, so discovery falls back to the launch dir inside
        # build_context_files_prompt (the local-CLI #19242 contract).
        monkeypatch.delenv("TERMINAL_CWD", raising=False)
        assert _captured_context_cwd(_make_agent()) is None

    def test_configured_dir_when_terminal_cwd_set(self, monkeypatch, tmp_path):
        monkeypatch.setenv("TERMINAL_CWD", str(tmp_path))
        assert _captured_context_cwd(_make_agent()) == tmp_path


def _stable_prompt(agent):
    with (
        patch("run_agent.load_soul_md", return_value=""),
        patch("run_agent.build_nous_subscription_prompt", return_value=""),
        patch("run_agent.build_environment_hints", return_value=""),
        patch("run_agent.build_context_files_prompt", return_value=""),
    ):
        return build_system_prompt_parts(agent)["stable"]


def _init_code_repo(path):
    """A git repo that actually holds code — the coding posture requires a source
    file (or manifest), not a bare ``.git`` (a prose/notes repo stays general)."""
    import subprocess

    subprocess.run(["git", "-C", str(path), "init", "-q"], check=True)
    (path / "main.py").write_text("print('hi')\n")


class TestCodingContextBlock:
    def test_injected_when_active(self, monkeypatch, tmp_path):
        _init_code_repo(tmp_path)
        monkeypatch.setenv("TERMINAL_CWD", str(tmp_path))
        agent = _make_agent(valid_tool_names=["read_file"], platform="cli")
        stable = _stable_prompt(agent)
        assert "coding agent" in stable
        assert "Workspace" in stable

    def test_absent_when_off(self, monkeypatch, tmp_path):
        _init_code_repo(tmp_path)
        monkeypatch.setenv("TERMINAL_CWD", str(tmp_path))
        agent = _make_agent(valid_tool_names=["read_file"], platform="cli")
        # Drive the real path: force the resolved mode to "off" via config.
        with patch("agent.coding_context._coding_mode", return_value="off"):
            stable = _stable_prompt(agent)
        assert "coding agent" not in stable

    def test_absent_without_tools(self, monkeypatch, tmp_path):
        _init_code_repo(tmp_path)
        monkeypatch.setenv("TERMINAL_CWD", str(tmp_path))
        agent = _make_agent(valid_tool_names=[], platform="cli")
        assert "coding agent" not in _stable_prompt(agent)


class TestTelegramRichMessagesHint:
    """Verify that TELEGRAM_RICH_MESSAGES_HINT is conditionally included."""

    def test_base_hint_without_rich_messages(self, monkeypatch):
        """When rich_messages is False (default), only the base hint is used."""
        agent = _make_agent(platform="telegram")
        # Mock config to return rich_messages: false (default)
        with patch("hermes_cli.config.load_config_readonly") as mock_cfg:
            mock_cfg.return_value = {
                "platforms": {"telegram": {"extra": {"rich_messages": False}}}
            }
            stable = _stable_prompt(agent)
        # Base hint should be present
        assert "Standard Markdown is automatically converted" in stable
        # Rich-messages extension should NOT be present
        assert "lean into it" not in stable
        assert "task lists" not in stable

    def test_rich_hint_with_rich_messages_enabled(self, monkeypatch):
        """When rich_messages is True, the rich-messages extension is appended."""
        agent = _make_agent(platform="telegram")
        with patch("hermes_cli.config.load_config_readonly") as mock_cfg:
            mock_cfg.return_value = {
                "platforms": {"telegram": {"extra": {"rich_messages": True}}}
            }
            stable = _stable_prompt(agent)
        # Base hint should be present
        assert "Standard Markdown is automatically converted" in stable
        # Rich-messages extension should be present
        assert "lean into it" in stable
        assert "task lists" in stable
        assert "math/formulas" in stable

    def test_base_hint_without_config(self, monkeypatch):
        """When config has no telegram section, only base hint is used."""
        agent = _make_agent(platform="telegram")
        with patch("hermes_cli.config.load_config_readonly") as mock_cfg:
            mock_cfg.return_value = {}
            stable = _stable_prompt(agent)
        assert "Standard Markdown is automatically converted" in stable
        assert "lean into it" not in stable


class TestDaypartLabel:
    def test_every_hour_maps_to_a_label(self):
        assert {daypart_label(h) for h in range(24)} == {
            "late night", "early morning", "morning", "midday",
            "afternoon", "early evening", "evening", "late evening",
        }

    def test_boundaries(self):
        assert daypart_label(0) == "late night"
        assert daypart_label(5) == "late night"
        assert daypart_label(6) == "early morning"
        assert daypart_label(9) == "morning"
        assert daypart_label(23) == "late evening"

    def test_buckets_turn_over_a_handful_of_times_a_day(self):
        """Byte-stability is the whole reason these are buckets, not a clock."""
        changes = sum(
            daypart_label(h) != daypart_label(h - 1) for h in range(1, 24)
        )
        assert changes <= 8


class TestConversationGapLabel:
    def test_same_day_uses_elapsed_time(self):
        assert conversation_gap_label(60, 0) == "just now"
        assert conversation_gap_label(45 * 60, 0) == "about an hour ago"
        assert conversation_gap_label(3 * 3600, 0) == "a few hours ago"
        assert conversation_gap_label(10 * 3600, 0) == "earlier today"

    def test_longer_gaps_count_calendar_days(self):
        assert conversation_gap_label(30 * 3600, 1) == "yesterday"
        assert conversation_gap_label(3 * 86400, 3) == "2-3 days ago"
        assert conversation_gap_label(6 * 86400, 6) == "about a week ago"
        assert conversation_gap_label(12 * 86400, 12) == "over a week ago"
        assert conversation_gap_label(400 * 86400, 400) == "a long time ago"

    def test_goodnight_then_next_morning_is_yesterday_not_today(self):
        """22:00 → 10:00 next day is 12h but one date apart."""
        assert conversation_gap_label(12 * 3600, 1) == "yesterday"

    def test_thirty_six_hours_spanning_two_dates_is_not_yesterday(self):
        """The real-data case: 08-29 22:08 → 08-31 10:00 is 前天, not 昨天."""
        assert conversation_gap_label(36 * 3600, 2) == "2-3 days ago"

    def test_crossing_midnight_by_minutes_still_reads_as_continuous(self):
        assert conversation_gap_label(7 * 60, 1) == "just now"

    def test_negative_clock_skew_is_not_a_long_silence(self):
        assert conversation_gap_label(-5000, 0) == "just now"
        assert conversation_gap_label(-5000, -3) == "just now"


class TestTimeAwarenessLines:
    NOW = datetime.datetime(2026, 8, 31, 22, 30, 0)

    def _agent(self, awareness, last_ts, *, session_id="s-now"):
        db = SimpleNamespace(
            get_last_user_message_at=lambda **kw: last_ts,
        )
        return _make_agent(
            _time_awareness=awareness, _session_db=db, session_id=session_id
        )

    def test_off_by_default(self):
        assert build_time_awareness_lines(_make_agent(), self.NOW) == []

    def test_explicit_off_emits_nothing(self):
        assert build_time_awareness_lines(self._agent("off", 0), self.NOW) == []

    def test_bucket_emits_daypart_and_gap(self):
        last = (self.NOW - datetime.timedelta(days=3)).timestamp()
        lines = build_time_awareness_lines(self._agent("bucket", last), self.NOW)
        assert lines == [
            "Time of day: evening",
            "Last message from the user: 2-3 days ago",
        ]

    def test_gap_is_measured_in_calendar_days_end_to_end(self):
        """22:30 now, user last spoke 22:08 two dates ago → 前天, not 昨天."""
        last = datetime.datetime(2026, 8, 29, 22, 8, 56).timestamp()
        lines = build_time_awareness_lines(self._agent("bucket", last), self.NOW)
        assert lines[1] == "Last message from the user: 2-3 days ago"

    def test_no_history_says_so_rather_than_guessing(self):
        lines = build_time_awareness_lines(self._agent("bucket", None), self.NOW)
        assert lines[1].endswith("no earlier conversation on record")

    def test_current_session_is_excluded_from_the_lookup(self):
        seen = {}

        def _getter(**kw):
            seen.update(kw)
            return None

        agent = _make_agent(
            _time_awareness="bucket",
            _session_db=SimpleNamespace(get_last_user_message_at=_getter),
            session_id="sess-42",
        )
        build_time_awareness_lines(agent, self.NOW)
        assert seen == {"exclude_session_id": "sess-42"}

    def test_daypart_survives_a_broken_session_store(self):
        """A store failure must not cost the time-of-day line."""
        def _boom(**kw):
            raise RuntimeError("db gone")

        agent = _make_agent(
            _time_awareness="bucket",
            _session_db=SimpleNamespace(get_last_user_message_at=_boom),
            session_id="s",
        )
        assert build_time_awareness_lines(agent, self.NOW) == ["Time of day: evening"]

    def test_store_without_the_method_degrades(self):
        agent = _make_agent(
            _time_awareness="bucket", _session_db=SimpleNamespace(), session_id="s"
        )
        assert build_time_awareness_lines(agent, self.NOW) == ["Time of day: evening"]

    def test_lines_reach_the_volatile_tier(self):
        last = (self.NOW - datetime.timedelta(minutes=5)).timestamp()
        agent = self._agent("bucket", last)
        with (
            patch("run_agent.load_soul_md", return_value=""),
            patch("run_agent.build_nous_subscription_prompt", return_value=""),
            patch("run_agent.build_environment_hints", return_value=""),
            patch("run_agent.build_context_files_prompt", return_value=""),
        ):
            volatile = build_system_prompt_parts(agent)["volatile"]
        assert "Time of day:" in volatile
        assert "Last message from the user: just now" in volatile

    def test_volatile_tier_unchanged_when_off(self):
        agent = _make_agent()
        with (
            patch("run_agent.load_soul_md", return_value=""),
            patch("run_agent.build_nous_subscription_prompt", return_value=""),
            patch("run_agent.build_environment_hints", return_value=""),
            patch("run_agent.build_context_files_prompt", return_value=""),
        ):
            volatile = build_system_prompt_parts(agent)["volatile"]
        assert "Time of day:" not in volatile
        assert "Last message from the user" not in volatile
