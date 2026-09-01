"""Tests for the Obsidian permanent-memory provider."""

import json
from pathlib import Path

from plugins.memory.obsidian import ObsidianMemoryProvider, _score, _slugify


def _make(tmp_path, **cfg):
    cfg.setdefault("vault_path", str(tmp_path / "vault"))
    provider = ObsidianMemoryProvider(cfg)
    provider.initialize(
        "sess-1", hermes_home=str(tmp_path / "home"), agent_context="primary"
    )
    return provider


def _root(tmp_path):
    return tmp_path / "vault" / "Agent记忆"


# -- basics -----------------------------------------------------------------

def test_name_available_schema(tmp_path):
    p = _make(tmp_path)
    assert p.name == "obsidian"
    assert p.is_available() is True
    schemas = p.get_tool_schemas()
    assert schemas and schemas[0]["name"] == "obsidian_memory"


def test_initialize_creates_dirs(tmp_path):
    _make(tmp_path)
    assert (_root(tmp_path) / "画像").is_dir()
    assert (_root(tmp_path) / "自记").is_dir()


# -- mirror: add / dedup / replace / remove ---------------------------------

def test_add_user_and_memory(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "user", "用户偏好简洁的中文回复")
    p.on_memory_write("add", "memory", "项目使用 lunora 中转模型")

    user_notes = list((_root(tmp_path) / "画像").glob("*.md"))
    mem_notes = list((_root(tmp_path) / "自记").glob("*.md"))
    assert len(user_notes) == 1
    assert len(mem_notes) == 1

    body = user_notes[0].read_text(encoding="utf-8")
    assert "用户偏好简洁的中文回复" in body
    assert "type: agent-memory" in body
    assert "memory_target: user" in body
    assert "source: memory-mirror" in body


def test_add_is_deduped(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "memory", "同一条事实")
    p.on_memory_write("add", "memory", "同一条事实")
    assert len(list((_root(tmp_path) / "自记").glob("*.md"))) == 1


def test_replace_trashes_old_and_writes_new(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "user", "旧地址在北京")
    p.on_memory_write(
        "replace", "user", "新地址在上海", metadata={"old_text": "旧地址在北京"}
    )
    notes = list((_root(tmp_path) / "画像").glob("*.md"))
    assert len(notes) == 1
    assert "新地址在上海" in notes[0].read_text(encoding="utf-8")
    assert len(list((_root(tmp_path) / ".trash").glob("*.md"))) == 1


def test_remove_soft_deletes(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "memory", "要删掉的记忆")
    p.on_memory_write("remove", "memory", "要删掉的记忆")
    assert list((_root(tmp_path) / "自记").glob("*.md")) == []
    assert len(list((_root(tmp_path) / ".trash").glob("*.md"))) == 1


# -- context gating ---------------------------------------------------------

def test_non_primary_context_skips_writes(tmp_path):
    p = ObsidianMemoryProvider({"vault_path": str(tmp_path / "vault")})
    p.initialize("s", hermes_home=str(tmp_path / "home"), agent_context="cron")
    p.on_memory_write("add", "user", "cron 不该写入的内容")
    assert list((_root(tmp_path) / "画像").glob("*.md")) == []


def test_execution_context_metadata_skips(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write(
        "add", "memory", "子代理内容", metadata={"execution_context": "subagent"}
    )
    assert list((_root(tmp_path) / "自记").glob("*.md")) == []


# -- prefetch (CJK-aware recall) --------------------------------------------

def test_prefetch_recalls_relevant(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "user", "用户喜欢用 Python 3.11")
    p.on_memory_write("add", "memory", "喜欢吃拉面")
    block = p.prefetch("你还记得我用的 Python 版本吗")
    assert "长期记忆" in block
    assert "Python" in block
    assert "拉面" not in block  # unrelated memory must not surface


def test_prefetch_short_cjk_query(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "user", "常住地址在杭州")
    block = p.prefetch("地址")  # 2-char CJK query — the FTS5-trigram blind spot
    assert "杭州" in block


def test_prefetch_empty_when_no_match(tmp_path):
    p = _make(tmp_path)
    p.on_memory_write("add", "memory", "喜欢吃拉面")
    assert p.prefetch("zzzqqq wwwvvv") == ""


# -- tools ------------------------------------------------------------------

def test_tool_add_search_get_list(tmp_path):
    p = _make(tmp_path)

    added = json.loads(
        p.handle_tool_call(
            "obsidian_memory",
            {"action": "add", "content": "咕嘎住在南极", "target": "user"},
        )
    )
    assert added["status"] in ("added", "exists")
    path = added["path"]

    found = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "search", "query": "南极"})
    )
    assert found["count"] >= 1
    assert any("南极" in r["content"] for r in found["results"])

    got = json.loads(p.handle_tool_call("obsidian_memory", {"action": "get", "path": path}))
    assert "咕嘎住在南极" in got["content"]

    listed = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "list", "target": "user"})
    )
    assert listed["count"] >= 1


