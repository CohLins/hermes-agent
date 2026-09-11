"""Human schedule sentence -> cron schedule (cron/schedule_text.py).

The web task form takes one free-text field for "when should this run", so
what matters here is: machine-format input never costs a model call, an
ambiguous or Chinese sentence does, the model's answer is only accepted when
``parse_schedule`` agrees with it, and the read-back (description + next few
runs) actually describes what will happen.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from cron.schedule_text import describe, parse_schedule_text, upcoming_runs


def _llm(reply: str) -> MagicMock:
    return MagicMock(
        return_value=SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=reply))]
        )
    )


def _future_iso(**delta) -> str:
    from hermes_time import now as hermes_now

    return (hermes_now() + timedelta(**delta)).strftime("%Y-%m-%dT%H:%M:00")


class TestPassthrough:
    """Text that already IS a schedule must not go anywhere near the model."""

    @pytest.mark.parametrize("text", ["0 9 * * *", "every 30m", "*/10 * * * *", "30 8 * * 1-5"])
    def test_machine_formats_resolve_offline(self, text):
        llm = MagicMock()
        with patch("agent.auxiliary_client.call_llm", llm):
            result = parse_schedule_text(text)

        assert result["schedule"] == text
        assert result["source"] == "passthrough"
        assert result["display"] == text
        assert result["next_runs"]
        llm.assert_not_called()

    def test_iso_timestamp_is_a_one_shot(self):
        moment = _future_iso(hours=2)
        llm = MagicMock()
        with patch("agent.auxiliary_client.call_llm", llm):
            result = parse_schedule_text(moment)

        assert result["kind"] == "once"
        assert result["once"] is True
        assert len(result["next_runs"]) == 1
        llm.assert_not_called()

    def test_bare_duration_is_ambiguous_and_goes_to_the_model(self):
        """"30m" reads as both "in 30 minutes" and "every 30 minutes"."""
        llm = _llm("every 30m")
        with patch("agent.auxiliary_client.call_llm", llm):
            result = parse_schedule_text("30m")

        assert result["schedule"] == "every 30m"
        assert result["source"] == "llm"
        llm.assert_called_once()


class TestModelResolution:
    @pytest.mark.parametrize(
        "reply,expected_kind,expected_once",
        [
            ("0 9 * * *", "cron", False),
            ("every 15m", "interval", False),
            ("5m", "once", True),
            ("1d", "once", True),
        ],
    )
    def test_accepted_answers_cover_repeating_and_one_shot(
        self, reply, expected_kind, expected_once
    ):
        with patch("agent.auxiliary_client.call_llm", _llm(reply)):
            result = parse_schedule_text("随便一句中文")

        assert result["schedule"] == reply
        assert result["kind"] == expected_kind
        assert result["once"] is expected_once
        assert result["source"] == "llm"
        # The list column keeps the user's own wording, not the expression.
        assert result["display"] == "随便一句中文"

    def test_absolute_one_shot_answer_is_accepted(self):
        moment = _future_iso(days=1)
        with patch("agent.auxiliary_client.call_llm", _llm(moment)):
            result = parse_schedule_text("明天这个点提醒我一次")

        assert result["once"] is True
        assert result["next_runs"] == [result["next_run_at"]]

    def test_prompt_carries_the_current_time_for_relative_wording(self):
        """Without "now" the model cannot resolve "明天早上 9 点"."""
        from hermes_time import now as hermes_now

        llm = _llm("0 9 * * *")
        with patch("agent.auxiliary_client.call_llm", llm):
            parse_schedule_text("明天早上 9 点")

        system_prompt = llm.call_args.kwargs["messages"][0]["content"]
        assert hermes_now().strftime("%Y-%m-%d %H:%M") in system_prompt

    def test_answer_is_only_trusted_after_parse_schedule_agrees(self):
        with patch("agent.auxiliary_client.call_llm", _llm("not a schedule")):
            with pytest.raises(ValueError, match="没识别出执行时间"):
                parse_schedule_text("看心情跑一下")

    @pytest.mark.parametrize("reply", ["UNKNOWN", "抱歉，这个描述我没法转换成 cron 表达式", ""])
    def test_refusals_surface_guidance(self, reply):
        with patch("agent.auxiliary_client.call_llm", _llm(reply)):
            with pytest.raises(ValueError, match="没识别出执行时间"):
                parse_schedule_text("看心情跑一下")

    def test_backend_failure_is_not_reported_as_a_bad_sentence(self):
        """A provider outage must not tell the user to rewrite a fine sentence."""
        from cron.schedule_text import ScheduleParseUnavailable

        llm = MagicMock(side_effect=RuntimeError("provider down"))
        with patch("agent.auxiliary_client.call_llm", llm):
            with pytest.raises(ScheduleParseUnavailable):
                parse_schedule_text("每天早上九点")

    @pytest.mark.parametrize("text", ["", "   "])
    def test_empty_text_never_calls_the_model(self, text):
        llm = MagicMock()
        with patch("agent.auxiliary_client.call_llm", llm):
            with pytest.raises(ValueError, match="没识别出执行时间"):
                parse_schedule_text(text)
        llm.assert_not_called()

    def test_allow_llm_false_keeps_it_offline(self):
        llm = MagicMock()
        with patch("agent.auxiliary_client.call_llm", llm):
            with pytest.raises(ValueError):
                parse_schedule_text("每天早上九点", allow_llm=False)
        llm.assert_not_called()


class TestEcho:
    """The description and the next few runs are what the user actually checks."""

    @pytest.mark.parametrize(
        "expression,description",
        [
            ("every 30m", "每 30 分钟执行一次"),
            ("every 2h", "每 2 小时执行一次"),
            ("0 9 * * *", "每天 09:00 执行"),
            ("0 9 * * 1", "每周一 09:00 执行"),
            ("0 8 * * 0", "每周日 08:00 执行"),
            ("30 8 * * 1-5", "每个工作日 08:30 执行"),
            ("0 10 1 * *", "每月 1 号 10:00 执行"),
            ("*/10 * * * *", "每 10 分钟执行一次"),
            ("0 */6 * * *", "每 6 小时执行一次（在第 0 分钟）"),
        ],
    )
    def test_expression_gets_a_plain_chinese_reading(self, expression, description):
        assert describe(expression) == description

    def test_unusual_expression_falls_back_to_naming_the_cron(self):
        assert describe("0 9 1,15 * 3") == "按 cron 表达式 0 9 1,15 * 3 执行"

    def test_one_shot_description_says_it_runs_once(self):
        text = describe("5m", {"kind": "once", "run_at": "2026-09-12T09:30:00+08:00"})
        assert text == "2026-09-12 09:30 执行一次，之后不再重复"

    def test_next_runs_are_five_ascending_times(self):
        runs = upcoming_runs({"kind": "cron", "expr": "0 9 * * 1"})
        assert len(runs) == 5
        assert runs == sorted(runs)
        first, second = (datetime.fromisoformat(value) for value in runs[:2])
        # 每周一 -> 相邻两次相差 7 天。
        assert (second - first).days == 7

    def test_interval_next_runs_step_by_the_interval(self):
        runs = upcoming_runs({"kind": "interval", "minutes": 15})
        first, second = (datetime.fromisoformat(value) for value in runs[:2])
        assert (second - first).total_seconds() == 15 * 60

    def test_one_shot_yields_exactly_one_run(self):
        assert upcoming_runs({"kind": "once", "run_at": "2026-09-12T09:00:00+08:00"}) == [
            "2026-09-12T09:00:00+08:00"
        ]
