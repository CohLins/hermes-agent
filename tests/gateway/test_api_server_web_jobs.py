"""Per-user cron scoping for the web workbench's /web/api/jobs routes.

The Feishu assistant already isolates cron jobs by ``origin.user_id``
(tools/cronjob_tools.py). These tests pin the browser half of the same
contract:

- a logged-in account sees only its own jobs, including the ones it created
  by talking to the assistant, and gets a plain 404 for anyone else's;
- API-key callers keep the unscoped admin view they always had;
- a job created from the web is owned by the same Feishu identity, starts
  paused, keeps the user's own frequency wording, and can only deliver into a
  group the user actually belongs to.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from gateway.config import PlatformConfig
from gateway.platforms.api_server import APIServerAdapter, cors_middleware

_MOD = "gateway.platforms.api_server"
_PASSWORD = "correct horse battery staple"

# Alice is bound to a tenant-scoped user_id (what the Feishu adapter prefers),
# Bob only to an open_id — both shapes have to work.
ALICE = {"user_id": "alice_tenant", "open_id": "ou_alice", "union_id": "on_alice"}
BOB = {"user_id": None, "open_id": "ou_bob", "union_id": "on_bob"}

ALICE_WEB_JOB = {
    "id": "aaaaaaaaaaaa",
    "name": "alice web job",
    "prompt": "check things",
    "schedule_display": "每天早上 9 点",
    "enabled": True,
    "deliver": "origin",
    "origin": {"platform": "feishu", "user_id": "alice_tenant", "web_user_id": "", "user_name": "Alice"},
}

ALICE_FEISHU_JOB = {
    "id": "bbbbbbbbbbbb",
    "name": "alice job made in feishu",
    "prompt": "watch logs",
    "schedule_display": "every 30m",
    "enabled": True,
    "deliver": "origin",
    # No web_user_id: created by the assistant, owned via the Feishu identity.
    "origin": {"platform": "feishu", "chat_id": "oc_dm", "user_id": "alice_tenant"},
}

BOB_JOB = {
    "id": "cccccccccccc",
    "name": "bob job",
    "prompt": "bob only",
    "schedule_display": "每小时",
    "enabled": True,
    "deliver": "origin",
    "origin": {"platform": "feishu", "user_id": "ou_bob"},
}

LEGACY_JOB = {
    "id": "dddddddddddd",
    "name": "legacy cli job",
    "prompt": "no owner at all",
    "schedule_display": "every 1h",
    "enabled": True,
    "deliver": "local",
    "origin": None,
}

ALL_JOBS = [ALICE_WEB_JOB, ALICE_FEISHU_JOB, BOB_JOB, LEGACY_JOB]


@pytest.fixture(autouse=True)
def llm():
    """Stub the auxiliary model for every test in this module.

    Frequency sentences are resolved by a model, so without this a test could
    reach a real provider. Set ``llm.reply`` to choose the expression it
    answers with; assert on ``llm`` to prove a path stayed offline.
    """
    stub = MagicMock()
    stub.reply = "0 9 * * *"

    def _call(**_kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=stub.reply))]
        )

    stub.side_effect = _call
    with patch("agent.auxiliary_client.call_llm", stub):
        yield stub


def _make_adapter(tmp_path, api_key: str = "") -> APIServerAdapter:
    extra = {"key": api_key} if api_key else {}
    adapter = APIServerAdapter(PlatformConfig(enabled=True, extra=extra))
    adapter.configure_web_auth(
        users_path=tmp_path / "campaign-users.json",
        runtime_path=tmp_path / "web-auth-runtime.json",
    )
    return adapter


def _bind(adapter: APIServerAdapter, email: str, identity: dict) -> dict:
    """Register a web account and complete its Feishu binding."""
    service = adapter.web_auth_service
    registration = service.register(email=email, password=_PASSWORD)
    account = service.consume_feishu_binding(code=registration.code, **identity)
    assert account is not None
    return account


def _create_app(adapter: APIServerAdapter) -> web.Application:
    """Register the adapter's real route table, /web mirrors included.

    Using the table rather than hand-picked routes also covers registration
    order: /api/jobs/metrics must win over /api/jobs/{job_id}.
    """
    app = web.Application(middlewares=[cors_middleware])
    app["api_server_adapter"] = adapter
    for method, path, handler in adapter._http_route_table():
        app.router.add_route(method, path, handler)
    return app


async def _login(cli: TestClient, email: str) -> str:
    resp = await cli.post("/web/auth/login", json={"email": email, "password": _PASSWORD})
    assert resp.status == 200, await resp.text()
    return (await resp.json())["csrf_token"]


class TestWebJobScoping:
    @pytest.mark.asyncio
    async def test_list_shows_only_own_jobs_from_both_ends(self, tmp_path):
        """Alice sees her web-created AND her Feishu-created jobs, nothing else."""
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        _bind(adapter, "bob@example.com", BOB)
        app = _create_app(adapter)
        mock_list = MagicMock(return_value=ALL_JOBS)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(f"{_MOD}._cron_list", mock_list):
                resp = await cli.get("/web/api/jobs")
                assert resp.status == 200
                names = [job["name"] for job in (await resp.json())["jobs"]]

        assert names == [ALICE_WEB_JOB["name"], ALICE_FEISHU_JOB["name"]]
        # Paused jobs must be included, or a freshly created one would vanish.
        mock_list.assert_called_once_with(include_disabled=True)

    @pytest.mark.asyncio
    async def test_owner_name_falls_back_to_a_contact_lookup_by_open_id(self, tmp_path):
        """Jobs predating origin.user_name still show a creator name.

        The lookup must go through open_id: a tenant user_id lookup needs the
        employee_id contact scope, which the bot does not hold.
        """
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        seen: list[str] = []

        async def resolver(subject, **_kwargs):
            seen.append(subject)
            return "Return Chen"

        app["feishu_adapter"] = SimpleNamespace(_resolve_sender_name_from_api=resolver)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=[ALICE_WEB_JOB, ALICE_FEISHU_JOB]
            ):
                resp = await cli.get("/web/api/jobs")
                assert resp.status == 200
                jobs = (await resp.json())["jobs"]

        by_name = {job["name"]: job["owner_name"] for job in jobs}
        # The web-created job carries its own name; the Feishu one is filled in.
        assert by_name[ALICE_WEB_JOB["name"]] == "Alice"
        assert by_name[ALICE_FEISHU_JOB["name"]] == "Return Chen"
        assert seen == [ALICE["open_id"]]

    @pytest.mark.asyncio
    async def test_single_job_routes_404_on_someone_elses_job(self, tmp_path):
        """Every single-job verb hides Bob's job from Alice as "not found"."""
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        _bind(adapter, "bob@example.com", BOB)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            headers = {"X-CSRF-Token": csrf}
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_get", return_value=BOB_JOB
            ), patch(f"{_MOD}._cron_update") as update, patch(
                f"{_MOD}._cron_remove"
            ) as remove, patch(f"{_MOD}._cron_pause") as pause, patch(
                f"{_MOD}._cron_resume"
            ) as resume, patch(f"{_MOD}._cron_trigger") as trigger:
                job_path = f"/web/api/jobs/{BOB_JOB['id']}"
                calls = [
                    await cli.get(job_path),
                    await cli.patch(job_path, json={"name": "hijacked"}, headers=headers),
                    await cli.delete(job_path, headers=headers),
                    await cli.post(f"{job_path}/pause", headers=headers),
                    await cli.post(f"{job_path}/resume", headers=headers),
                    await cli.post(f"{job_path}/run", headers=headers),
                    await cli.get(f"{job_path}/executions"),
                ]
                assert [resp.status for resp in calls] == [404] * 7
                assert (await calls[0].json())["error"] == "Job not found"
                # Nothing was allowed to touch the job.
                for mutation in (update, remove, pause, resume, trigger):
                    mutation.assert_not_called()

    @pytest.mark.asyncio
    async def test_api_key_caller_keeps_unscoped_admin_view(self, tmp_path):
        """The bare /api/jobs route stays global — no regression for CLI/scripts."""
        adapter = _make_adapter(tmp_path, api_key="sk-secret")
        app = _create_app(adapter)
        mock_list = MagicMock(return_value=ALL_JOBS)

        async with TestClient(TestServer(app)) as cli:
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(f"{_MOD}._cron_list", mock_list):
                resp = await cli.get(
                    "/api/jobs", headers={"Authorization": "Bearer sk-secret"}
                )
                assert resp.status == 200
                assert len((await resp.json())["jobs"]) == len(ALL_JOBS)
        mock_list.assert_called_once_with(include_disabled=False)

    @pytest.mark.asyncio
    async def test_metrics_route_wins_over_job_id_wildcard(self, tmp_path):
        """/api/jobs/metrics must not be swallowed by /api/jobs/{job_id}."""
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=[ALICE_WEB_JOB, BOB_JOB]
            ), patch("cron.executions.list_executions", return_value=[]):
                resp = await cli.get("/web/api/jobs/metrics")
                assert resp.status == 200
                body = await resp.json()

        # Bob's job is outside Alice's scope, so it is not counted.
        assert body["running"] == 1
        assert body["total"] == 1
        assert body["today_executed"] == 0
        assert body["success_rate"] is None


    @pytest.mark.asyncio
    async def test_metrics_counts_today_across_mixed_timestamp_offsets(self, tmp_path):
        """Ledger rows carry different UTC offsets; "today" must still be right.

        Older executions were written in UTC while current ones use the
        configured zone, so a date-string prefix match would drop rows (or
        stop the scan) around midnight.
        """
        from datetime import UTC, timedelta

        from hermes_time import now as hermes_now

        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        noon_today = hermes_now().replace(hour=12, minute=0, second=0, microsecond=0)
        midnight = hermes_now().replace(hour=0, minute=0, second=0, microsecond=0)
        ledger = [
            {
                "id": "e1",
                "job_id": ALICE_WEB_JOB["id"],
                "status": "completed",
                "claimed_at": noon_today.isoformat(),
            },
            {
                "id": "e2",
                "job_id": ALICE_WEB_JOB["id"],
                "status": "failed",
                # Same instant, written the old way (UTC).
                "claimed_at": noon_today.astimezone(UTC).isoformat(),
            },
            {
                "id": "e3",
                "job_id": ALICE_WEB_JOB["id"],
                "status": "completed",
                "claimed_at": (midnight - timedelta(hours=1)).isoformat(),
            },
        ]

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=[ALICE_WEB_JOB]
            ), patch("cron.executions.list_executions", return_value=ledger):
                resp = await cli.get("/web/api/jobs/metrics")
                assert resp.status == 200
                body = await resp.json()

        # Yesterday's row is excluded; both of today's count regardless of offset.
        assert body["today_executed"] == 2
        assert body["today_failed"] == 1
        assert body["success_rate"] == 0.5


