"""Turn a human schedule sentence into a schedule cron can run.

The web workbench gives people one free-text field for *when* a task should
run ("每天早上 9 点", "每 15 分钟", "5 分钟后提醒一次"), and a model turns that
into a schedule expression. This module is that conversion, plus the
plain-Chinese read-back the form echoes so a misreading is caught before the
job exists.

Two paths only:

1. **Passthrough** — the text already *is* a machine schedule: a 5-field cron
   expression, ``every 30m``, or an ISO timestamp. Nothing to interpret, so no
   model call. Note a bare duration ("30m") is deliberately NOT in this set:
   it reads as both "in 30 minutes" and "every 30 minutes", so it goes to the
   model like any other ambiguous phrasing.
2. **LLM** — everything else, including one-shots. Its answer is never
   trusted directly: it has to survive ``parse_schedule`` before it can
   become a job.

Callers resolve a sentence at most twice per job (once for the form preview,
once when the job is created — and the API server caches the preview so the
second one is normally free), because the job stores the original sentence in
``schedule_display`` and never re-parses on read.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ScheduleParseUnavailable(RuntimeError):
    """The model behind schedule parsing could not be reached.

    Distinct from a ``ValueError``: that one means "your sentence has no
    usable time in it", which is the user's to fix. This one means the parse
    never happened, and telling someone to rewrite a perfectly good sentence
    would send them chasing the wrong problem.
    """

# Model output is a schedule expression, not prose — anything longer than this
# is a refusal, an explanation, or a hallucinated paragraph.
_MAX_LLM_REPLY_CHARS = 120

_INTERVAL_RE = re.compile(r"every\s+(\d+)\s*([mhd])", re.IGNORECASE)
_CRON_FIELD_RE = re.compile(r"^[\d*\-,/]+$")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")

_WEEKDAY_NAMES = {
    0: "周日", 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日",
}


def _is_machine_schedule(text: str) -> bool:
    """Whether ``text`` is already an expression cron understands verbatim.

    Only unambiguous machine forms count. A bare duration is excluded on
    purpose (see the module docstring).
    """
    if _INTERVAL_RE.fullmatch(text):
        return True
    fields = text.split()
    if len(fields) >= 5 and all(_CRON_FIELD_RE.fullmatch(field) for field in fields[:5]):
        return True
    return "T" in text or bool(_ISO_DATE_RE.match(text))


def _describe_weekday(field: str) -> Optional[str]:
    """Human wording for a cron weekday field, or None when too complex."""
    if field == "1-5":
        return "每个工作日"
    if field == "0":
        return "每周日"
    if field == "6":
        return "每周六"
    if field in {"6,0", "0,6", "6,7"}:
        return "每周六和周日"
    if field.isdigit() and int(field) in _WEEKDAY_NAMES:
        return f"每{_WEEKDAY_NAMES[int(field)]}"
    return None


def describe(expression: str, parsed: Optional[Dict[str, Any]] = None) -> str:
    """Plain-Chinese reading of a resolved schedule.

    Shown next to the expression itself so someone can tell at a glance that
    "每天早上 9 点" really became 09:00 and not 21:00. Anything outside the
    common shapes degrades to naming the raw cron fields rather than guessing.
    """
    if parsed and parsed.get("kind") == "once":
        run_at = str(parsed.get("run_at") or "").strip()
        when = _format_local(run_at) if run_at else ""
        return f"{when} 执行一次，之后不再重复" if when else "只执行一次，之后不再重复"

    expr = str(expression or "").strip()
    interval = _INTERVAL_RE.fullmatch(expr)
    if interval:
        amount = int(interval.group(1))
        unit = {"m": "分钟", "h": "小时", "d": "天"}[interval.group(2).lower()]
        return f"每 {amount} {unit}执行一次"

    fields = expr.split()
    if len(fields) != 5:
        return f"按 cron 表达式 {expr} 执行"
    minute, hour, day, month, weekday = fields

    step_minute = re.fullmatch(r"\*/(\d+)", minute)
    if step_minute and (hour, day, month, weekday) == ("*", "*", "*", "*"):
        return f"每 {int(step_minute.group(1))} 分钟执行一次"
    step_hour = re.fullmatch(r"\*/(\d+)", hour)
    if step_hour and minute.isdigit() and (day, month, weekday) == ("*", "*", "*"):
        return f"每 {int(step_hour.group(1))} 小时执行一次（在第 {int(minute)} 分钟）"

    if not (minute.isdigit() and hour.isdigit()):
        return f"按 cron 表达式 {expr} 执行"
    clock = f"{int(hour):02d}:{int(minute):02d}"

    if month == "*" and day == "*":
        if weekday == "*":
            return f"每天 {clock} 执行"
        weekday_text = _describe_weekday(weekday)
        if weekday_text:
            return f"{weekday_text} {clock} 执行"
    if month == "*" and weekday == "*" and day.isdigit():
        return f"每月 {int(day)} 号 {clock} 执行"

    return f"按 cron 表达式 {expr} 执行"


def _format_local(iso_value: str) -> str:
    """Render an ISO timestamp as a local wall-clock string, or "" on junk."""
    from datetime import datetime

    try:
        moment = datetime.fromisoformat(iso_value)
    except ValueError:
        return ""
    return moment.strftime("%Y-%m-%d %H:%M")


def upcoming_runs(parsed: Dict[str, Any], count: int = 5) -> list[str]:
    """The next few fire times for a parsed schedule, as ISO strings.

    A single "next run" is not enough to catch a misread: "每周一 09:00" and
    "每天 09:00" both look right until you see the following three lines.
    One-shots naturally yield exactly one.
    """
    from datetime import timedelta

    from hermes_time import now as _now

    if count < 1:
        return []
    kind = parsed.get("kind")
    start = _now()

    if kind == "interval":
        minutes = parsed.get("minutes")
        if not minutes:
            return []
        return [
            (start + timedelta(minutes=minutes * step)).isoformat()
            for step in range(1, count + 1)
        ]

    if kind == "cron":
        expr = parsed.get("expr")
        if not expr:
            return []
        try:
            from croniter import croniter
        except ImportError:
            return []
        try:
            from datetime import datetime as _datetime

            cursor = croniter(expr, start)
            return [cursor.get_next(_datetime).isoformat() for _ in range(count)]
        except Exception:
            logger.debug("schedule_text: cannot expand %r", expr, exc_info=True)
            return []

    run_at = parsed.get("run_at")
    return [str(run_at)] if run_at else []


_LLM_SYSTEM_PROMPT = (
    "You convert a schedule description into ONE schedule expression for a cron "
    "system. Reply with the expression ONLY — no quotes, no explanation, no code "
    "fences.\n"
    "Current local time is {now} ({tz}). Resolve relative wording against it.\n"
    "Pick exactly one form:\n"
    "  - repeating, clock-based: 5-field cron 'minute hour day month weekday'\n"
    "      (e.g. '0 9 * * *' daily 09:00, '30 8 * * 1-5' weekdays 08:30)\n"
    "  - repeating, fixed interval: 'every 15m', 'every 2h'\n"
    "  - ONE-TIME: an ISO timestamp '{example_iso}' for an absolute moment, or a "
    "duration from now such as '5m' / '2h' / '1d'\n"
    "Weekday 0 = Sunday. When only a time of day is given, schedule it daily. "
    "Choose a one-time form only when the description asks for a single run "
    "(e.g. 'in 5 minutes', 'tomorrow 9am, just once'); otherwise assume "
    "repeating.\n"
    "Everyday routine wording is fair game — read it as the conventional "
    "office-hours clock time (e.g. 上班/morning start 09:00, 午休/lunch 12:00, "
    "下班/end of day 18:00, 睡前/bedtime 23:00) and combine it with any day "
    "restriction such as 工作日 (weekdays). The user is shown the resolved time "
    "and has to confirm it, so a sensible reading beats a refusal. Reply "
    "exactly UNKNOWN only when the description carries no timing intent at all "
    "(e.g. '看心情', 'whenever')."
)


def _llm_system_prompt() -> str:
    from datetime import timedelta

    from hermes_time import now as _now

    moment = _now()
    return _LLM_SYSTEM_PROMPT.format(
        now=moment.strftime("%Y-%m-%d %H:%M"),
        tz=moment.tzname() or "local",
        example_iso=(moment + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:00"),
    )


def _expr_from_llm(text: str) -> Optional[str]:
    """Ask the auxiliary model for a schedule expression.

    Returns ``None`` when the model answers but its answer is unusable, and
    raises ``ScheduleParseUnavailable`` when the call itself fails.
    """
    try:
        from agent.auxiliary_client import call_llm
    except Exception as exc:
        logger.warning("schedule_text: auxiliary client unavailable", exc_info=True)
        raise ScheduleParseUnavailable("auxiliary client unavailable") from exc
    try:
        response = call_llm(
            task="cron_schedule",
            messages=[
                {"role": "system", "content": _llm_system_prompt()},
                {"role": "user", "content": text},
            ],
            temperature=0,
            max_tokens=32,
        )
        choice = response.choices[0].message.content or ""
    except Exception as exc:
        logger.warning("schedule_text: LLM schedule parse failed", exc_info=True)
        raise ScheduleParseUnavailable("schedule parsing backend failed") from exc
    reply = choice.strip().strip("`").strip()
    if not reply or len(reply) > _MAX_LLM_REPLY_CHARS or reply.upper() == "UNKNOWN":
        return None
    # Take the first line only — some models append a justification.
    return reply.splitlines()[0].strip()


GUIDANCE = (
    "没识别出执行时间。可以这样写：每 30 分钟、每小时、每天 09:00、"
    "每天早上 9 点、每周一 09:00、每个工作日 08:30、每月 1 号 10:00；"
    "只跑一次可以写：5 分钟后、明天早上 9 点执行一次。"
)


def parse_schedule_text(text: str, *, allow_llm: bool = True) -> Dict[str, Any]:
    """Resolve a human schedule sentence into a concrete cron schedule.

    Returns ``{"schedule", "kind", "display", "description", "next_run_at",
    "next_runs", "once", "source"}``: ``schedule`` is the expression to
    persist on the job, ``display`` the user's own sentence (what the task
    list shows), and ``description`` + ``next_runs`` are what the form echoes
    back so a misreading is caught before the job exists.

    Raises ``ValueError`` with actionable guidance when the sentence carries
    no usable time (the caller surfaces it verbatim), and
    ``ScheduleParseUnavailable`` when the model could not be reached at all —
    two different messages, because only one of them is the user's to fix.
    """
    from cron.jobs import compute_next_run, parse_schedule

    def _result(expr: str, parsed: Dict[str, Any], raw_text: str, source: str) -> Dict[str, Any]:
        runs = upcoming_runs(parsed)
        return {
            "schedule": expr,
            "kind": parsed.get("kind", ""),
            "display": raw_text,
            "description": describe(expr, parsed),
            "next_run_at": runs[0] if runs else compute_next_run(parsed),
            "next_runs": runs,
            "once": parsed.get("kind") == "once",
            "source": source,
        }

    raw = str(text or "").strip()
    if not raw:
        raise ValueError(GUIDANCE)

    if _is_machine_schedule(raw):
        try:
            parsed = parse_schedule(raw)
        except ValueError:
            parsed = None
        if parsed is not None:
            return _result(raw, parsed, raw, "passthrough")

    if allow_llm:
        llm_expr = _expr_from_llm(raw)
        if llm_expr:
            try:
                parsed = parse_schedule(llm_expr)
            except ValueError:
                logger.info("schedule_text: LLM returned unusable expression %r", llm_expr)
            else:
                return _result(llm_expr, parsed, raw, "llm")

    raise ValueError(GUIDANCE)
