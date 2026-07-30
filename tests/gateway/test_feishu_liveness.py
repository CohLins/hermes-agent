"""Regression tests for Feishu/Lark WebSocket 假活 (stale-connection) recovery.

The Feishu long-lived WebSocket can go silent while still reporting
``state=connected``: the lark SDK's ``recv()`` blocks forever, its app-level
ping is fire-and-forget with no pong-timeout, and the transport-level
``websockets`` ping was disabled (``ws_ping_interval``/``ws_ping_timeout``
defaulted to ``None``). The adapter never surfaced a liveness failure, so the
gateway's reconnect machinery (``_handle_adapter_fatal_error`` ->
``_failed_platforms`` -> ``_platform_reconnect_watcher``) was never engaged.

Two layers of fix are covered here:

* Part A — enable transport-level ping/pong keepalive so a dead peer raises
  ``ConnectionClosed`` and the SDK's own ``_reconnect`` self-heals.
* Part B — a Discord-style liveness watchdog that samples the SDK transport +
  a per-frame activity timestamp and, on a wedged connection, calls
  ``_notify_fatal_error()`` so the gateway rebuilds the adapter.
"""

from __future__ import annotations

import asyncio
import logging
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import lark_oapi  # noqa: F401  (ensures the SDK is importable in this env)