class TestExecutionHistory:
    """Cross-task history: only your own tasks, filterable, paged."""

    def _ledger(self):
        from datetime import UTC, timedelta

        from hermes_time import now as hermes_now

        now = hermes_now()
        return [
            {
                "id": "e-recent-alice",
                "job_id": ALICE_WEB_JOB["id"],
                "status": "completed",
                "claimed_at": (now - timedelta(minutes=5)).isoformat(),
            },
            {
                "id": "e-recent-feishu",
                "job_id": ALICE_FEISHU_JOB["id"],
                "status": "failed",
                # Written the old way (UTC) — must still compare correctly.
                "claimed_at": (now - timedelta(minutes=30)).astimezone(UTC).isoformat(),
            },
            {
                "id": "e-old-alice",
                "job_id": ALICE_WEB_JOB["id"],
                "status": "completed",
                "claimed_at": (now - timedelta(days=3)).isoformat(),
            },
            {
                "id": "e-bob",
                "job_id": BOB_JOB["id"],
                "status": "completed",
                "claimed_at": (now - timedelta(minutes=10)).isoformat(),
            },
        ]

    @pytest.mark.asyncio
    async def test_history_covers_own_tasks_only_and_names_them(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        _bind(adapter, "bob@example.com", BOB)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ), patch("cron.executions.list_executions", return_value=self._ledger()):
                resp = await cli.get("/web/api/jobs/executions")
                assert resp.status == 200
                body = await resp.json()

        # Bob's row is gone; both of Alice's tasks are covered, web- and
        # Feishu-created alike, each row naming its task.
        assert [row["id"] for row in body["executions"]] == [
            "e-recent-alice",
            "e-recent-feishu",
            "e-old-alice",
        ]
        assert body["total"] == 3
        assert {row["job_name"] for row in body["executions"]} == {
            ALICE_WEB_JOB["name"],
            ALICE_FEISHU_JOB["name"],
        }

    @pytest.mark.asyncio
    async def test_history_filters_by_task(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ), patch("cron.executions.list_executions", return_value=self._ledger()):
                resp = await cli.get(
                    f"/web/api/jobs/executions?job_id={ALICE_FEISHU_JOB['id']}"
                )
                assert resp.status == 200
                body = await resp.json()

        assert [row["id"] for row in body["executions"]] == ["e-recent-feishu"]

    @pytest.mark.asyncio
    async def test_history_hides_other_peoples_task_filter(self, tmp_path):
        """Filtering by someone else's task id yields nothing, not an error."""
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        _bind(adapter, "bob@example.com", BOB)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ), patch("cron.executions.list_executions", return_value=self._ledger()):
                resp = await cli.get(f"/web/api/jobs/executions?job_id={BOB_JOB['id']}")
                assert resp.status == 200
                assert await resp.json() == {"executions": [], "total": 0}

    @pytest.mark.asyncio
    async def test_history_respects_the_since_bound(self, tmp_path):
        from datetime import timedelta

        from hermes_time import now as hermes_now

        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        since = (hermes_now() - timedelta(hours=1)).isoformat()

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ), patch("cron.executions.list_executions", return_value=self._ledger()):
                # params= lets aiohttp percent-encode the "+08:00" offset.
                resp = await cli.get(
                    "/web/api/jobs/executions", params={"since": since}
                )
                assert resp.status == 200
                body = await resp.json()

        # The 3-day-old row drops out; the UTC-stamped one stays.
        assert [row["id"] for row in body["executions"]] == [
            "e-recent-alice",
            "e-recent-feishu",
        ]

    @pytest.mark.asyncio
    async def test_history_pages(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ), patch("cron.executions.list_executions", return_value=self._ledger()):
                first = await cli.get("/web/api/jobs/executions?limit=2")
                second = await cli.get("/web/api/jobs/executions?limit=2&offset=2")
                first_body = await first.json()
                second_body = await second.json()

        assert [row["id"] for row in first_body["executions"]] == [
            "e-recent-alice",
            "e-recent-feishu",
        ]
        assert [row["id"] for row in second_body["executions"]] == ["e-old-alice"]
        # total is the full match count, so the pager knows where to stop.
        assert first_body["total"] == second_body["total"] == 3

    @pytest.mark.asyncio
    async def test_history_tolerates_an_unencoded_offset(self, tmp_path):
        """"+08:00" arrives as " 08:00" when a caller forgets to encode it."""
        from datetime import timedelta

        from hermes_time import now as hermes_now

        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        since = (hermes_now() - timedelta(hours=1)).isoformat()

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ), patch("cron.executions.list_executions", return_value=self._ledger()):
                resp = await cli.get(f"/web/api/jobs/executions?since={since}")
                assert resp.status == 200
                assert [row["id"] for row in (await resp.json())["executions"]] == [
                    "e-recent-alice",
                    "e-recent-feishu",
                ]

    @pytest.mark.asyncio
    async def test_history_rejects_a_bad_since(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_list", return_value=ALL_JOBS
            ):
                resp = await cli.get("/web/api/jobs/executions?since=not-a-date")
                assert resp.status == 400


