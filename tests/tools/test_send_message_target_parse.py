"""Lightweight parsing and routing tests for Feishu send_message targets."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from gateway.config import Platform
from tools.send_message_tool import _parse_target_ref, send_message_tool


def _run_async_immediately(coro):
    return asyncio.run(coro)


def test_feishu_chat_target_is_explicit():
    chat_id, thread_id, is_explicit = _parse_target_ref("feishu", "oc_abc123")

    assert chat_id == "oc_abc123"
    assert thread_id is None
    assert is_explicit is True


def test_feishu_user_and_thread_target_is_explicit():
    chat_id, thread_id, is_explicit = _parse_target_ref(
        "feishu", "ou_abc123:thread_456"
    )

    assert chat_id == "ou_abc123"
    assert thread_id == "thread_456"
    assert is_explicit is True


def test_invalid_feishu_target_is_not_explicit():
    assert _parse_target_ref("feishu", "general") == (None, None, False)
    assert _parse_target_ref("feishu", "12345") == (None, None, False)


def test_removed_platform_target_is_not_explicit():
    assert _parse_target_ref("telegram", "12345") == (None, None, False)


def test_schema_only_exposes_feishu_send_and_list_actions():
    from tools.send_message_tool import SEND_MESSAGE_SCHEMA

    assert SEND_MESSAGE_SCHEMA["parameters"]["properties"]["action"]["enum"] == [
        "send",
        "list",
    ]


def test_non_feishu_target_is_rejected_before_configuration_load():
    result = json.loads(
        send_message_tool(
            {"action": "send", "target": "telegram:12345", "message": "hello"}
        )
    )

    assert "Unsupported platform" in result["error"]


def test_send_message_routes_explicit_feishu_target_without_home_fallback():
    feishu_cfg = SimpleNamespace(enabled=True, token=None, extra={})
    config = SimpleNamespace(
        platforms={Platform.FEISHU: feishu_cfg},
        get_home_channel=lambda _platform: SimpleNamespace(chat_id="oc_home"),
    )

    with (
        patch("gateway.config.load_gateway_config", return_value=config),
        patch("tools.interrupt.is_interrupted", return_value=False),
        patch(
            "gateway.channel_directory.resolve_channel_name",
            side_effect=AssertionError("explicit Feishu target should not resolve through directory"),
        ),
        patch("model_tools._run_async", side_effect=_run_async_immediately),
        patch(
            "tools.send_message_tool._send_to_platform",
            new=AsyncMock(return_value={"success": True}),
        ) as send_mock,
        patch("gateway.mirror.mirror_to_session", return_value=True),
    ):
        result = json.loads(
            send_message_tool(
                {
                    "action": "send",
                    "target": "feishu:oc_abc123:thread_456",
                    "message": "hello group",
                }
            )
        )

    assert result["success"] is True
    assert "note" not in result
    send_mock.assert_awaited_once_with(
        Platform.FEISHU,
        feishu_cfg,
        "oc_abc123",
        "hello group",
        thread_id="thread_456",
        media_files=[],
        force_document=False,
    )