from gateway.config import PlatformConfig
from plugins.platforms.feishu import adapter as feishu_platform
from plugins.platforms.feishu.adapter import (
    FeishuAdapter,
    FeishuAdapterSettings,
    _run_official_feishu_ws_client,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_adapter(**extra) -> FeishuAdapter:
    return FeishuAdapter(PlatformConfig(enabled=True, extra=extra))


async def _wait_until(predicate, message: str, timeout: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            pytest.fail(message)
        await asyncio.sleep(0.005)


def _fake_conn(*, state_name: str = "OPEN", close_code=None):
    return SimpleNamespace(state=SimpleNamespace(name=state_name), close_code=close_code)


# ---------------------------------------------------------------------------
# Part A — transport-level ping/pong keepalive
# ---------------------------------------------------------------------------


def test_ws_ping_defaults_enable_transport_keepalive():
    """Dataclass and loader defaults must be non-None so the existing
    ``_connect_with_overrides`` monkeypatch actually injects keepalive."""
    fields = FeishuAdapterSettings.__dataclass_fields__
    assert fields["ws_ping_interval"].default == 30
    assert fields["ws_ping_timeout"].default == 30

    # And the config loader default (production path) must agree.
    adapter = _make_adapter()
    assert adapter._ws_ping_interval == 30
    assert adapter._ws_ping_timeout == 30


def test_ws_ping_overridable_via_config_extra():
    adapter = _make_adapter(ws_ping_interval=45, ws_ping_timeout=50)
    assert adapter._ws_ping_interval == 45
    assert adapter._ws_ping_timeout == 50


def test_run_ws_client_injects_ping_into_websockets_connect(monkeypatch):
    """The thread bootstrap must pass ping_interval/ping_timeout to
    ``websockets.connect`` so the transport keepalive is actually armed."""
    adapter = _make_adapter()
    captured: dict = {}

    def fake_connect(*args, **kwargs):
        captured.update(kwargs)
        return None

    fake_ws_module = SimpleNamespace(connect=fake_connect)
    monkeypatch.setattr(
        feishu_platform, "_run_official_feishu_ws_client",
        feishu_platform._run_official_feishu_ws_client,
    )

    import lark_oapi.ws.client as ws_client_module

    monkeypatch.setattr(ws_client_module, "websockets", fake_ws_module, raising=False)

    def fake_start():
        # The real SDK calls websockets.connect() during start(); emulate that
        # so the override closure runs and records the injected kwargs.
        ws_client_module.websockets.connect("wss://example/ws")

    ws_client = SimpleNamespace(start=fake_start)

    _run_official_feishu_ws_client(ws_client, adapter)

    assert captured.get("ping_interval") == 30
    assert captured.get("ping_timeout") == 30


# ---------------------------------------------------------------------------
# Part B — liveness watchdog config
# ---------------------------------------------------------------------------


def test_default_liveness_bounds(monkeypatch):
    for key in (
        "HERMES_FEISHU_LIVENESS_INTERVAL_SECONDS",
        "HERMES_FEISHU_LIVENESS_FAILURE_THRESHOLD",
        "HERMES_FEISHU_WS_IDLE_MAX_SECONDS",
    ):
        monkeypatch.delenv(key, raising=False)
    adapter = _make_adapter()
    assert adapter._liveness_interval_seconds == 30.0
    assert adapter._liveness_failure_threshold == 3
    assert adapter._ws_idle_max_seconds == 0.0


def test_event_idle_recovery_is_opt_in():
    """No business events is indistinguishable from a healthy quiet bot.

    Transport/thread failures remain enabled by default, while the heuristic
    event-idle refresh must be explicitly configured by deployments that prefer
    periodic connection rotation over avoiding idle reconnects.
    """
    adapter = _make_adapter()
    adapter._running = True
    adapter._ws_thread_loop = SimpleNamespace()
    adapter._ws_future = None
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._last_ws_activity_at = time.monotonic() - 3600

    assert adapter._read_ws_health(adapter._ws_client) == (True, "healthy")


def test_liveness_config_extra_overrides_env(monkeypatch):
    monkeypatch.setenv("HERMES_FEISHU_LIVENESS_INTERVAL_SECONDS", "99")
    monkeypatch.setenv("HERMES_FEISHU_LIVENESS_FAILURE_THRESHOLD", "9")
    monkeypatch.setenv("HERMES_FEISHU_WS_IDLE_MAX_SECONDS", "999")
    adapter = _make_adapter(
        ws_liveness_interval_seconds=7,
        ws_liveness_failure_threshold=2,
        ws_idle_max_seconds=120,
    )
    assert adapter._liveness_interval_seconds == 7
    assert adapter._liveness_failure_threshold == 2
    assert adapter._ws_idle_max_seconds == 120


def test_nonfinite_liveness_interval_disables_probe(monkeypatch):
    adapter = _make_adapter(ws_liveness_interval_seconds="nan")
    assert adapter._liveness_interval_seconds == 0.0


def test_nonfinite_liveness_failure_threshold_disables_probe():
    adapter = _make_adapter(ws_liveness_failure_threshold=float("inf"))
    assert adapter._liveness_failure_threshold == 0


# ---------------------------------------------------------------------------
# Part B — health sampling
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("setup", "expected_reason"),
    [
        (lambda a: setattr(a, "_ws_client", None), "no_ws_client"),
        (
            lambda a: setattr(
                a, "_ws_client", SimpleNamespace(_conn=None)
            ),
            "no_connection",
        ),
        (
            lambda a: setattr(
                a, "_ws_client",
                SimpleNamespace(_conn=_fake_conn(close_code=1006)),
            ),
            "socket_closed",
        ),
        (
            lambda a: setattr(
                a, "_ws_client",
                SimpleNamespace(_conn=_fake_conn(state_name="CLOSED")),
            ),
            "socket_not_open",
        ),
    ],
)
def test_read_ws_health_unhealthy_reasons(setup, expected_reason):
    adapter = _make_adapter()
    adapter._running = True
    adapter._ws_thread_loop = SimpleNamespace()  # not None -> not thread-death
    adapter._ws_future = None
    setup(adapter)
    healthy, reason = adapter._read_ws_health(adapter._ws_client)
    assert healthy is False
    assert reason == expected_reason


def test_read_ws_health_thread_exited():
    adapter = _make_adapter()
    adapter._running = True
    adapter._ws_thread_loop = None  # thread bootstrap finished/died
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    healthy, reason = adapter._read_ws_health(adapter._ws_client)
    assert healthy is False
    assert reason == "ws_thread_exited"


def test_read_ws_health_recv_idle():
    adapter = _make_adapter(ws_idle_max_seconds=1)
    adapter._running = True
    adapter._ws_thread_loop = SimpleNamespace()
    adapter._ws_future = None
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._last_ws_activity_at = time.monotonic() - 3600
    healthy, reason = adapter._read_ws_health(adapter._ws_client)
    assert healthy is False
    assert reason == "recv_idle"


def test_read_ws_health_healthy():
    adapter = _make_adapter()
    adapter._running = True
    adapter._ws_thread_loop = SimpleNamespace()
    adapter._ws_future = None
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._last_ws_activity_at = time.monotonic()
    healthy, reason = adapter._read_ws_health(adapter._ws_client)
    assert healthy is True
    assert reason == "healthy"


def test_read_ws_health_read_error_is_unhealthy():
    class _Boom:
        @property
        def _conn(self):
            raise RuntimeError("state unavailable")

    adapter = _make_adapter()
    adapter._running = True
    adapter._ws_thread_loop = SimpleNamespace()
    adapter._ws_future = None
    healthy, reason = adapter._read_ws_health(_Boom())
    assert healthy is False
    assert reason == "health_read_error"


# ---------------------------------------------------------------------------
# Part B — liveness loop + fatal handoff
# ---------------------------------------------------------------------------


def _arm_running_adapter(adapter, *, interval=0.005, threshold=1):
    adapter._running = True
    adapter._loop = asyncio.get_running_loop()
    adapter._ws_thread_loop = SimpleNamespace()
    adapter._ws_future = None
    adapter._liveness_interval_seconds = interval
    adapter._liveness_failure_threshold = threshold


@pytest.mark.asyncio
async def test_liveness_loop_forces_reconnect_when_unhealthy(monkeypatch):
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=0.005, threshold=2)
    adapter._ws_client = SimpleNamespace(_conn=None)  # unhealthy: no_connection
    handler = AsyncMock()
    adapter.set_fatal_error_handler(handler)

    adapter._start_liveness_probe()
    await _wait_until(
        lambda: handler.await_count,
        "liveness loop did not surface a fatal error for a wedged connection",
    )

    assert adapter.has_fatal_error is True
    assert adapter.fatal_error_code == "feishu_websocket_health_stale"
    assert adapter.fatal_error_retryable is True
    assert "no_connection" in (adapter.fatal_error_message or "")
    handler.assert_awaited_once()
    await adapter._cancel_liveness_task()


