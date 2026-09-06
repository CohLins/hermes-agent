"""Tests for the Feishu/API platform registry boundary."""

from unittest.mock import MagicMock

import pytest

from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.platform_registry import PlatformEntry, PlatformRegistry
from gateway.run import GatewayRunner


class TestRuntimePlatformEnum:
    def test_only_supported_runtime_platforms_exist(self):
        assert {platform.value for platform in Platform} == {
            "local",
            "api_server",
            "feishu",
        }

    @pytest.mark.parametrize("value", ["telegram", "discord", "unknown", ""])
    def test_removed_or_unknown_platforms_are_rejected(self, value):
        with pytest.raises(ValueError):
            Platform(value)


class TestGatewayRunnerAdapterFactory:
    def test_feishu_uses_registered_plugin_factory(self, monkeypatch):
        from gateway.platform_registry import platform_registry

        runner = GatewayRunner(GatewayConfig())
        adapter = MagicMock()
        calls = []

        monkeypatch.setattr(
            "hermes_cli.plugins.discover_plugins",
            lambda: calls.append("discover"),
        )
        monkeypatch.setattr(
            platform_registry,
            "create_adapter",
            lambda name, config: calls.append((name, config)) or adapter,
        )

        config = PlatformConfig(enabled=True, extra={"app_id": "cli_test"})
        assert runner._create_adapter(Platform.FEISHU, config) is adapter
        assert calls == ["discover", ("feishu", config)]
        assert adapter.gateway_runner is runner

    def test_api_server_uses_builtin_adapter(self, monkeypatch):
        import gateway.platforms.api_server as api_server

        runner = GatewayRunner(GatewayConfig())
        adapter = MagicMock()
        config = PlatformConfig(enabled=True, extra={"key": "test-key"})

        monkeypatch.setattr(api_server, "check_api_server_requirements", lambda: True)
        monkeypatch.setattr(api_server, "APIServerAdapter", lambda received: adapter)

        assert runner._create_adapter(Platform.API_SERVER, config) is adapter
        assert adapter.gateway_runner is runner

    def test_api_server_rejects_missing_runtime_dependency(self, monkeypatch):
        import gateway.platforms.api_server as api_server

        runner = GatewayRunner(GatewayConfig())
        monkeypatch.setattr(api_server, "check_api_server_requirements", lambda: False)

        assert runner._create_adapter(
            Platform.API_SERVER, PlatformConfig(enabled=True)
        ) is None

    def test_local_has_no_adapter(self):
        runner = GatewayRunner(GatewayConfig())
        assert runner._create_adapter(Platform.LOCAL, PlatformConfig(enabled=True)) is None


class TestPlatformRegistry:
    def _make_entry(self, name="test", check_ok=True, validate_ok=True, factory_ok=True):
        adapter_mock = MagicMock()
        return (
            PlatformEntry(
                name=name,
                label=name.title(),
                adapter_factory=lambda cfg, _adapter=adapter_mock: (
                    _adapter
                    if factory_ok
                    else (_ for _ in ()).throw(RuntimeError("factory error"))
                ),
                check_fn=lambda: check_ok,
                validate_config=lambda cfg: validate_ok,
            ),
            adapter_mock,
        )

    def test_register_and_get(self):
        registry = PlatformRegistry()
        entry, _ = self._make_entry("alpha")

        registry.register(entry)

        assert registry.get("alpha") is entry
        assert registry.is_registered("alpha")

    def test_unregister(self):
        registry = PlatformRegistry()
        entry, _ = self._make_entry("beta")
        registry.register(entry)

        assert registry.unregister("beta") is True
        assert registry.get("beta") is None
        assert registry.unregister("beta") is False

    def test_create_adapter_success(self):
        registry = PlatformRegistry()
        entry, adapter = self._make_entry("gamma")
        registry.register(entry)

        assert registry.create_adapter("gamma", MagicMock()) is adapter

    def test_create_adapter_rejects_unknown_or_invalid_entries(self):
        registry = PlatformRegistry()
        assert registry.create_adapter("unknown", MagicMock()) is None

        for name, check_ok, validate_ok in (
            ("missing-dependency", False, True),
            ("invalid-config", True, False),
        ):
            entry, _ = self._make_entry(name, check_ok, validate_ok)
            registry.register(entry)
            assert registry.create_adapter(name, MagicMock()) is None

    def test_create_adapter_absorbs_factory_exception(self):
        registry = PlatformRegistry()
        entry, _ = self._make_entry("broken", factory_ok=False)
        registry.register(entry)

        assert registry.create_adapter("broken", MagicMock()) is None

    def test_deferred_entry_loads_on_lookup(self):
        registry = PlatformRegistry()
        adapter = MagicMock()

        def load():
            registry.register(
                PlatformEntry(
                    name="feishu",
                    label="Feishu",
                    adapter_factory=lambda config: adapter,
                    check_fn=lambda: True,
                )
            )

        registry.register_deferred("feishu", load)

        assert registry.create_adapter("feishu", MagicMock()) is adapter
