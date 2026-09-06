"""Tests for Feishu channel-directory persistence and resolution."""

import asyncio
import json
import threading
from unittest.mock import patch

import pytest

from gateway.channel_directory import (
    _apply_channel_aliases,
    _build_from_sessions,
    build_channel_directory,
    format_directory_for_display,
    load_directory,
    lookup_channel_type,
    resolve_channel_name,
)
from gateway.config import Platform


@pytest.fixture(autouse=True)
def _isolate_channel_aliases(tmp_path_factory):
    missing = tmp_path_factory.mktemp("aliases") / "none.json"
    with patch("gateway.channel_directory.CHANNEL_ALIASES_PATH", missing):
        yield


def _write_directory(tmp_path, platforms):
    cache_file = tmp_path / "channel_directory.json"
    cache_file.write_text(
        json.dumps({"updated_at": "2026-01-01T00:00:00", "platforms": platforms}),
        encoding="utf-8",
    )
    return cache_file


class TestLoadDirectory:
    def test_missing_file(self, tmp_path):
        with patch("gateway.channel_directory.DIRECTORY_PATH", tmp_path / "missing.json"):
            result = load_directory()
        assert result == {"updated_at": None, "platforms": {}}

    def test_valid_file(self, tmp_path):
        cache_file = _write_directory(
            tmp_path, {"feishu": [{"id": "oc_123", "name": "研发群", "type": "group"}]}
        )
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file):
            result = load_directory()
        assert result["platforms"]["feishu"][0]["name"] == "研发群"

    def test_corrupt_file(self, tmp_path):
        cache_file = tmp_path / "channel_directory.json"
        cache_file.write_text("{bad json", encoding="utf-8")
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file):
            result = load_directory()
        assert result == {"updated_at": None, "platforms": {}}


class TestBuildChannelDirectory:
    def test_builds_connected_feishu_from_sessions_off_loop(self, tmp_path):
        cache_file = tmp_path / "channel_directory.json"
        loop_thread = threading.get_ident()
        calls = []

        def fake_build_from_sessions(platform_name):
            calls.append((platform_name, threading.get_ident()))
            return [{"id": "oc_123", "name": "研发群", "type": "group", "thread_id": None}]

        with patch(
            "gateway.channel_directory._build_from_sessions", side_effect=fake_build_from_sessions
        ), patch("gateway.channel_directory.DIRECTORY_PATH", cache_file):
            directory = asyncio.run(build_channel_directory({Platform.FEISHU: object()}))

        assert [name for name, _ in calls] == ["feishu"]
        assert calls[0][1] != loop_thread
        assert directory["platforms"]["feishu"][0]["id"] == "oc_123"
        assert json.loads(cache_file.read_text(encoding="utf-8")) == directory

    def test_skips_local_and_api_server_adapters(self, tmp_path):
        cache_file = tmp_path / "channel_directory.json"
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file):
            directory = asyncio.run(
                build_channel_directory(
                    {Platform.LOCAL: object(), Platform.API_SERVER: object()}
                )
            )
        assert directory["platforms"] == {}

    def test_skips_non_feishu_adapters(self, tmp_path):
        cache_file = tmp_path / "channel_directory.json"
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file), patch(
            "gateway.channel_directory._build_from_sessions", return_value=[]
        ) as build_sessions:
            directory = asyncio.run(
                build_channel_directory({Platform.FEISHU: object(), "telegram": object()})
            )

        assert directory["platforms"] == {"feishu": []}
        build_sessions.assert_called_once_with("feishu")

    def test_failed_write_preserves_previous_cache(self, tmp_path, monkeypatch):
        cache_file = _write_directory(
            tmp_path, {"feishu": [{"id": "oc_123", "name": "原群", "type": "group"}]}
        )
        previous = json.loads(cache_file.read_text(encoding="utf-8"))

        def broken_dump(data, fp, *args, **kwargs):
            fp.write('{"updated_at":')
            fp.flush()
            raise OSError("disk full")

        monkeypatch.setattr(json, "dump", broken_dump)
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file):
            asyncio.run(build_channel_directory({}))
            result = load_directory()
        assert result == previous


class TestBuildFromSessions:
    @staticmethod
    def _write_sessions(tmp_path, sessions):
        path = tmp_path / "sessions" / "sessions.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(sessions), encoding="utf-8")

    def test_builds_feishu_session_entries(self, tmp_path):
        self._write_sessions(
            tmp_path,
            {
                "dm": {
                    "origin": {"platform": "feishu", "chat_id": "ou_123", "chat_name": "张三"},
                    "chat_type": "dm",
                },
                "group": {
                    "origin": {"platform": "feishu", "chat_id": "oc_123", "chat_name": "研发群"},
                    "chat_type": "group",
                },
                "other": {"origin": {"platform": "api_server", "chat_id": "ignored"}},
            },
        )
        with patch.dict("os.environ", {"HERMES_HOME": str(tmp_path)}):
            entries = _build_from_sessions("feishu")
        assert {(entry["id"], entry["name"]) for entry in entries} == {
            ("ou_123", "张三"),
            ("oc_123", "研发群"),
        }

    def test_keeps_thread_targets_distinct(self, tmp_path):
        self._write_sessions(
            tmp_path,
            {
                "root": {"origin": {"platform": "feishu", "chat_id": "oc_123", "chat_name": "研发群"}},
                "thread": {
                    "origin": {
                        "platform": "feishu",
                        "chat_id": "oc_123",
                        "chat_name": "研发群",
                        "thread_id": "thread_456",
                    }
                },
            },
        )
        with patch.dict("os.environ", {"HERMES_HOME": str(tmp_path)}):
            entries = _build_from_sessions("feishu")
        assert {(entry["id"], entry["name"]) for entry in entries} == {
            ("oc_123", "研发群"),
            ("oc_123:thread_456", "研发群 / topic thread_456"),
        }