@pytest.mark.asyncio
async def test_liveness_loop_healthy_does_not_reconnect():
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=0.005, threshold=1)
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._last_ws_activity_at = time.monotonic()
    handler = AsyncMock()
    adapter.set_fatal_error_handler(handler)

    adapter._start_liveness_probe()
    await asyncio.sleep(0.05)

    assert adapter.has_fatal_error is False
    handler.assert_not_awaited()
    await adapter._cancel_liveness_task()


@pytest.mark.asyncio
async def test_liveness_loop_recovers_when_health_reader_raises(monkeypatch):
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=0.005, threshold=1)
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    monkeypatch.setattr(
        adapter,
        "_read_ws_health",
        lambda _c: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    handler = AsyncMock()
    adapter.set_fatal_error_handler(handler)

    adapter._start_liveness_probe()
    await _wait_until(
        lambda: handler.await_count,
        "liveness loop did not recover from a health-reader crash",
    )
    assert "health_check_error" in (adapter.fatal_error_message or "")
    await adapter._cancel_liveness_task()


@pytest.mark.asyncio
async def test_liveness_probe_disabled_when_interval_zero():
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=0, threshold=1)
    adapter._ws_client = SimpleNamespace(_conn=None)
    adapter._start_liveness_probe()
    assert adapter._liveness_task is None


