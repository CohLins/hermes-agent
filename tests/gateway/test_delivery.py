"""Tests for the delivery routing module."""

import pytest

from gateway.config import GatewayConfig, Platform
from gateway.delivery import DeliveryRouter, DeliveryTarget
from gateway.platforms.base import SendResult
from gateway.session import SessionSource


class TestFeishuDeliveryTargets:
    def test_explicit_feishu_target_preserves_chat_and_thread_ids(self):
        target = DeliveryTarget.parse("Feishu:oc_AbC123:thread_456")

        assert target.platform == Platform.FEISHU
        assert target.chat_id == "oc_AbC123"
        assert target.thread_id == "thread_456"
        assert target.is_explicit is True
        assert target.to_string() == "feishu:oc_AbC123:thread_456"

    def test_feishu_platform_target_has_no_explicit_chat(self):
        target = DeliveryTarget.parse("feishu")

        assert target.platform == Platform.FEISHU
        assert target.chat_id is None
        assert target.is_explicit is False

    def test_origin_uses_feishu_session_source(self):
        origin = SessionSource(
            platform=Platform.FEISHU,
            chat_id="oc_abc123",
            thread_id="thread_456",
        )

        target = DeliveryTarget.parse("origin", origin=origin)

        assert target.platform == Platform.FEISHU
        assert target.chat_id == "oc_abc123"
        assert target.thread_id == "thread_456"
        assert target.is_origin is True
        assert target.to_string() == "origin"

    def test_local_and_unknown_targets_remain_local(self):
        assert DeliveryTarget.parse("local").platform == Platform.LOCAL
        assert DeliveryTarget.parse("unknown_platform").platform == Platform.LOCAL


class RecordingAdapter:
    def __init__(self):
        self.calls = []

    async def send(self, chat_id, content, metadata=None):
        self.calls.append({"chat_id": chat_id, "content": content, "metadata": metadata})
        return {"success": True}


@pytest.mark.asyncio
async def test_feishu_thread_is_forwarded_to_adapter_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)
    adapter = RecordingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123:thread_456")

    await router._deliver_to_platform(target, "hello", metadata={"job_id": "job_1"})

    assert adapter.calls == [
        {
            "chat_id": "oc_abc123",
            "content": "hello",
            "metadata": {"job_id": "job_1", "thread_id": "thread_456"},
        }
    ]


@pytest.mark.asyncio
async def test_explicit_thread_metadata_is_not_overwritten(tmp_path, monkeypatch):
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)
    adapter = RecordingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123:thread_456")

    await router._deliver_to_platform(target, "hello", metadata={"thread_id": "thread_override"})

    assert adapter.calls[0]["metadata"] == {"thread_id": "thread_override"}


class FailingAdapter:
    async def send(self, chat_id, content, metadata=None):
        return SendResult(success=False, error="route failed", retryable=False)


@pytest.mark.asyncio
async def test_feishu_send_failure_raises_for_delivery_result(tmp_path, monkeypatch):
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: FailingAdapter()})
    target = DeliveryTarget.parse("feishu:oc_abc123:thread_456")

    with pytest.raises(RuntimeError, match="route failed"):
        await router._deliver_to_platform(target, "hello", metadata=None)


# ---------------------------------------------------------------------------
# Cron output truncation / adapter-aware chunking (issue #50126)
# ---------------------------------------------------------------------------

class ChunkingAdapter:
    """Adapter that declares splits_long_messages=True (like Discord/Telegram)."""
    splits_long_messages = True

    def __init__(self):
        self.calls = []

    async def send(self, chat_id, content, metadata=None):
        self.calls.append({"chat_id": chat_id, "content": content, "metadata": metadata})
        return {"success": True}


class NonChunkingAdapter:
    """Adapter without splits_long_messages (default False — legacy behavior)."""

    def __init__(self):
        self.calls = []

    async def send(self, chat_id, content, metadata=None):
        self.calls.append({"chat_id": chat_id, "content": content, "metadata": metadata})
        return {"success": True}


