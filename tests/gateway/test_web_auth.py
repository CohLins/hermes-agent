from __future__ import annotations

import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter


class TestWebAuthService:
    def test_registration_keeps_account_pending_until_feishu_binding(self, tmp_path):
        from gateway.web_auth import WebAuthService

        users_path = tmp_path / "campaign-users.json"
        runtime_path = tmp_path / "web-auth-runtime.json"
        service = WebAuthService(users_path=users_path, runtime_path=runtime_path, now=lambda: 1_000.0)

        registration = service.register(email="Alice@Example.com", password="correct horse battery staple")

        assert registration.code
        assert registration.expires_at == 1_300.0
        assert not users_path.exists()
        runtime = json.loads(runtime_path.read_text())
        assert len(runtime["pending_registrations"]) == 1
        assert runtime["pending_registrations"][0]["email"] == "alice@example.com"
        assert "correct horse battery staple" not in runtime_path.read_text()

    def test_password_requires_six_characters_and_accepts_chinese_or_english(self, tmp_path):
        from gateway.web_auth import WebAuthService

        service = WebAuthService(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: 1_000.0,
        )

        assert service.register(email="alice@example.com", password="中文密码测试")
        with pytest.raises(ValueError, match="at least 6 characters"):
            service.register(email="bob@example.com", password="abcde")

    def test_feishu_binding_consumes_code_and_persists_shared_account(self, tmp_path):
        from gateway.web_auth import WebAuthService

        users_path = tmp_path / "campaign-users.json"
        runtime_path = tmp_path / "web-auth-runtime.json"
        service = WebAuthService(users_path=users_path, runtime_path=runtime_path, now=lambda: 1_000.0)
        registration = service.register(email="alice@example.com", password="correct horse battery staple")

        account = service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        )

        assert account["email"] == "alice@example.com"
        assert account["feishu"]["kind"] == "union_id"
        assert account["feishu"]["subject"] == "on_alice"
        assert users_path.exists()
        users = json.loads(users_path.read_text())
        assert users["version"] == 1
        assert users["users"] == [account]
        assert service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        ) is None

    def test_binding_rejects_expired_code_without_creating_account(self, tmp_path):
        from gateway.web_auth import WebAuthService

        now = [1_000.0]
        users_path = tmp_path / "campaign-users.json"
        service = WebAuthService(
            users_path=users_path,
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: now[0],
        )
        registration = service.register(email="alice@example.com", password="correct horse battery staple")
        now[0] = 1_301.0

        assert service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        ) is None
        assert not users_path.exists()

    def test_login_session_expires_eight_hours_after_issue(self, tmp_path):
        from gateway.web_auth import WebAuthService

        now = [1_000.0]
        service = WebAuthService(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: now[0],
        )
        registration = service.register(email="alice@example.com", password="correct horse battery staple")
        service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        )

        session = service.login(email="alice@example.com", password="correct horse battery staple")

        assert session is not None
        assert session.expires_at == 29_800.0
        assert service.verify_session(session.token) is not None
        now[0] = 29_801.0
        assert service.verify_session(session.token) is None

    def test_login_never_accepts_an_unbound_account(self, tmp_path):
        from gateway.web_auth import WebAuthService

        service = WebAuthService(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: 1_000.0,
        )
        service.register(email="alice@example.com", password="correct horse battery staple")

        assert service.login(email="alice@example.com", password="correct horse battery staple") is None

    def test_disabled_account_session_is_revoked_immediately(self, tmp_path):
        from gateway.web_auth import WebAuthService

        users_path = tmp_path / "campaign-users.json"
        service = WebAuthService(
            users_path=users_path,
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: 1_000.0,
        )
        registration = service.register(email="alice@example.com", password="correct horse battery staple")
        service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        )
        session = service.login(email="alice@example.com", password="correct horse battery staple")
        assert session is not None
        users = json.loads(users_path.read_text())
        users["users"][0]["status"] = "disabled"
        users_path.write_text(json.dumps(users))

        assert service.verify_session(session.token) is None

    def test_binding_refuses_identity_already_bound_to_another_account(self, tmp_path):
        from gateway.web_auth import WebAuthService

        service = WebAuthService(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: 1_000.0,
        )
        first = service.register(email="alice@example.com", password="correct horse battery staple")
        service.consume_feishu_binding(
            code=first.code,
            union_id="on_shared",
            user_id="u_alice",
            open_id="ou_alice",
        )
        second = service.register(email="bob@example.com", password="another correct horse battery staple")

        assert service.consume_feishu_binding(
            code=second.code,
            union_id="on_shared",
            user_id="u_bob",
            open_id="ou_bob",
        ) is None

    def test_reregistering_pending_email_invalidates_the_previous_binding_code(self, tmp_path):
        from gateway.web_auth import WebAuthService

        service = WebAuthService(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
            now=lambda: 1_000.0,
        )
        first = service.register(email="alice@example.com", password="correct horse battery staple")
        replacement = service.register(email="alice@example.com", password="correct horse battery staple")

        assert replacement.code != first.code
        assert service.consume_feishu_binding(
            code=first.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        ) is None
        assert service.consume_feishu_binding(
            code=replacement.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        ) is not None


