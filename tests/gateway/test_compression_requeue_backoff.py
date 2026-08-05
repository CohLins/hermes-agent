"""Regression: compression-period internal-notification re-injection must back
off, not busy-loop.

gateway.log 2026-08-03 09:40-41: a watch/completion internal event injected into
a session that was mid-compression (agent-side Pre-API compression held the
compression lock ~89s) was demoted (#56391), then IMMEDIATELY re-spawned by
``_process_message_background``'s in-band drain — 15,113 times in 27s, pinning a
CPU core until a human SIGINT'd the gateway.

Fix (two halves):
  1. ``_queue_or_replace_pending_event`` marks the event with an incrementing
     ``metadata['gateway_requeue_count']`` each time it is demoted.
  2. The drain re-spawn path uses ``_spawn_drain_task`` which, when the event has
     already been requeued, backs off exponentially (``_drain_backoff_delay``)
     instead of re-running immediately.
"""

from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import MagicMock

# Minimal telegram stubs so gateway imports cleanly (mirrors sibling tests).
_tg = types.ModuleType("telegram")
_tg.constants = types.ModuleType("telegram.constants")
_ct = MagicMock()
_ct.SUPERGROUP = "supergroup"
_ct.GROUP = "group"
_ct.PRIVATE = "private"
_tg.constants.ChatType = _ct
sys.modules.setdefault("telegram", _tg)
sys.modules.setdefault("telegram.constants", _tg.constants)
sys.modules.setdefault("telegram.ext", types.ModuleType("telegram.ext"))

from gateway.platforms.base import (  # noqa: E402
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SessionSource,
    build_session_key,
)
from gateway.run import GatewayRunner  # noqa: E402


def _make_internal_event(text: str = "[watch notification]") -> MessageEvent:
    source = SessionSource(
        platform=MagicMock(value="feishu"),
        chat_id="oc_test",
        chat_type="dm",
        user_id="user1",
    )
    return MessageEvent(
        text=text,
        message_type=MessageType.TEXT,
        source=source,
        message_id=None,  # watch notifications carry no message_id
        internal=True,
    )


def _make_runner() -> GatewayRunner:
    runner = object.__new__(GatewayRunner)
    runner._enqueue_fifo = MagicMock()
    runner._queue_depth = MagicMock(return_value=0)
    return runner


def _make_stub_self():
    """SimpleNamespace standing in for a BasePlatformAdapter, for unbound calls.

    BasePlatformAdapter is an ABC (can't be instantiated directly); _spawn_drain_task
    only touches these attributes, so an unbound call with this stub exercises the
    real method logic without a concrete subclass.
    """
    return types.SimpleNamespace(
        _session_tasks={},
        _background_tasks=set(),
        _process_message_background=lambda ev, sk: "immediate",
        _delayed_process_message_background=lambda ev, sk, delay: ("delayed", delay),
    )


# --- A. demote marks the event -------------------------------------------------

def test_demote_marks_event_with_requeue_count():
    runner = _make_runner()
    adapter = MagicMock()
    adapter._pending_messages = {}
    runner._adapter_for_source = lambda _src: adapter
    event = _make_internal_event()
    sk = build_session_key(event.source)

    runner._queue_or_replace_pending_event(sk, event)
    runner._queue_or_replace_pending_event(sk, event)

    # Each demote bumps the counter so the drain can back off proportionally.
    assert event.metadata.get("gateway_requeue_count") == 2


# --- B1. backoff delay pure function ------------------------------------------

def test_drain_backoff_delay_grows_and_caps():
    from gateway.platforms.base import _drain_backoff_delay

    assert _drain_backoff_delay(0) == 0.0
    d1 = _drain_backoff_delay(1)
    d2 = _drain_backoff_delay(2)
    d3 = _drain_backoff_delay(3)
    assert 0 < d1 < d2 < d3  # monotonic growth while requeues stack up
    capped = _drain_backoff_delay(100)
    assert capped == _drain_backoff_delay(50)  # bounded, no runaway
    assert capped <= 10.0


# --- B2. spawn_drain_task chooses immediate vs delayed ------------------------

def test_spawn_drain_task_immediate_when_fresh(monkeypatch):
    created = []
    monkeypatch.setattr(asyncio, "create_task", lambda coro: created.append(coro) or MagicMock())

    stub = _make_stub_self()
    ev = _make_internal_event()  # requeue count 0 → run now
    BasePlatformAdapter._spawn_drain_task(stub, "sk", ev)

    assert created == ["immediate"]
    assert stub._session_tasks["sk"] is not None


def test_spawn_drain_task_delays_when_requeued(monkeypatch):
    from gateway.platforms.base import _drain_backoff_delay

    created = []
    monkeypatch.setattr(asyncio, "create_task", lambda coro: created.append(coro) or MagicMock())

    stub = _make_stub_self()
    ev = _make_internal_event()
    ev.metadata["gateway_requeue_count"] = 3  # already demoted 3× → back off
    BasePlatformAdapter._spawn_drain_task(stub, "sk", ev)

    assert created == [("delayed", _drain_backoff_delay(3))]
