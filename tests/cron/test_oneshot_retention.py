"""One-shot jobs created from the web must survive their own run.

``create_job`` is written for the command line: it forces ``repeat=1`` on a
one-shot, and ``mark_job_run`` then deletes the record the moment it finishes.
That is right for "remind me in 30 minutes" typed at a prompt, and wrong for a
workbench, where the task has to stay listed as 已完成 next to its execution
record. The API server clears the repeat limit for exactly this reason, so
these tests pin both halves of the contract — including that a retained
one-shot can never fire a second time.
"""

from __future__ import annotations

import pytest

from cron.jobs import (
    create_job,
    get_due_jobs,
    load_jobs,
    mark_job_run,
    update_job,
    use_cron_store,
)

# What gateway/platforms/api_server.py `_finalize_web_job` writes.
_NO_REPEAT_LIMIT = {"times": None, "completed": 0}


@pytest.fixture
def cron_store(tmp_path):
    with use_cron_store(tmp_path / "cron-home"):
        yield


def test_cli_one_shot_is_deleted_after_running(cron_store):
    """The existing CLI/assistant behaviour, pinned so a change is visible."""
    job = create_job(prompt="提醒喝水", schedule="5m", name="CLI 一次性")
    assert job["repeat"] == {"times": 1, "completed": 0}

    mark_job_run(job["id"], success=True)

    assert load_jobs() == []


def test_web_one_shot_stays_as_completed(cron_store):
    job = create_job(prompt="提醒喝水", schedule="5m", name="Web 一次性")
    update_job(job["id"], {"repeat": dict(_NO_REPEAT_LIMIT)})

    mark_job_run(job["id"], success=True)

    remaining = load_jobs()
    assert [entry["name"] for entry in remaining] == ["Web 一次性"]
    finished = remaining[0]
    assert finished["state"] == "completed"
    assert finished["enabled"] is False
    assert finished["next_run_at"] is None
    assert finished["last_run_at"]


def test_retained_one_shot_never_fires_again(cron_store):
    """Keeping the record must not turn a one-shot into a recurring job."""
    job = create_job(prompt="提醒喝水", schedule="5m", name="Web 一次性")
    update_job(job["id"], {"repeat": dict(_NO_REPEAT_LIMIT)})
    mark_job_run(job["id"], success=True)

    assert get_due_jobs() == []

    # Even re-enabled by hand it has no next run: once last_run_at is set,
    # _recoverable_oneshot_run_at refuses to re-arm the schedule.
    update_job(job["id"], {"enabled": True, "state": "scheduled"})
    assert get_due_jobs() == []


def test_failed_web_one_shot_is_also_retained(cron_store):
    """A failure is exactly when the record matters most."""
    job = create_job(prompt="提醒喝水", schedule="5m", name="Web 一次性")
    update_job(job["id"], {"repeat": dict(_NO_REPEAT_LIMIT)})

    mark_job_run(job["id"], success=False, error="boom")

    remaining = load_jobs()
    assert len(remaining) == 1
    assert remaining[0]["last_status"] == "error"
    assert remaining[0]["last_error"] == "boom"