class TestWebAuthRoutes:
    @pytest.mark.asyncio
    async def test_register_bind_login_then_authenticate_web_api(self, tmp_path):
        config = PlatformConfig(enabled=True, extra={"key": "sk-secret"})
        adapter = APIServerAdapter(config)
        adapter.configure_web_auth(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
        )
        app = web.Application()
        for method, path, handler in adapter._http_route_table():
            if path.startswith("/web/"):
                app.router.add_route(method, path, handler)

        async with TestClient(TestServer(app)) as client:
            unauthenticated = await client.get("/web/api/sessions")
            assert unauthenticated.status == 401

            registered = await client.post(
                "/web/auth/register",
                json={"email": "alice@example.com", "password": "correct horse battery staple"},
            )
            assert registered.status == 201
            registration = await registered.json()
            assert registration["expires_at"] > 0

            account = adapter.web_auth_service.consume_feishu_binding(
                code=registration["code"],
                union_id="on_alice",
                user_id="u_alice",
                open_id="ou_alice",
            )
            assert account is not None

            logged_in = await client.post(
                "/web/auth/login",
                json={"email": "alice@example.com", "password": "correct horse battery staple"},
            )
            assert logged_in.status == 200
            assert "HttpOnly" in logged_in.headers["Set-Cookie"]
            assert "Max-Age=28800" in logged_in.headers["Set-Cookie"]
            login = await logged_in.json()
            assert login["authenticated"] is True
            assert login["csrf_token"]

            authenticated = await client.get("/web/auth/me")
            assert authenticated.status == 200
            assert (await authenticated.json())["email"] == "alice@example.com"

    @pytest.mark.asyncio
    async def test_web_api_rejects_state_change_without_csrf(self, tmp_path):
        config = PlatformConfig(enabled=True, extra={"key": "sk-secret"})
        adapter = APIServerAdapter(config)
        adapter.configure_web_auth(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
        )
        app = web.Application()
        for method, path, handler in adapter._http_route_table():
            if path.startswith("/web/"):
                app.router.add_route(method, path, handler)

        service = adapter.web_auth_service
        registration = service.register(email="alice@example.com", password="correct horse battery staple")
        service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        )

        async with TestClient(TestServer(app)) as client:
            logged_in = await client.post(
                "/web/auth/login",
                json={"email": "alice@example.com", "password": "correct horse battery staple"},
            )
            assert logged_in.status == 200
            response = await client.post("/web/api/sessions", json={})
            assert response.status == 403

    @pytest.mark.asyncio
    async def test_web_auth_limits_registration_attempts_per_client(self, tmp_path):
        config = PlatformConfig(enabled=True, extra={"key": "sk-secret"})
        adapter = APIServerAdapter(config)
        adapter.configure_web_auth(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
        )
        app = web.Application()
        for method, path, handler in adapter._http_route_table():
            if path.startswith("/web/"):
                app.router.add_route(method, path, handler)

        async with TestClient(TestServer(app)) as client:
            for index in range(5):
                response = await client.post(
                    "/web/auth/register",
                    json={"email": f"user-{index}@example.com", "password": "correct horse battery staple"},
                )
                assert response.status == 201
            limited = await client.post(
                "/web/auth/register",
                json={"email": "limited@example.com", "password": "correct horse battery staple"},
            )
            assert limited.status == 429

    @pytest.mark.asyncio
    async def test_web_auth_rejects_cross_origin_write_request(self, tmp_path):
        config = PlatformConfig(enabled=True, extra={"key": "sk-secret"})
        adapter = APIServerAdapter(config)
        adapter.configure_web_auth(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
        )
        app = web.Application()
        for method, path, handler in adapter._http_route_table():
            if path.startswith("/web/"):
                app.router.add_route(method, path, handler)

        async with TestClient(TestServer(app)) as client:
            response = await client.post(
                "/web/auth/register",
                headers={"Origin": "https://attacker.invalid"},
                json={"email": "alice@example.com", "password": "correct horse battery staple"},
            )
            assert response.status == 403

    @pytest.mark.asyncio
    async def test_https_web_login_sets_secure_cookie(self, tmp_path):
        config = PlatformConfig(enabled=True, extra={"key": "sk-secret"})
        adapter = APIServerAdapter(config)
        adapter.configure_web_auth(
            users_path=tmp_path / "campaign-users.json",
            runtime_path=tmp_path / "web-auth-runtime.json",
        )
        app = web.Application()
        for method, path, handler in adapter._http_route_table():
            if path.startswith("/web/"):
                app.router.add_route(method, path, handler)

        service = adapter.web_auth_service
        registration = service.register(email="alice@example.com", password="correct horse battery staple")
        service.consume_feishu_binding(
            code=registration.code,
            union_id="on_alice",
            user_id="u_alice",
            open_id="ou_alice",
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.post(
                "/web/auth/login",
                headers={"X-Forwarded-Proto": "https"},
                json={"email": "alice@example.com", "password": "correct horse battery staple"},
            )
            assert response.status == 200
            assert "Secure" in response.headers["Set-Cookie"]