@pytest.mark.asyncio
async def test_cancel_liveness_task_clears_probe():
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=60, threshold=1)
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._last_ws_activity_at = time.monotonic()
    adapter._start_liveness_probe()
    task = adapter._liveness_task
    assert task is not None and not task.done()

    await adapter._cancel_liveness_task()
    assert task.done()
    assert adapter._liveness_task is None


# ---------------------------------------------------------------------------
# Part B — activity stamping + SDK reconnect hooks
# ---------------------------------------------------------------------------


def test_on_reconnected_hook_resets_activity_timestamp():
    adapter = _make_adapter()
    adapter._last_ws_activity_at = 0.0
    adapter._on_ws_reconnected()
    assert adapter._last_ws_activity_at > 0.0


def test_ws_client_wraps_frames_event_clock_vs_pong_clock(monkeypatch):
    """The 假活 idle clock must track real EVENT/data frames only.

    Application-level 假活 keeps the transport (and therefore the SDK's
    PING/PONG) alive while the server stops delivering event frames. If PONG
    (a CONTROL frame) refreshed the idle clock, ``recv_idle`` could never fire.
    So the bootstrap must wrap ``_handle_data_frame`` (stamps the event clock)
    and ``_handle_control_frame`` (stamps only the observation-only pong clock),
    NOT the shared ``_handle_message`` dispatcher.
    """
    adapter = _make_adapter()
    adapter._last_ws_activity_at = 0.0
    adapter._last_ws_pong_at = 0.0

    import lark_oapi.ws.client as ws_client_module

    monkeypatch.setattr(
        ws_client_module,
        "websockets",
        SimpleNamespace(connect=lambda *a, **k: None),
        raising=False,
    )

    seen: list = []

    async def fake_data(frame):
        seen.append(("data", frame))

    async def fake_ctrl(frame):
        seen.append(("ctrl", frame))

    ws_client = SimpleNamespace(
        _handle_data_frame=fake_data,
        _handle_control_frame=fake_ctrl,
    )

    captured: dict = {}

    def fake_start():
        loop = asyncio.new_event_loop()
        # A PONG (control frame) arrives first — must NOT bump the event clock.
        loop.run_until_complete(ws_client._handle_control_frame(b"pong"))
        captured["event_after_pong"] = adapter._last_ws_activity_at
        captured["pong_after_pong"] = adapter._last_ws_pong_at
        # A real event (data frame) arrives — must bump the event clock.
        loop.run_until_complete(ws_client._handle_data_frame(b"evt"))
        captured["event_after_data"] = adapter._last_ws_activity_at
        loop.close()

    ws_client.start = fake_start

    _run_official_feishu_ws_client(ws_client, adapter)

    assert seen == [("ctrl", b"pong"), ("data", b"evt")]
    # PONG refreshed only the observation-only pong clock, not the idle clock.
    assert captured["event_after_pong"] == 0.0
    assert captured["pong_after_pong"] > 0.0
    # A real data frame refreshed the idle clock.
    assert captured["event_after_data"] > 0.0
    # Originals restored in the finally block.
    assert ws_client._handle_data_frame is fake_data
    assert ws_client._handle_control_frame is fake_ctrl


@pytest.mark.asyncio
async def test_start_liveness_probe_emits_started_event(caplog):
    """The probe must announce it started so a live gateway can confirm the
    watchdog is actually running (rules out 'watchdog never started')."""
    adapter = _make_adapter()
    adapter._running = True
    adapter._loop = asyncio.get_running_loop()
    adapter._ws_thread_loop = SimpleNamespace()
    adapter._ws_future = None
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._last_ws_activity_at = time.monotonic()
    adapter._liveness_interval_seconds = 60
    adapter._liveness_failure_threshold = 3

    with caplog.at_level(logging.INFO):
        adapter._start_liveness_probe()

    assert any(
        "platform.liveness.started" in r.getMessage() for r in caplog.records
    )
    await adapter._cancel_liveness_task()