@pytest.mark.asyncio
async def test_long_output_truncated_for_non_chunking_adapter(tmp_path, monkeypatch):
    """Non-chunking adapters receive truncated content with a footer + file save."""
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)
    adapter = NonChunkingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123")

    long_content = "x" * 5000
    await router._deliver_to_platform(target, long_content, metadata={"job_id": "job1"})

    delivered = adapter.calls[0]["content"]
    assert len(delivered) < 5000  # was truncated
    assert "truncated" in delivered.lower()
    assert "full output saved to" in delivered
    # Full output was saved to disk
    saved_files = list(tmp_path.glob("cron/output/job1_*.txt"))
    assert len(saved_files) == 1
    assert saved_files[0].read_text() == long_content


@pytest.mark.asyncio
async def test_long_output_preserved_for_chunking_adapter(tmp_path, monkeypatch):
    """Chunking adapters (splits_long_messages=True) receive the FULL content."""
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)
    adapter = ChunkingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123")

    long_content = "x" * 5000
    await router._deliver_to_platform(target, long_content, metadata={"job_id": "job2"})

    delivered = adapter.calls[0]["content"]
    assert delivered == long_content  # NOT truncated — adapter handles chunking
    assert "truncated" not in delivered.lower()
    # Full output still saved to disk as audit trail
    saved_files = list(tmp_path.glob("cron/output/job2_*.txt"))
    assert len(saved_files) == 1
    assert saved_files[0].read_text() == long_content


@pytest.mark.asyncio
async def test_short_output_never_truncated(tmp_path, monkeypatch):
    """Output under the limit passes through untouched for any adapter."""
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)
    adapter = NonChunkingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123")

    short_content = "x" * 100
    await router._deliver_to_platform(target, short_content, metadata={"job_id": "job3"})

    assert adapter.calls[0]["content"] == short_content
    # Nothing saved to disk
    assert not list(tmp_path.glob("cron/output/*.txt"))


@pytest.mark.asyncio
async def test_audit_save_failure_does_not_break_chunking_delivery(tmp_path, monkeypatch):
    """If the audit save fails (disk full, permissions), chunking adapters
    still receive the full content — the save is best-effort."""
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)

    adapter = ChunkingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123")

    long_content = "x" * 5000

    call_count = {"n": 0}

    def failing_save(content, job_id):
        call_count["n"] += 1
        raise OSError("No space left on device")

    monkeypatch.setattr(router, "_save_full_output", failing_save)

    # Should NOT raise — audit failure is caught for chunking adapters
    await router._deliver_to_platform(target, long_content, metadata={"job_id": "job6"})

    # Adapter still got the full content
    assert adapter.calls[0]["content"] == long_content
    # Save was attempted (best-effort, swallowed)
    assert call_count["n"] == 1


@pytest.mark.asyncio
async def test_save_failure_during_truncation_raises_for_non_chunking_adapter(tmp_path, monkeypatch):
    """For a non-chunking adapter, the truncation footer needs a valid saved
    path. If the save fails there, that is a real delivery problem and the
    error propagates (not swallowed like the chunking best-effort save)."""
    monkeypatch.setattr("gateway.delivery.get_hermes_home", lambda: tmp_path)

    adapter = NonChunkingAdapter()
    router = DeliveryRouter(GatewayConfig(), adapters={Platform.FEISHU: adapter})
    target = DeliveryTarget.parse("feishu:oc_abc123")

    long_content = "x" * 5000

    def failing_save(content, job_id):
        raise OSError("No space left on device")

    monkeypatch.setattr(router, "_save_full_output", failing_save)

    # Non-chunking adapter must truncate → needs a valid saved path → the
    # Step 1 best-effort catch swallows the first attempt, but the Step 2
    # retry (footer needs the path) re-raises.
    with pytest.raises(OSError, match="No space left on device"):
        await router._deliver_to_platform(target, long_content, metadata={"job_id": "job7"})


