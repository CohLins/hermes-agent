"""飞书 cron 按创建者 user_id 隔离的单测（tools/cronjob_tools.py）。

覆盖：
- 开关关闭 → 行为不变（回归护栏）；
- 开关开启 + 当前 user=A：list 只见 A；操作 B/无归属任务返回 not found；改自己成功；
- 无 session user_id（CLI/管理员）→ 全可见、可操作全部（含无 origin 的存量任务）；
- context_from 跨用户引用被拒。

隔离开关经 ``hermes_cli.config.load_config`` 读取、当前用户经
``gateway.session_context.get_session_env`` 读取——两者都是 ``_isolation_user_id``
的函数级 import，直接 monkeypatch 模块属性即可生效。归属任务用
``cron.jobs.create_job(origin=...)`` 直接构造，避免依赖 session env。
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


@pytest.fixture
def cron_env(tmp_path, monkeypatch):
    """把 cron store 重定向到临时 HERMES_HOME（与 test_cron_context_from 同款）。"""
    hermes_home = tmp_path / ".hermes"
    hermes_home.mkdir()
    (hermes_home / "cron").mkdir()
    (hermes_home / "cron" / "output").mkdir()
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))

    import cron.jobs as jobs_mod
    monkeypatch.setattr(jobs_mod, "HERMES_DIR", hermes_home)
    monkeypatch.setattr(jobs_mod, "CRON_DIR", hermes_home / "cron")
    monkeypatch.setattr(jobs_mod, "JOBS_FILE", hermes_home / "cron" / "jobs.json")
    monkeypatch.setattr(jobs_mod, "OUTPUT_DIR", hermes_home / "cron" / "output")

    return hermes_home


def _activate(monkeypatch, current_user, *, enabled=True, with_origin_env=False):
    """设置隔离开关与"当前会话用户"。

    current_user=None 模拟 CLI/调度器（无 session user_id）。
    with_origin_env=True 时补齐 platform/chat_id，使经 cronjob 工具 create 的任务
    带上 origin（用于 context_from 用例）。
    """
    import hermes_cli.config as config_mod
    monkeypatch.setattr(
        config_mod, "load_config", lambda: {"cron": {"user_isolation": enabled}}
    )
    import gateway.session_context as sc
    env = {}
    if current_user is not None:
        env["HERMES_SESSION_USER_ID"] = current_user
        if with_origin_env:
            env["HERMES_SESSION_PLATFORM"] = "feishu"
            env["HERMES_SESSION_CHAT_ID"] = "chat-1"
    monkeypatch.setattr(sc, "get_session_env", lambda k: env.get(k))


def _mkjob(prompt, user_id=None):
    """直接建库任务并显式指定归属 user_id（None = 无 origin，模拟存量/CLI 任务）。"""
    from cron.jobs import create_job
    origin = (
        {"platform": "feishu", "chat_id": "chat-1", "user_id": user_id}
        if user_id is not None
        else None
    )
    return create_job(prompt=prompt, schedule="every 1h", origin=origin)


def cronjob_call(action, **kwargs):
    from tools.cronjob_tools import cronjob
    return cronjob(action=action, **kwargs)


# =========================================================================
# list 过滤
# =========================================================================

class TestListIsolation:
    def test_list_shows_only_own_jobs(self, cron_env, monkeypatch):
        job_a = _mkjob("A 的任务", user_id="userA")
        job_b = _mkjob("B 的任务", user_id="userB")
        legacy = _mkjob("存量无归属任务", user_id=None)

        _activate(monkeypatch, "userA")
        result = json.loads(cronjob_call("list"))

        ids = {j["job_id"] for j in result["jobs"]}
        assert ids == {job_a["id"]}
        assert job_b["id"] not in ids
        assert legacy["id"] not in ids

    def test_list_off_shows_all(self, cron_env, monkeypatch):
        """开关关闭 → 行为不变，全部可见（回归护栏）。"""
        job_a = _mkjob("A 的任务", user_id="userA")
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, "userA", enabled=False)
        result = json.loads(cronjob_call("list"))

        ids = {j["job_id"] for j in result["jobs"]}
        assert ids == {job_a["id"], job_b["id"]}

    def test_list_no_session_user_is_admin(self, cron_env, monkeypatch):
        """无 session user_id（CLI）→ 视为管理员，全可见含无归属任务。"""
        job_a = _mkjob("A 的任务", user_id="userA")
        job_b = _mkjob("B 的任务", user_id="userB")
        legacy = _mkjob("存量无归属任务", user_id=None)

        _activate(monkeypatch, None, enabled=True)
        result = json.loads(cronjob_call("list"))

        ids = {j["job_id"] for j in result["jobs"]}
        assert ids == {job_a["id"], job_b["id"], legacy["id"]}


# =========================================================================
# 查改删归属校验
# =========================================================================

class TestMutationIsolation:
    def test_remove_other_users_job_denied(self, cron_env, monkeypatch):
        from cron.jobs import get_job
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, "userA")
        out = cronjob_call("remove", job_id=job_b["id"])

        assert "not found" in out.lower()
        # 未被删除
        assert get_job(job_b["id"]) is not None

    def test_remove_own_job_allowed(self, cron_env, monkeypatch):
        from cron.jobs import get_job
        job_a = _mkjob("A 的任务", user_id="userA")

        _activate(monkeypatch, "userA")
        out = json.loads(cronjob_call("remove", job_id=job_a["id"]))

        assert out["success"] is True
        assert get_job(job_a["id"]) is None

    def test_update_other_users_job_denied(self, cron_env, monkeypatch):
        from cron.jobs import get_job
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, "userA")
        out = cronjob_call("update", job_id=job_b["id"], name="hijacked")

        assert "not found" in out.lower()
        assert get_job(job_b["id"])["name"] != "hijacked"

    def test_pause_other_users_job_denied(self, cron_env, monkeypatch):
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, "userA")
        out = cronjob_call("pause", job_id=job_b["id"])

        assert "not found" in out.lower()

    def test_remove_legacy_no_origin_job_denied_for_user(self, cron_env, monkeypatch):
        """存量无 origin 任务对飞书用户不可操作（fail-closed）。"""
        from cron.jobs import get_job
        legacy = _mkjob("存量无归属任务", user_id=None)

        _activate(monkeypatch, "userA")
        out = cronjob_call("remove", job_id=legacy["id"])

        assert "not found" in out.lower()
        assert get_job(legacy["id"]) is not None

    def test_remove_off_allows_any(self, cron_env, monkeypatch):
        """开关关闭 → 无归属校验（回归护栏）。"""
        from cron.jobs import get_job
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, "userA", enabled=False)
        out = json.loads(cronjob_call("remove", job_id=job_b["id"]))

        assert out["success"] is True
        assert get_job(job_b["id"]) is None

    def test_admin_can_remove_any(self, cron_env, monkeypatch):
        """无 session user_id（CLI）→ 可操作任意任务。"""
        from cron.jobs import get_job
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, None, enabled=True)
        out = json.loads(cronjob_call("remove", job_id=job_b["id"]))

        assert out["success"] is True
        assert get_job(job_b["id"]) is None


# =========================================================================
# context_from 防越权引用
# =========================================================================

class TestContextFromIsolation:
    def test_context_from_cross_user_denied(self, cron_env, monkeypatch):
        job_b = _mkjob("B 的任务", user_id="userB")

        _activate(monkeypatch, "userA", with_origin_env=True)
        out = cronjob_call(
            "create",
            prompt="Summarize findings",
            schedule="every 2h",
            context_from=job_b["id"],
        )

        assert "not found" in out.lower()

    def test_context_from_own_job_allowed(self, cron_env, monkeypatch):
        job_a = _mkjob("A 的任务", user_id="userA")

        _activate(monkeypatch, "userA", with_origin_env=True)
        out = json.loads(
            cronjob_call(
                "create",
                prompt="Summarize findings",
                schedule="every 2h",
                context_from=job_a["id"],
            )
        )

        assert out["success"] is True
