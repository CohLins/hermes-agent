"""Authorization and unauthorized-DM behavior for the Feishu gateway."""

from types import SimpleNamespace

from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.session import SessionSource


def _clear_auth_env(monkeypatch) -> None:
    for key in (
        "FEISHU_ALLOWED_USERS",
        "FEISHU_ALLOW_ALL_USERS",
        "GATEWAY_ALLOWED_USERS",
        "GATEWAY_ALLOW_ALL_USERS",
    ):
        monkeypatch.delenv(key, raising=False)


def _make_runner(*, paired: bool = False) -> object:
    from gateway.run import GatewayRunner

    runner = object.__new__(GatewayRunner)
    runner.config = GatewayConfig(
        platforms={Platform.FEISHU: PlatformConfig(enabled=True)}
    )
    runner.adapters = {}
    runner.pairing_store = SimpleNamespace(
        is_approved=lambda *_args, **_kwargs: paired
    )
    return runner


def _source(user_id: str = "ou_user", chat_type: str = "dm") -> SessionSource:
    return SessionSource(
        platform=Platform.FEISHU,
        user_id=user_id,
        chat_id="oc_test",
        user_name="tester",
        chat_type=chat_type,
    )


def test_feishu_allowlist_authorizes_listed_user(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("FEISHU_ALLOWED_USERS", "ou_owner,ou_user")

    assert _make_runner()._is_user_authorized(_source()) is True


def test_feishu_allowlist_rejects_unlisted_user(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("FEISHU_ALLOWED_USERS", "ou_owner")

    assert _make_runner()._is_user_authorized(_source()) is False


def test_feishu_allowlist_wildcard_authorizes_any_user(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("FEISHU_ALLOWED_USERS", "*")

    assert _make_runner()._is_user_authorized(_source("ou_stranger")) is True


def test_feishu_platform_allow_all_authorizes_any_user(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("FEISHU_ALLOW_ALL_USERS", "true")

    assert _make_runner()._is_user_authorized(_source("ou_stranger")) is True


def test_global_allow_all_authorizes_any_user(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("GATEWAY_ALLOW_ALL_USERS", "true")

    assert _make_runner()._is_user_authorized(_source("ou_stranger")) is True


def test_paired_feishu_user_is_authorized_without_allowlist(monkeypatch):
    _clear_auth_env(monkeypatch)

    assert _make_runner(paired=True)._is_user_authorized(_source()) is True


def test_paired_feishu_user_is_authorized_alongside_allowlist(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("FEISHU_ALLOWED_USERS", "ou_owner")

    assert _make_runner(paired=True)._is_user_authorized(_source()) is True


def test_unpaired_user_without_explicit_allowance_is_denied(monkeypatch):
    _clear_auth_env(monkeypatch)

    assert _make_runner()._is_user_authorized(_source("ou_stranger")) is False


def test_allowlist_switches_unauthorized_dm_to_ignore(monkeypatch):
    _clear_auth_env(monkeypatch)
    monkeypatch.setenv("FEISHU_ALLOWED_USERS", "ou_owner")

    assert _make_runner()._get_unauthorized_dm_behavior(Platform.FEISHU) == "ignore"


def test_unconfigured_feishu_defaults_unauthorized_dm_to_pair(monkeypatch):
    _clear_auth_env(monkeypatch)

    assert _make_runner()._get_unauthorized_dm_behavior(Platform.FEISHU) == "pair"