class TestResolveChannelName:
    def _setup(self, tmp_path, entries):
        return patch(
            "gateway.channel_directory.DIRECTORY_PATH",
            _write_directory(tmp_path, {"feishu": entries}),
        )

    def test_resolves_name_case_insensitively(self, tmp_path):
        with self._setup(tmp_path, [{"id": "oc_123", "name": "研发群", "type": "group"}]):
            assert resolve_channel_name("feishu", "研发群") == "oc_123"

    def test_raw_id_takes_precedence_over_name(self, tmp_path):
        entries = [
            {"id": "oc_123", "name": "研发群", "type": "group"},
            {"id": "oc_other", "name": "oc_123", "type": "group"},
        ]
        with self._setup(tmp_path, entries):
            assert resolve_channel_name("feishu", "oc_123") == "oc_123"

    def test_resolves_type_and_thread_labels(self, tmp_path):
        entries = [
            {"id": "ou_123", "name": "张三", "type": "dm"},
            {"id": "oc_123:thread_456", "name": "研发群 / topic thread_456", "type": "group"},
        ]
        with self._setup(tmp_path, entries):
            assert resolve_channel_name("feishu", "张三 (dm)") == "ou_123"
            assert resolve_channel_name("feishu", "研发群 / topic thread_456 (group)") == "oc_123:thread_456"

    def test_ambiguous_prefix_returns_none(self, tmp_path):
        entries = [
            {"id": "oc_a", "name": "研发后端", "type": "group"},
            {"id": "oc_b", "name": "研发前端", "type": "group"},
        ]
        with self._setup(tmp_path, entries):
            assert resolve_channel_name("feishu", "研发") is None

    def test_lookup_channel_type(self, tmp_path):
        with self._setup(tmp_path, [{"id": "oc_123", "name": "研发群", "type": "group"}]):
            assert lookup_channel_type("feishu", "oc_123") == "group"
            assert lookup_channel_type("feishu", "oc_missing") is None


class TestDirectoryDisplayAndAliases:
    def test_formats_feishu_targets(self, tmp_path):
        cache_file = _write_directory(
            tmp_path,
            {"feishu": [{"id": "oc_123", "name": "研发群", "type": "group"}]},
        )
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file):
            result = format_directory_for_display()
        assert "Available Feishu targets:" in result
        assert "feishu:研发群 (group)" in result

    def test_alias_renames_and_resolves_feishu_group(self, tmp_path):
        cache_file = _write_directory(
            tmp_path, {"feishu": [{"id": "oc_123", "name": "oc_123", "type": "group"}]}
        )
        aliases = tmp_path / "channel_aliases.json"
        aliases.write_text(json.dumps({"feishu": {"oc_123": "研发群"}}), encoding="utf-8")
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file), patch(
            "gateway.channel_directory.CHANNEL_ALIASES_PATH", aliases
        ):
            assert load_directory()["platforms"]["feishu"][0]["name"] == "研发群"
            assert resolve_channel_name("feishu", "研发群") == "oc_123"

    def test_alias_injects_undiscovered_group(self, tmp_path):
        cache_file = _write_directory(tmp_path, {"feishu": []})
        aliases = tmp_path / "channel_aliases.json"
        aliases.write_text(json.dumps({"feishu": {"oc_999": "预设群"}}), encoding="utf-8")
        with patch("gateway.channel_directory.DIRECTORY_PATH", cache_file), patch(
            "gateway.channel_directory.CHANNEL_ALIASES_PATH", aliases
        ):
            assert resolve_channel_name("feishu", "预设群") == "oc_999"
            entry = load_directory()["platforms"]["feishu"][0]
        assert entry == {"id": "oc_999", "name": "预设群", "type": "group", "thread_id": None}

    def test_malformed_aliases_are_ignored(self):
        platforms = {"feishu": [{"id": "oc_123", "name": "原群", "type": "group"}]}
        with patch(
            "gateway.channel_directory._load_channel_aliases",
            return_value={"feishu": "not-a-map", "other": {"x": 123}},
        ):
            _apply_channel_aliases(platforms)
        assert platforms["feishu"][0]["name"] == "原群"