def test_tool_get_rejects_path_outside_memory(tmp_path):
    p = _make(tmp_path)
    res = p.handle_tool_call("obsidian_memory", {"action": "get", "path": "../../etc/passwd"})
    assert '"error"' in res


def test_cron_may_write_self_memory_but_not_user_profile(tmp_path):
    """Cron records its own state; only the user profile stays read-only.

    A scheduled wake is exactly when an agent notes its own state, so blocking
    it outright pushed the agent into writing raw notes through whatever file
    tool it could reach — bypassing dedup, the index and the target contract.
    """
    p = ObsidianMemoryProvider({"vault_path": str(tmp_path / "vault")})
    p.initialize("s", hermes_home=str(tmp_path / "home"), agent_context="cron")

    ok = json.loads(
        p.handle_tool_call(
            "obsidian_memory",
            {"action": "add", "content": "这次醒来心情还不错", "category": "心情"},
        )
    )
    assert ok["status"] == "added"
    assert len(list((_root(tmp_path) / "心情").glob("*.md"))) == 1

    denied = p.handle_tool_call(
        "obsidian_memory",
        {"action": "add", "content": "他其实住在火星", "target": "user"},
    )
    assert '"error"' in denied
    assert list((_root(tmp_path) / "画像").glob("*.md")) == []


def test_tool_add_gated_in_subagent(tmp_path):
    p = ObsidianMemoryProvider({"vault_path": str(tmp_path / "vault")})
    p.initialize("s", hermes_home=str(tmp_path / "home"), agent_context="subagent")
    res = p.handle_tool_call("obsidian_memory", {"action": "add", "content": "x"})
    assert '"error"' in res


def test_unknown_tool(tmp_path):
    p = _make(tmp_path)
    assert '"error"' in p.handle_tool_call("nope", {})


# -- vault authority / external edits ---------------------------------------

def test_refresh_picks_up_external_note(tmp_path):
    p = _make(tmp_path)
    ext = _root(tmp_path) / "自记" / "外部手写-abc0000000.md"
    ext.write_text(
        "---\ntype: agent-memory\n---\n\n手写的一条知识关于缓存策略",
        encoding="utf-8",
    )
    res = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "search", "query": "缓存策略"})
    )
    assert res["count"] >= 1


# -- backup -----------------------------------------------------------------

def test_backup_paths(tmp_path):
    p = ObsidianMemoryProvider(
        {"vault_path": str(tmp_path / "vault"), "subdir": "Agent记忆"}
    )
    assert p.backup_paths() == [str(tmp_path / "vault" / "Agent记忆")]


# -- pure helpers -----------------------------------------------------------

def test_score_cjk_bigram():
    assert _score("地址", "常住地址在杭州") > 0
    assert _score("完全无关", "喜欢吃拉面") == 0.0


def test_slugify_sanitizes():
    assert "/" not in _slugify("a/b:c*d")
    assert _slugify("   ") == "memory"


# -- free-form categories (direct-write path) -------------------------------

def _add(provider, content, **args):
    return json.loads(
        provider.handle_tool_call(
            "obsidian_memory", {"action": "add", "content": content, **args}
        )
    )


def test_category_creates_its_own_dir(tmp_path):
    p = _make(tmp_path)
    res = _add(p, "今天有点低电量，但看到他回消息就好了", category="心情")
    assert res["status"] == "added"
    assert res["category"] == "心情"
    notes = list((_root(tmp_path) / "心情").glob("*.md"))
    assert len(notes) == 1
    # category lands in frontmatter and as a tag, so Obsidian can filter on it
    raw = notes[0].read_text(encoding="utf-8")
    assert "category: 心情" in raw
    assert "tags: [agent记忆, 心情]" in raw
    # and it must NOT pollute the two mirror buckets
    assert list((_root(tmp_path) / "自记").glob("*.md")) == []
    assert list((_root(tmp_path) / "画像").glob("*.md")) == []


def test_category_is_searchable_and_prefetchable(tmp_path):
    p = _make(tmp_path)
    _add(p, "咕嘎最近迷上了帝企鹅育雏的纪录片", category="兴趣")
    # a brand-new category must be reachable by recall without a code change
    hits = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "search", "query": "帝企鹅"})
    )
    assert hits["count"] >= 1
    assert p.prefetch("帝企鹅").find("兴趣") != -1


