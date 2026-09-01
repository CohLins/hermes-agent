"""Tests for SessionDB.get_last_user_message_at — "when did the human last speak".

Two exclusions carry the entire result, and both are easy to get wrong:

* cron-sourced sessions, whose "user turn" is the job description;
* cron output mirrored back into the origin transcript, which
  ``gateway/mirror.py`` deliberately writes with ``role="user"`` and whose
  ``mirror_source`` metadata is dropped at the SQLite boundary — leaving the
  ``[Cron delivery:`` content prefix as the only surviving marker.

Miss either one and the agent's own scheduled messages read as the user
speaking, so a bubble twenty minutes ago hides a three-day silence.
"""
import pytest

from hermes_state import SessionDB

DAY = 86400.0
NOW = 1_800_000_000.0


@pytest.fixture
def db(tmp_path):
    return SessionDB(tmp_path / "state.db")


def _say(db, session, role, content, ts, mirror_source=None):
    db.append_message(
        session_id=session, role=role, content=content, timestamp=ts,
        mirror_source=mirror_source,
    )


def test_none_when_nobody_has_spoken(db):
    db.create_session("s1", source="weixin")
    assert db.get_last_user_message_at() is None


def test_returns_latest_real_user_message(db):
    db.create_session("s1", source="weixin")
    _say(db, "s1", "user", "早", NOW - 3 * DAY)
    _say(db, "s1", "assistant", "早呀", NOW - 3 * DAY + 10)
    _say(db, "s1", "user", "在吗", NOW - DAY)
    assert db.get_last_user_message_at() == pytest.approx(NOW - DAY)


def test_assistant_replies_do_not_count_as_the_user_speaking(db):
    db.create_session("s1", source="weixin")
    _say(db, "s1", "user", "在吗", NOW - 5 * DAY)
    _say(db, "s1", "assistant", "咕嘎在", NOW - 1.0)
    assert db.get_last_user_message_at() == pytest.approx(NOW - 5 * DAY)


def test_cron_sessions_are_excluded(db):
    """A cron run's prompt is stored as a user turn but nobody said it."""
    db.create_session("chat", source="weixin")
    db.create_session("job", source="cron")
    _say(db, "chat", "user", "在吗", NOW - 4 * DAY)
    _say(db, "job", "user", "这是你的心跳，不是任务。", NOW - 60.0)
    assert db.get_last_user_message_at() == pytest.approx(NOW - 4 * DAY)


def test_mirrored_cron_delivery_is_excluded_by_the_marker(db):
    """The mirror lands in the *origin* session as role='user' — the trap.

    Identified structurally, so the label wording is free to change.
    """
    db.create_session("chat", source="weixin")
    _say(db, "chat", "user", "然后呢", NOW - 3 * DAY)
    _say(
        db, "chat", "user",
        "[Your own scheduled message (job: 心跳) — not from the user]\n刚查了下天气。",
        NOW - 600.0,
        mirror_source="cron",
    )
    assert db.get_last_user_message_at() == pytest.approx(NOW - 3 * DAY)


def test_legacy_prefix_rows_without_the_marker_are_still_excluded(db):
    """Rows written before ``mirror_source`` existed carry only the old prefix."""
    db.create_session("chat", source="weixin")
    _say(db, "chat", "user", "然后呢", NOW - 3 * DAY)
    _say(
        db, "chat", "user",
        "[Cron delivery: 心跳]\n刚查了下深圳天气：今天雷阵雨。",
        NOW - 600.0,
    )
    assert db.get_last_user_message_at() == pytest.approx(NOW - 3 * DAY)


def test_marker_is_what_matters_not_the_wording(db):
    """A relabelled mirror with no recognisable prefix is still excluded."""
    db.create_session("chat", source="weixin")
    _say(db, "chat", "user", "然后呢", NOW - 3 * DAY)
    _say(db, "chat", "user", "完全没有前缀的一句话", NOW - 60.0, mirror_source="cron")
    assert db.get_last_user_message_at() == pytest.approx(NOW - 3 * DAY)


def test_marker_survives_a_bulk_transcript_rewrite(db):
    """/compress and friends reinsert rows in bulk — the marker must persist."""
    db.create_session("chat", source="weixin")
    db.replace_messages("chat", [
        {"role": "user", "content": "然后呢", "timestamp": NOW - 3 * DAY},
        {
            "role": "user",
            "content": "咕嘎自己的冒泡",
            "timestamp": NOW - 60.0,
            "mirror_source": "cron",
        },
    ])
    assert db.get_last_user_message_at() == pytest.approx(NOW - 3 * DAY)


def test_both_exclusions_together(db):
    db.create_session("chat", source="weixin")
    db.create_session("job", source="cron")
    _say(db, "chat", "user", "然后呢", NOW - 3 * DAY)
    _say(db, "job", "user", "心跳提示词", NOW - 3600.0)
    _say(db, "chat", "user", "刚逛到一个地方", NOW - 600.0, mirror_source="cron")
    _say(db, "chat", "assistant", "……", NOW - 300.0)
    assert db.get_last_user_message_at() == pytest.approx(NOW - 3 * DAY)


def test_a_message_merely_mentioning_cron_delivery_still_counts(db):
    """Only the leading marker is a mirror; the user may talk *about* cron."""
    db.create_session("chat", source="weixin")
    _say(db, "chat", "user", "早", NOW - 5 * DAY)
    _say(db, "chat", "user", "那个 [Cron delivery: 心跳] 前缀能去掉吗", NOW - 60.0)
    assert db.get_last_user_message_at() == pytest.approx(NOW - 60.0)


def test_exclude_session_id_skips_the_current_session(db):
    db.create_session("old", source="weixin")
    db.create_session("cur", source="weixin")
    _say(db, "old", "user", "上次说的那个", NOW - 2 * DAY)
    _say(db, "cur", "user", "刚发的这句", NOW - 5.0)
    assert db.get_last_user_message_at() == pytest.approx(NOW - 5.0)
    assert db.get_last_user_message_at(exclude_session_id="cur") == pytest.approx(
        NOW - 2 * DAY
    )


def test_spans_sessions_without_needing_a_peer_tuple(db):
    """Scope is the store, not a routing peer — peer columns may be NULL."""
    db.create_session("s1", source="weixin")
    db.create_session("s2", source="weixin")
    _say(db, "s1", "user", "老会话", NOW - 9 * DAY)
    _say(db, "s2", "user", "新会话", NOW - 2 * DAY)
    assert db.get_last_user_message_at() == pytest.approx(NOW - 2 * DAY)