@pytest.mark.asyncio
async def test_recv_idle_triggers_soft_reconnect_not_fatal(monkeypatch):
    """Event-idle (transport OK, no events = app-level 假活) must re-arm the WS
    via the cheap SDK reconnect, NOT escalate to a gateway-rebuild fatal error."""
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=0.005, threshold=2)
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())  # socket open
    adapter._ws_idle_max_seconds = 1
    adapter._last_ws_activity_at = time.monotonic() - 3600  # events long silent
    handler = AsyncMock()
    adapter.set_fatal_error_handler(handler)

    soft = AsyncMock(return_value=True)
    monkeypatch.setattr(adapter, "_force_ws_reconnect", soft)

    adapter._start_liveness_probe()
    await _wait_until(
        lambda: soft.await_count,
        "recv_idle did not trigger a soft WS reconnect",
    )
    assert adapter.has_fatal_error is False
    handler.assert_not_awaited()
    await adapter._cancel_liveness_task()


@pytest.mark.asyncio
async def test_recv_idle_soft_reconnect_failure_escalates_to_fatal(monkeypatch):
    adapter = _make_adapter()
    _arm_running_adapter(adapter, interval=0.005, threshold=1)
    adapter._ws_client = SimpleNamespace(_conn=_fake_conn())
    adapter._ws_idle_max_seconds = 1
    adapter._last_ws_activity_at = time.monotonic() - 3600
    handler = AsyncMock()
    adapter.set_fatal_error_handler(handler)
    monkeypatch.setattr(
        adapter,
        "_force_ws_reconnect",
        AsyncMock(return_value=False),
    )

    adapter._start_liveness_probe()
    await _wait_until(
        lambda: handler.await_count,
        "failed soft reconnect did not escalate to the gateway rebuild path",
    )

    assert adapter.has_fatal_error is True
    assert adapter.fatal_error_code == "feishu_websocket_health_stale"
    assert "soft_reconnect_failed" in (adapter.fatal_error_message or "")
    await adapter._cancel_liveness_task()


@pytest.mark.asyncio
async def test_force_ws_reconnect_waits_for_reconnected_hook():
    """Closing the old socket is not success; the SDK hook must confirm that a
    replacement connection was established before the liveness loop resets."""
    adapter = _make_adapter()
    adapter._running = True

    async def disconnect():
        adapter._on_ws_reconnected()

    adapter._ws_client = SimpleNamespace(_disconnect=disconnect, _reconnect_nonce=30)
    # The SDK client runs its own event loop on a dedicated thread; emulate it.
    ws_loop = asyncio.new_event_loop()

    import threading

    thread = threading.Thread(target=ws_loop.run_forever, daemon=True)
    thread.start()
    adapter._ws_thread_loop = ws_loop
    try:
        recovered = await adapter._force_ws_reconnect("recv_idle")
        assert recovered is True
        assert adapter._ws_client._reconnect_nonce == 0
    finally:
        ws_loop.call_soon_threadsafe(ws_loop.stop)
        thread.join(timeout=2)
        ws_loop.close()


@pytest.mark.asyncio
async def test_force_ws_reconnect_reports_disconnect_failure():
    adapter = _make_adapter()
    adapter._running = True

    async def disconnect():
        raise RuntimeError("close failed")

    adapter._ws_client = SimpleNamespace(_disconnect=disconnect)
    ws_loop = asyncio.new_event_loop()

    import threading

    thread = threading.Thread(target=ws_loop.run_forever, daemon=True)
    thread.start()
    adapter._ws_thread_loop = ws_loop
    try:
        assert await adapter._force_ws_reconnect("recv_idle") is False
    finally:
        ws_loop.call_soon_threadsafe(ws_loop.stop)
        thread.join(timeout=2)
        ws_loop.close()


@pytest.mark.asyncio
async def test_liveness_fatal_notification_retries_once():
    adapter = _make_adapter()
    calls = 0

    async def handler(_adapter):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("transient handoff failure")

    adapter.set_fatal_error_handler(handler)
    await adapter._notify_liveness_fatal_error()

    assert calls == 2