class TestWebJobCreation:
    @pytest.mark.asyncio
    async def test_created_job_is_owned_paused_and_keeps_its_wording(self, tmp_path, llm):
        adapter = _make_adapter(tmp_path)
        account = _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        created = dict(ALICE_WEB_JOB, schedule_display="0 9 * * *", schedule={"kind": "cron"})
        llm.reply = "0 9 * * *"
        paused = dict(created, enabled=False, state="paused")

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_create", return_value=created
            ) as create, patch(
                f"{_MOD}._cron_update", return_value=created
            ) as update, patch(
                f"{_MOD}._cron_pause", return_value=paused
            ) as pause, patch(f"{_MOD}._notify_cron_provider_jobs_changed"):
                resp = await cli.post(
                    "/web/api/jobs",
                    json={
                        "name": "错误巡检",
                        "prompt": "检查错误日志",
                        "schedule_text": "每天早上 9 点",
                        "notify": {"kind": "self"},
                        "enabled": False,
                    },
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200, await resp.text()
                body = await resp.json()

        kwargs = create.call_args.kwargs
        # The Chinese sentence resolved to a real cron expression...
        assert kwargs["schedule"] == "0 9 * * *"
        # ...and "notify me" became origin delivery to the creator's own DM.
        assert kwargs["deliver"] == "origin"
        origin = kwargs["origin"]
        assert origin["platform"] == "feishu"
        # Owned by the same identity cron's per-user isolation compares.
        assert origin["user_id"] == ALICE["user_id"]
        assert origin["web_user_id"] == account["user_id"]
        assert origin["chat_id"] == ALICE["open_id"]
        # The list column shows the user's own words, not the cron expression.
        assert update.call_args.args[1]["schedule_display"] == "每天早上 9 点"
        pause.assert_called_once()
        assert body["job"]["enabled"] is False

    @pytest.mark.asyncio
    async def test_created_job_can_start_enabled_when_asked(self, tmp_path, llm):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        created = dict(ALICE_WEB_JOB, schedule_display="每 30 分钟")
        llm.reply = "every 30m"

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_create", return_value=created
            ) as create, patch(f"{_MOD}._cron_pause") as pause, patch(
                f"{_MOD}._notify_cron_provider_jobs_changed"
            ):
                resp = await cli.post(
                    "/web/api/jobs",
                    json={
                        "name": "巡检",
                        "prompt": "检查",
                        "schedule_text": "每 30 分钟",
                        "notify": {"kind": "self"},
                        "enabled": True,
                    },
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200, await resp.text()

        assert create.call_args.kwargs["schedule"] == "every 30m"
        pause.assert_not_called()

    @pytest.mark.asyncio
    async def test_group_delivery_requires_membership(self, tmp_path, llm):
        """A group the user is not in cannot become a delivery target."""
        llm.reply = "0 * * * *"
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        feishu = SimpleNamespace(
            list_group_chats=_async_return([
                {"chat_id": "oc_" + "a" * 32, "name": "值班群"},
                {"chat_id": "oc_" + "b" * 32, "name": "别人的群"},
            ]),
            # Alice is only in the first group.
            chat_has_member=_async_member_check({"oc_" + "a" * 32}),
        )
        app["feishu_adapter"] = feishu

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            headers = {"X-CSRF-Token": csrf}
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_create", return_value=ALICE_WEB_JOB
            ) as create, patch(f"{_MOD}._cron_pause", return_value=ALICE_WEB_JOB), patch(
                f"{_MOD}._cron_update", return_value=ALICE_WEB_JOB
            ), patch(f"{_MOD}._notify_cron_provider_jobs_changed"):
                payload = {
                    "name": "群播报",
                    "prompt": "汇总",
                    "schedule_text": "每小时",
                    "enabled": False,
                }
                denied = await cli.post(
                    "/web/api/jobs",
                    json={**payload, "notify": {"kind": "group", "chat_id": "oc_" + "b" * 32}},
                    headers=headers,
                )
                assert denied.status == 400
                assert "群" in (await denied.json())["error"]
                create.assert_not_called()

                allowed = await cli.post(
                    "/web/api/jobs",
                    json={**payload, "notify": {"kind": "group", "chat_id": "oc_" + "a" * 32}},
                    headers=headers,
                )
                assert allowed.status == 200, await allowed.text()
                assert create.call_args.kwargs["deliver"] == f"feishu:{'oc_' + 'a' * 32}"
                # Even for group delivery the job stays owned by its creator.
                assert create.call_args.kwargs["origin"]["user_id"] == ALICE["user_id"]

    @pytest.mark.asyncio
    async def test_group_picker_lists_only_shared_groups(self, tmp_path):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        app["feishu_adapter"] = SimpleNamespace(
            list_group_chats=_async_return([
                {"chat_id": "oc_" + "a" * 32, "name": "值班群"},
                {"chat_id": "oc_" + "b" * 32, "name": "别人的群"},
            ]),
            chat_has_member=_async_member_check({"oc_" + "a" * 32}),
        )

        async with TestClient(TestServer(app)) as cli:
            await _login(cli, "alice@example.com")
            resp = await cli.get("/web/api/feishu/chats")
            assert resp.status == 200
            assert (await resp.json())["chats"] == [
                {"chat_id": "oc_" + "a" * 32, "name": "值班群"}
            ]

    @pytest.mark.asyncio
    async def test_editing_frequency_reresolves_and_keeps_wording(self, tmp_path, llm):
        llm.reply = "0 9 * * 1"
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_get", return_value=ALICE_WEB_JOB
            ), patch(f"{_MOD}._cron_update", return_value=ALICE_WEB_JOB) as update, patch(
                f"{_MOD}._notify_cron_provider_jobs_changed"
            ):
                resp = await cli.patch(
                    f"/web/api/jobs/{ALICE_WEB_JOB['id']}",
                    json={"name": "改名", "schedule_text": "每周一 09:00"},
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200, await resp.text()

        sanitized = update.call_args.args[1]
        assert sanitized["schedule"] == "0 9 * * 1"
        assert sanitized["schedule_display"] == "每周一 09:00"
        assert sanitized["name"] == "改名"


class TestSchedulePreview:
    @pytest.mark.asyncio
    async def test_machine_format_preview_stays_offline(self, tmp_path, llm):
        """A cron expression needs no interpretation, so no model call."""
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True):
                resp = await cli.post(
                    "/web/api/jobs/parse-schedule",
                    json={"text": "0 9 * * *"},
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200
                body = await resp.json()

        assert body["schedule"] == "0 9 * * *"
        assert body["source"] == "passthrough"
        assert body["description"] == "每天 09:00 执行"
        assert len(body["next_runs"]) == 5
        assert body["next_run_at"] == body["next_runs"][0]
        assert body["once"] is False
        llm.assert_not_called()

    @pytest.mark.asyncio
    async def test_chinese_sentence_is_resolved_and_echoed(self, tmp_path, llm):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        llm.reply = "0 9 * * *"

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True):
                resp = await cli.post(
                    "/web/api/jobs/parse-schedule",
                    json={"text": "每天早上 9 点"},
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200
                body = await resp.json()

        assert body["schedule"] == "0 9 * * *"
        assert body["display"] == "每天早上 9 点"
        assert body["source"] == "llm"
        assert body["description"] == "每天 09:00 执行"
        llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_one_shot_sentence_previews_a_single_run(self, tmp_path, llm):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        llm.reply = "5m"

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True):
                resp = await cli.post(
                    "/web/api/jobs/parse-schedule",
                    json={"text": "5 分钟后提醒一次，只需要执行一次"},
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200
                body = await resp.json()

        assert body["once"] is True
        assert body["kind"] == "once"
        assert len(body["next_runs"]) == 1
        assert "执行一次" in body["description"]

    @pytest.mark.asyncio
    async def test_create_replays_the_preview_instead_of_re_resolving(self, tmp_path, llm):
        """What gets stored must be exactly what the user approved in the echo.

        A second model pass could answer differently, so the preview is
        cached and replayed — and the model is called once in total.
        """
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        llm.reply = "0 9 * * *"
        created = dict(ALICE_WEB_JOB, schedule_display="0 9 * * *", schedule={"kind": "cron"})

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            headers = {"X-CSRF-Token": csrf}
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_create", return_value=created
            ) as create, patch(f"{_MOD}._cron_update", return_value=created), patch(
                f"{_MOD}._cron_pause", return_value=created
            ), patch(f"{_MOD}._notify_cron_provider_jobs_changed"):
                preview = await cli.post(
                    "/web/api/jobs/parse-schedule",
                    json={"text": "每天早上 9 点"},
                    headers=headers,
                )
                assert preview.status == 200
                previewed = (await preview.json())["schedule"]

                # The model would answer differently on a second pass.
                llm.reply = "0 21 * * *"
                resp = await cli.post(
                    "/web/api/jobs",
                    json={
                        "name": "巡检",
                        "prompt": "检查",
                        "schedule_text": "每天早上 9 点",
                        "notify": {"kind": "self"},
                        "enabled": False,
                    },
                    headers=headers,
                )
                assert resp.status == 200, await resp.text()

        assert previewed == "0 9 * * *"
        assert create.call_args.kwargs["schedule"] == previewed
        llm.assert_called_once()

    @pytest.mark.asyncio
    async def test_one_shot_job_is_created_enabled_and_keeps_its_record(
        self, tmp_path, llm
    ):
        """A one-shot must not start paused, and must survive its own run.

        Paused, it would miss its only moment and then refuse to resume
        ("one-shot time is in the past"). And with cron's default repeat=1 the
        record is deleted the instant it finishes, so the repeat limit is
        cleared here — see tests/cron/test_oneshot_retention.py for the cron
        half of that contract.
        """
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        llm.reply = "5m"
        created = dict(ALICE_WEB_JOB, schedule_display="5m", schedule={"kind": "once"})

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True), patch(
                f"{_MOD}._cron_create", return_value=created
            ), patch(f"{_MOD}._cron_update", return_value=created) as update, patch(
                f"{_MOD}._cron_pause"
            ) as pause, patch(f"{_MOD}._notify_cron_provider_jobs_changed"):
                resp = await cli.post(
                    "/web/api/jobs",
                    json={
                        "name": "5 分钟后提醒",
                        "prompt": "提醒我喝水",
                        "schedule_text": "5 分钟后提醒一次",
                        "notify": {"kind": "self"},
                        # Even with the toggle off, a one-shot starts enabled.
                        "enabled": False,
                    },
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 200, await resp.text()

        pause.assert_not_called()
        assert update.call_args.args[1]["repeat"] == {"times": None, "completed": 0}

    @pytest.mark.asyncio
    async def test_backend_outage_answers_503_not_bad_input(self, tmp_path, llm):
        """A provider outage gets its own message and status, not "rewrite it"."""
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        llm.side_effect = RuntimeError("provider down")

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True):
                resp = await cli.post(
                    "/web/api/jobs/parse-schedule",
                    json={"text": "每天早上 9 点"},
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 503
                assert (await resp.json())["error"] == "解析服务暂时不可用，请稍后再点「解析」重试"

    @pytest.mark.asyncio
    async def test_unusable_model_answer_is_rejected_with_guidance(self, tmp_path, llm):
        adapter = _make_adapter(tmp_path)
        _bind(adapter, "alice@example.com", ALICE)
        app = _create_app(adapter)
        llm.reply = "抱歉，我不知道"

        async with TestClient(TestServer(app)) as cli:
            csrf = await _login(cli, "alice@example.com")
            with patch(f"{_MOD}._CRON_AVAILABLE", True):
                resp = await cli.post(
                    "/web/api/jobs/parse-schedule",
                    json={"text": "看心情跑一下"},
                    headers={"X-CSRF-Token": csrf},
                )
                assert resp.status == 400
                assert "每天 09:00" in (await resp.json())["error"]

        llm.assert_called_once()


def _async_return(value):
    async def _call(*_args, **_kwargs):
        return value

    return _call


def _async_member_check(member_of: set):
    async def _call(chat_id, _subject, _id_type="open_id", **_kwargs):
        return chat_id in member_of

    return _call