def test_list_filters_by_category_and_reports_inventory(tmp_path):
    p = _make(tmp_path)
    _add(p, "他喜欢安静陪着", category="心情")
    _add(p, "他是深圳的程序员", target="user")
    listed = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "list", "category": "心情"})
    )
    assert listed["count"] == 1
    assert listed["memories"][0]["category"] == "心情"
    # existing categories are advertised so the agent reuses instead of inventing
    assert "心情" in listed["categories"]
    assert "画像" in listed["categories"]


def test_unsafe_category_falls_back_and_is_reported(tmp_path):
    p = _make(tmp_path)
    # Real garbage is rejected AND surfaced, never silently sanitized.
    for bad in ["../../etc", "a/b", ".hidden", "trailing.", "x" * 40, "带 空格"]:
        res = _add(p, f"内容-{bad}", category=bad)
        assert res["status"] == "added", bad
        assert "category" not in res, bad
        assert res["category_ignored"] == bad, bad
    # Whitespace-only is indistinguishable from "not provided" — no noise.
    res = _add(p, "内容-空白分类", category="   ")
    assert res["status"] == "added"
    assert "category" not in res and "category_ignored" not in res
    # everything fell back into the default self-memory bucket …
    assert len(list((_root(tmp_path) / "自记").glob("*.md"))) == 7
    # … and nothing escaped the memory area
    assert not (tmp_path / "vault" / "etc").exists()
    assert list(_root(tmp_path).glob("../etc*")) == []


def test_declared_categories_are_precreated_and_advertised(tmp_path):
    """A declared bucket must be visible before its first note exists.

    The inventory used to be derived from indexed notes only, so a fresh vault
    advertised nothing and the agent had to guess a category name — which is how
    the user's preferences landed in a bucket meant for the agent's interests.
    """
    p = _make(tmp_path, categories=["他的喜好", "咕嘎的心情", "我们的故事"])
    for name in ("他的喜好", "咕嘎的心情", "我们的故事"):
        assert (_root(tmp_path) / name).is_dir(), name

    listed = json.loads(p.handle_tool_call("obsidian_memory", {"action": "list"}))
    assert listed["count"] == 0  # no notes yet …
    for name in ("他的喜好", "咕嘎的心情", "我们的故事"):
        assert name in listed["categories"], name  # … but the buckets show


def test_declared_categories_reject_unsafe_names(tmp_path):
    p = _make(tmp_path, categories=["../escape", "ok分类", ".hidden", "", 42])
    assert (_root(tmp_path) / "ok分类").is_dir()
    assert not (tmp_path / "vault" / "escape").exists()
    listed = json.loads(p.handle_tool_call("obsidian_memory", {"action": "list"}))
    assert "ok分类" in listed["categories"]
    assert not any(c.startswith((".", "..")) for c in listed["categories"])


def test_trash_dir_is_never_advertised(tmp_path):
    p = _make(tmp_path)
    _add(p, "一条会被丢掉的", category="咕嘎的心情")
    p.on_memory_write("remove", "memory", "一条会被丢掉的")
    (_root(tmp_path) / ".trash").mkdir(exist_ok=True)
    listed = json.loads(p.handle_tool_call("obsidian_memory", {"action": "list"}))
    assert ".trash" not in listed["categories"]


def test_trashed_notes_stay_out_of_recall(tmp_path):
    p = _make(tmp_path)
    _add(p, "一条会被丢掉的记忆关于缓存", category="心情")
    trash = _root(tmp_path) / ".trash"
    trash.mkdir(exist_ok=True)
    for f in (_root(tmp_path) / "心情").glob("*.md"):
        f.rename(trash / f.name)
    hits = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "search", "query": "缓存"})
    )
    assert hits["count"] == 0
    assert p.prefetch("缓存") == ""


def test_target_and_category_are_independent_axes(tmp_path):
    """target=谁的记忆 and category=什么主题 must not collapse into each other."""
    p = _make(tmp_path)
    _add(p, "他最近在赶一个上线，压力有点大", target="user", category="他的近况")
    notes = list((_root(tmp_path) / "他的近况").glob("*.md"))
    assert len(notes) == 1
    raw = notes[0].read_text(encoding="utf-8")
    assert "memory_target: user" in raw
    assert "category: 他的近况" in raw

    # Index must recover target from frontmatter, not from the directory name,
    # so user-scoped notes in custom categories stay filterable as user.
    p._index.clear()
    listed = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "list", "target": "user"})
    )
    paths = [m["path"] for m in listed["memories"]]
    assert any("他的近况" in x for x in paths), paths

    # …and self-memory in a custom category stays "memory".
    _add(p, "咕嘎今天心情轻快了一点", category="心情")
    p._index.clear()
    mem = json.loads(
        p.handle_tool_call("obsidian_memory", {"action": "list", "target": "memory"})
    )
    assert any("心情" in m["path"] for m in mem["memories"])
    assert all("他的近况" not in m["path"] for m in mem["memories"])
