"""obsidian — Obsidian permanent-memory provider using the MemoryProvider ABC.

Mirrors the built-in memory/user tool writes into an Obsidian vault as
human-readable Markdown notes and auto-recalls relevant ones before each turn.
This turns the agent's permanent memory (USER.md / MEMORY.md) into a second
brain that lives in Obsidian, alongside the actively-curated knowledge base
(handled separately by the obsidian-mcp tools + obsidian-kb skill).

Design notes
------------
* Filesystem-only. Reads/writes vault Markdown directly via pathlib (like the
  Holographic provider talks to SQLite directly) — it does NOT go through
  obsidian-mcp, needs no plugin, and does not require Obsidian.app to be open.
* Storage lives under ``<vault>/<subdir>/`` (default ``Agent记忆/``):
    - ``画像/`` — target=user  (user profile mirror)
    - ``自记/`` — target=memory (agent self-memory mirror)
    - ``<任意分类>/`` — free-form categories created on demand by the
      ``obsidian_memory add`` tool via its ``category`` argument (e.g.
      ``心情/``, ``我们的故事/``).  The *mirror* path can only ever produce the
      two fixed buckets above, because the built-in memory tool's ``target``
      enum is ``user``/``memory``; the *direct-write* path has no such limit,
      so agent-curated categories grow organically like the obsidian-kb
      skill's own taxonomy.  Retrieval indexes every subdirectory, so new
      categories are searchable without a code change.
    - ``.trash/`` — removed notes (soft delete, recoverable)
  Dot-prefixed directories are never indexed.  ``自记`` deliberately avoids the
  name ``知识``: the obsidian-kb skill owns a top-level ``知识/`` with a
  different meaning (domain-classified knowledge notes), and two folders with
  the same name in one vault is confusing.
  This is the provider's private area; the obsidian-kb skill treats it as
  read-only and skips it during maintenance, so the two layers never fight.
* Retrieval uses an in-memory, CJK-aware scorer (character bigram + substring +
  token overlap) refreshed by file mtime. Default FTS5 does not tokenize
  Chinese, and its trigram tokenizer misses 2-character queries (常见中文查询
  如「偏好」「地址」) — an in-memory scorer recalls those correctly, has no
  index-vs-file drift, and needs no extra DB file. The vault is authoritative.

Config in $HERMES_HOME/config.yaml (profile-scoped):
  plugins:
    obsidian-memory:
      vault_path: /abs/path/to/vault   # empty → $OBSIDIAN_VAULT_PATH → ~/Documents/Obsidian Vault
      subdir: Agent记忆                 # subdir inside the vault for the mirror

Activate (profile config.yaml, NEVER the global ~/.hermes/config.yaml):
  memory:
    memory_enabled: true          # built-in memory must be on to produce writes
    user_profile_enabled: true
    provider: obsidian
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error
from hermes_cli.config import cfg_get

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_SUBDIR = "Agent记忆"
_DEFAULT_VAULT = "~/Documents/Obsidian Vault"
# target (from the built-in memory tool) -> subdirectory / tag.
# These two are the only buckets the *mirror* path can produce; the direct
# ``obsidian_memory add`` path may create free-form categories alongside them.
_TARGET_DIRS = {"user": "画像", "memory": "自记"}
_TARGET_TAGS = {"user": "画像", "memory": "自记"}
_TRASH_DIR = ".trash"

# Free-form category names for the direct-write path. Must be a single safe
# path segment: no separators, no ``..`` traversal, no dots/whitespace-only,
# bounded length. Chinese is expected and allowed.
_CATEGORY_MAX_LEN = 24
_CATEGORY_FORBIDDEN = set('/\\:*?"<>|')


def _safe_category(value: Any) -> Optional[str]:
    """Normalize a caller-supplied category into a safe single path segment.

    Returns ``None`` when absent or unusable, so callers fall back to the
    target's default bucket rather than writing outside the memory area.
    """
    if not isinstance(value, str):
        return None
    # Only surrounding whitespace is normalized. Anything else is *rejected*
    # rather than sanitized: silently rewriting ".hidden" into "hidden" would
    # file the note somewhere the caller never asked for.
    name = value.strip()
    if not name or len(name) > _CATEGORY_MAX_LEN:
        return None
    # Leading dot would hide the directory from _refresh_index (and ".."
    # would traverse); trailing dots are filesystem-hostile.
    if name.strip(".") != name:
        return None
    if any(ch in _CATEGORY_FORBIDDEN for ch in name):
        return None
    if any(ch.isspace() for ch in name):
        return None
    # Reserved: never let a category collide with the trash area.
    if name == _TRASH_DIR.lstrip("."):
        return None
    return name

_PREFETCH_LIMIT = 5
_PREFETCH_MIN_SCORE = 1.0
_SEARCH_LIMIT = 10
_MAX_FILENAME_LEN = 40
# Contexts whose writes must not corrupt the user's long-term representation.
_SKIP_WRITE_CONTEXTS = {"cron", "subagent", "flush"}

_ILLEGAL_FS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_CJK = re.compile(r"[一-鿿]")
_ALNUM_CJK = re.compile(r"[^\w一-鿿]")


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _load_plugin_config() -> dict:
    from hermes_constants import get_hermes_home
    config_path = get_hermes_home() / "config.yaml"
    if not config_path.exists():
        return {}
    try:
        import yaml
        with open(config_path, encoding="utf-8-sig") as f:
            all_config = yaml.safe_load(f) or {}
        return cfg_get(all_config, "plugins", "obsidian-memory", default={}) or {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

def _first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        s = line.strip()
        if s:
            return s
    return ""


def _slugify(content: str) -> str:
    """Readable, filesystem-safe stem from the first line of content."""
    first = _first_nonempty_line(content) or "memory"
    first = _ILLEGAL_FS.sub("", first)
    first = re.sub(r"\s+", " ", first).strip()
    if len(first) > _MAX_FILENAME_LEN:
        first = first[:_MAX_FILENAME_LEN].rstrip()
    return first or "memory"


def _content_hash(content: str) -> str:
    return hashlib.sha1(content.strip().encode("utf-8")).hexdigest()[:10]


def _strip_frontmatter(text: str) -> str:
    """Return note body with any leading YAML frontmatter removed."""
    if text.startswith("---"):
        lines = text.split("\n")
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return "\n".join(lines[i + 1:]).strip()
    return text.strip()


def _frontmatter_field(text: str, field: str) -> Optional[str]:
    """Read one scalar field out of a note's leading YAML frontmatter.

    Used for ``memory_target``: the directory encodes the *category*, so the
    ``他/咕嘎`` axis has to come from the note itself — otherwise a note written
    with ``target=user`` into a custom category would be indexed as self-memory
    and drop out of ``target=user`` filtering.
    """
    if not text.startswith("---"):
        return None
    lines = text.split("\n")
    prefix = f"{field}:"
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line.startswith(prefix):
            return line[len(prefix):].strip() or None
    return None


def _bigrams(s: str) -> set:
    if len(s) >= 2:
        return {s[i:i + 2] for i in range(len(s) - 1)}
    return {s} if s else set()


def _score(query: str, text: str) -> float:
    """CJK-aware relevance score. Works for latin tokens and short CJK queries."""
    q = query.strip().lower()
    if not q:
        return 0.0
    t = text.lower()
    score = 0.0
    if len(q) >= 2 and q in t:
        score += 10.0
    q_tokens = set(re.findall(r"[a-z0-9]{2,}", q))
    if q_tokens:
        t_tokens = set(re.findall(r"[a-z0-9]{2,}", t))
        score += 2.0 * len(q_tokens & t_tokens)
    q_bi = _bigrams(_ALNUM_CJK.sub("", q))
    if q_bi:
        t_bi = _bigrams(_ALNUM_CJK.sub("", t))
        score += 1.5 * len(q_bi & t_bi)
    q_cjk = set(_CJK.findall(q))
    if q_cjk:
        t_cjk = set(_CJK.findall(t))
        score += 0.3 * len(q_cjk & t_cjk)
    return score


# ---------------------------------------------------------------------------
# Tool schema
# ---------------------------------------------------------------------------

OBSIDIAN_MEMORY_SCHEMA = {
    "name": "obsidian_memory",
    "description": (
        "长期记忆（存于 Obsidian vault 的 Agent记忆 区，跨会话持久、人类可读）。"
        "与内置 memory 工具互补：内置 memory 管始终在场的精简上下文并会自动镜像到此；"
        "obsidian_memory 用于深检索与主动沉淀。\n"
        "ACTIONS：\n"
        "• search — 按关键词检索长期记忆（回答用户偏好/过往结论前先查）。\n"
        "• add — 主动沉淀一条值得长期记住的事实；可用 category 归类。\n"
        "• get — 按 vault 相对路径读取一条记忆全文。\n"
        "• list — 列出长期记忆（可按 target/category 过滤，最近优先）。\n"
        "分类：category 是自由文本，按需生长（如 心情/我们的故事/工作）。"
        "新建前先 list 看现有分类，能归入就不要另起——分类过多反而找不到。"
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["search", "add", "get", "list"]},
            "query": {"type": "string", "description": "检索关键词（search 必填）。"},
            "content": {"type": "string", "description": "要沉淀的事实内容（add 必填）。"},
            "target": {
                "type": "string",
                "enum": ["user", "memory"],
                "description": "user=用户画像；memory=助手自记（默认 memory）。",
            },
            "category": {
                "type": "string",
                "description": (
                    "自由分类，落在 Agent记忆/<分类>/ 下（add 可选；list 可用于过滤）。"
                    "不填则按 target 落默认区（画像/自记）。不能含路径分隔符或空格，最长 24 字。"
                ),
            },
            "path": {"type": "string", "description": "记忆笔记的 vault 相对路径（get 必填）。"},
            "limit": {"type": "integer", "description": "最大返回条数（默认 10）。"},
        },
        "required": ["action"],
    },
}


# ---------------------------------------------------------------------------
# MemoryProvider implementation
# ---------------------------------------------------------------------------

class ObsidianMemoryProvider(MemoryProvider):
    """Mirror built-in memory into an Obsidian vault and recall it each turn."""

    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._vault_path: Optional[Path] = None
        self._memory_root: Optional[Path] = None
        self._writes_enabled = True
        self._tool_writes_enabled = True
        self._session_id = ""
        self._lock = threading.RLock()
        # in-memory index: {abs_path_str: {"target","content","mtime"}}
        self._index: Dict[str, Dict[str, Any]] = {}

    @property
    def name(self) -> str:
        return "obsidian"

    def is_available(self) -> bool:
        # Local filesystem provider; pyyaml is a hermes dependency. No network.
        return True

    # -- config (hermes memory setup) ---------------------------------------

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "vault_path",
                "description": (
                    "Obsidian vault 绝对路径（留空则用 $OBSIDIAN_VAULT_PATH，"
                    "再退回 ~/Documents/Obsidian Vault）"
                ),
                "default": _DEFAULT_VAULT,
            },
            {
                "key": "subdir",
                "description": "vault 内存放 agent 记忆镜像的子目录",
                "default": _DEFAULT_SUBDIR,
            },
        ]

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        config_path = Path(hermes_home) / "config.yaml"
        try:
            import yaml
            existing: dict = {}
            if config_path.exists():
                with open(config_path, encoding="utf-8-sig") as f:
                    existing = yaml.safe_load(f) or {}
            existing.setdefault("plugins", {})
            existing["plugins"]["obsidian-memory"] = values
            with open(config_path, "w", encoding="utf-8") as f:
                yaml.dump(existing, f, default_flow_style=False, allow_unicode=True)
        except Exception:
            pass

    # -- lifecycle ----------------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        self._session_id = session_id or ""
        agent_context = str(kwargs.get("agent_context", "primary") or "primary")
        # Two gates, not one.
        #
        # ``_writes_enabled`` covers mirroring built-in memory writes and any
        # write aimed at the *user profile*.  It stays primary-only: outside a
        # primary session the built-in store is absent or read-only, so a
        # mirror write would either duplicate an existing note or invent a
        # user fact out of machine text.
        #
        # ``_tool_writes_enabled`` covers direct ``obsidian_memory add`` calls
        # about the agent itself.  Cron is included on purpose: a scheduled
        # wake is precisely when an agent records its own state, and without
        # this it improvises around the provider (writing raw notes through
        # whatever file/MCP tool it can reach), which bypasses dedup, the
        # index and the target/category contract.
        self._writes_enabled = agent_context == "primary"
        self._tool_writes_enabled = agent_context in ("primary", "cron")

        vault = (
            self._config.get("vault_path")
            or os.environ.get("OBSIDIAN_VAULT_PATH")
            or _DEFAULT_VAULT
        )
        hermes_home = str(kwargs.get("hermes_home", "") or "")
        if isinstance(vault, str):
            if hermes_home:
                vault = vault.replace("$HERMES_HOME", hermes_home).replace("${HERMES_HOME}", hermes_home)
            vault = os.path.expanduser(os.path.expandvars(vault))
        self._vault_path = Path(vault)
        subdir = str(self._config.get("subdir") or _DEFAULT_SUBDIR)
        self._memory_root = self._vault_path / subdir
        try:
            for tgt_dir in list(_TARGET_DIRS.values()) + self._declared_categories():
                (self._memory_root / tgt_dir).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(
                "Obsidian memory: cannot create dirs under %s: %s", self._memory_root, e
            )
        self._refresh_index()

    def _declared_categories(self) -> List[str]:
        """Categories from config, pre-created so ``list`` can advertise them.

        The inventory ``list`` returns is otherwise derived from notes that
        already exist, so a fresh vault advertises nothing and the agent has to
        invent a bucket name from whatever the prompt told it.  That is exactly
        how a batch of the *user's* preferences ended up in a category reserved
        for the *agent's* own interests: the name was reachable by guesswork and
        nothing on disk contradicted the guess.  Declaring the buckets makes the
        structure, not the prose, the thing the agent reads.
        """
        raw = self._config.get("categories")
        if not isinstance(raw, (list, tuple)):
            return []
        out: List[str] = []
        for item in raw:
            name = _safe_category(item)
            if name and name not in out:
                out.append(name)
        return out

    def _category_dirs(self) -> set:
        """Category directories present on disk, whether or not they hold notes."""
        if not self._memory_root:
            return set()
        try:
            return {
                d.name
                for d in self._memory_root.iterdir()
                if d.is_dir() and not d.name.startswith(".")
            }
        except OSError:
            return set()

    def system_prompt_block(self) -> str:
        if not self._memory_root:
            return ""
        with self._lock:
            count = len(self._index)
        rel = self._rel(self._memory_root)
        if count == 0:
            return (
                "# 长期记忆（Obsidian）\n"
                f"已接入，镜像目录 `{rel}/` 暂空。内置 memory/user 工具的写入会自动镜像到此并每轮自动回忆；"
                "也可用 obsidian_memory 工具主动检索/沉淀长期记忆。"
            )
        return (
            "# 长期记忆（Obsidian）\n"
            f"已接入，{count} 条长期记忆存于 `{rel}/`（画像=用户，自记=助手自记，也可按 category 自建分类）。"
            "回答涉及用户偏好/过往结论前，先用 obsidian_memory(action='search') 检索；相关记忆也会每轮自动注入。"
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not query or not self._memory_root:
            return ""
        try:
            self._refresh_index()
            with self._lock:
                scored = [
                    (_score(query, e.get("content", "")), e)
                    for e in self._index.values()
                ]
            scored = [(s, e) for s, e in scored if s >= _PREFETCH_MIN_SCORE]
            if not scored:
                return ""
            scored.sort(key=lambda x: x[0], reverse=True)
            lines = []
            for _, entry in scored[:_PREFETCH_LIMIT]:
                # Show the real category (directory) so free-form buckets like
                # 心情/我们的故事 are distinguishable at a glance; fall back to
                # the target label for entries indexed before a category existed.
                label = entry.get("category") or (
                    "画像" if entry.get("target") == "user" else "记忆"
                )
                lines.append(f"- [{label}] {self._oneline(entry.get('content', ''))}")
            return "## 长期记忆（Obsidian）\n" + "\n".join(lines)
        except Exception as e:
            logger.debug("Obsidian prefetch failed: %s", e)
            return ""

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [OBSIDIAN_MEMORY_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        if tool_name != "obsidian_memory":
            return tool_error(f"Unknown tool: {tool_name}")
        try:
            action = args.get("action")
            if action == "search":
                return self._tool_search(args)
            if action == "add":
                return self._tool_add(args)
            if action == "get":
                return self._tool_get(args)
            if action == "list":
                return self._tool_list(args)
            return tool_error(f"Unknown action: {action}")
        except Exception as exc:
            return tool_error(str(exc))

    # -- mirror hook --------------------------------------------------------

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror a built-in memory write into the vault."""
        if not self._writes_enabled:
            return
        meta = metadata or {}
        if str(meta.get("execution_context", "") or "") in _SKIP_WRITE_CONTEXTS:
            return
        target = "user" if target == "user" else "memory"
        try:
            if action == "add":
                self._write_note(target, content, source="memory-mirror")
            elif action == "replace":
                old_text = meta.get("old_text")
                if old_text:
                    self._trash_note(target, str(old_text))
                self._write_note(target, content, source="memory-mirror")
            elif action == "remove":
                self._trash_note(target, content)
        except Exception as e:
            logger.debug("Obsidian on_memory_write failed: %s", e)

    def backup_paths(self) -> List[str]:
        """The mirror lives inside the vault (outside HERMES_HOME) — declare it."""
        vault = (
            self._config.get("vault_path")
            or os.environ.get("OBSIDIAN_VAULT_PATH")
            or _DEFAULT_VAULT
        )
        subdir = str(self._config.get("subdir") or _DEFAULT_SUBDIR)
        try:
            root = Path(os.path.expanduser(os.path.expandvars(str(vault)))) / subdir
            return [str(root)]
        except Exception:
            return []

    # -- tool handlers ------------------------------------------------------

    def _tool_search(self, args: dict) -> str:
        query = args.get("query", "")
        if not query:
            return tool_error("search requires 'query'")
        limit = int(args.get("limit", _SEARCH_LIMIT))
        target = args.get("target")
        self._refresh_index()
        with self._lock:
            scored = []
            for key, entry in self._index.items():
                if target and entry.get("target") != target:
                    continue
                s = _score(query, entry.get("content", ""))
                if s > 0:
                    scored.append((s, key, entry))
        scored.sort(key=lambda x: x[0], reverse=True)
        results = [
            {
                "path": self._rel(Path(key)),
                "target": entry.get("target"),
                "content": entry.get("content", ""),
            }
            for _, key, entry in scored[:limit]
        ]
        return json.dumps({"results": results, "count": len(results)}, ensure_ascii=False)

    def _tool_add(self, args: dict) -> str:
        content = args.get("content", "")
        if not content:
            return tool_error("add requires 'content'")
        if not self._tool_writes_enabled:
            return tool_error("writes disabled in non-primary context")
        target = "user" if args.get("target") == "user" else "memory"
        if target == "user" and not self._writes_enabled:
            return tool_error(
                "this session can read the user profile but not write it; "
                "record it with target='memory' instead"
            )
        raw_category = args.get("category")
        category = _safe_category(raw_category)
        result = self._write_note(
            target, content, source="obsidian_memory", category=category
        )
        if category:
            result["category"] = category
        elif isinstance(raw_category, str) and raw_category.strip():
            # Surface silent fallbacks: a rejected category would otherwise look
            # like a successful classified write.
            result["category_ignored"] = raw_category
        return json.dumps(result, ensure_ascii=False)

    def _tool_get(self, args: dict) -> str:
        rel = args.get("path")
        if not rel:
            return tool_error("get requires 'path'")
        if not self._vault_path or not self._memory_root:
            return tool_error("not initialized")
        try:
            path = (self._vault_path / rel).resolve()
            root = self._memory_root.resolve()
        except Exception:
            return tool_error("bad path")
        if path != root and root not in path.parents:
            return tool_error("path outside memory area")
        if not path.is_file():
            return tool_error("not found")
        return json.dumps(
            {"path": rel, "content": path.read_text(encoding="utf-8")},
            ensure_ascii=False,
        )

    def _tool_list(self, args: dict) -> str:
        limit = int(args.get("limit", _SEARCH_LIMIT))
        target = args.get("target")
        category = _safe_category(args.get("category"))
        self._refresh_index()
        with self._lock:
            items = [
                (entry.get("mtime", 0), key, entry)
                for key, entry in self._index.items()
                if (not target or entry.get("target") == target)
                and (not category or entry.get("category") == category)
            ]
            # Advertise every bucket that exists, so the agent can reuse one
            # instead of inventing a near-duplicate.  Union with the on-disk
            # directories, not just indexed notes: an empty-but-declared
            # category has to be visible, otherwise the inventory is silent
            # exactly during cold start — when the agent is most likely to
            # guess a name and file the note in the wrong place.
            categories = sorted(
                {e.get("category") for e in self._index.values() if e.get("category")}
                | self._category_dirs()
            )
        items.sort(key=lambda x: x[0], reverse=True)
        results = [
            {
                "path": self._rel(Path(key)),
                "target": entry.get("target"),
                "category": entry.get("category"),
                "preview": self._oneline(entry.get("content", ""), 120),
            }
            for _, key, entry in items[:limit]
        ]
        return json.dumps(
            {"memories": results, "count": len(results), "categories": categories},
            ensure_ascii=False,
        )

    # -- storage ------------------------------------------------------------

    def _target_dir(self, target: str, category: Optional[str] = None) -> Path:
        """Resolve the directory for a write.

        A validated *category* wins over the target's default bucket, letting
        the direct-write path grow free-form categories. ``_safe_category`` has
        already rejected separators/traversal, so this stays inside the memory
        area.
        """
        safe = _safe_category(category)
        sub = safe or _TARGET_DIRS.get(target, _TARGET_DIRS["memory"])
        return self._memory_root / sub

    def _note_path(self, target: str, content: str, category: Optional[str] = None) -> Path:
        fname = f"{_slugify(content)}-{_content_hash(content)}.md"
        return self._target_dir(target, category) / fname

    def _render_note(self, target: str, content: str, source: str, created: str, updated: str,
                     category: Optional[str] = None) -> str:
        safe = _safe_category(category)
        tag = safe or _TARGET_TAGS.get(target, _TARGET_TAGS["memory"])
        category_line = f"category: {safe}\n" if safe else ""
        return (
            "---\n"
            "type: agent-memory\n"
            f"memory_target: {target}\n"
            f"{category_line}"
            f"tags: [agent记忆, {tag}]\n"
            f"created: {created}\n"
            f"updated: {updated}\n"
            f"source: {source}\n"
            "---\n\n"
            f"{content.strip()}\n"
        )

    def _atomic_write(self, path: Path, text: str) -> None:
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    def _write_note(self, target: str, content: str, source: str,
                    category: Optional[str] = None) -> Dict[str, Any]:
        content = (content or "").strip()
        if not content:
            return {"status": "skipped", "reason": "empty"}
        if not self._memory_root:
            return {"status": "error", "reason": "not initialized"}
        path = self._note_path(target, content, category)
        with self._lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                # identical content already stored (filename encodes content hash)
                self._index_put(path, target)
                return {"status": "exists", "path": self._rel(path)}
            today = date.today().isoformat()
            self._atomic_write(
                path, self._render_note(target, content, source, today, today, category)
            )
            self._index_put(path, target)
            return {"status": "added", "path": self._rel(path)}

    def _trash_note(self, target: str, content: str) -> bool:
        content = (content or "").strip()
        if not content or not self._memory_root:
            return False
        with self._lock:
            path = self._note_path(target, content)
            if not path.exists():
                found = self._find_by_content(content)
                if not found:
                    return False
                path = found
            trash_dir = self._memory_root / _TRASH_DIR
            try:
                trash_dir.mkdir(parents=True, exist_ok=True)
                dest = trash_dir / path.name
                if dest.exists():
                    dest.unlink()
                os.replace(path, dest)
            except OSError as e:
                logger.debug("Obsidian memory trash failed: %s", e)
                return False
            self._index.pop(str(path), None)
            return True

    def _find_by_content(self, content: str) -> Optional[Path]:
        target = content.strip()
        with self._lock:
            for key, entry in self._index.items():
                if entry.get("content", "").strip() == target:
                    return Path(key)
        return None

    # -- index --------------------------------------------------------------

    def _refresh_index(self) -> None:
        if not self._memory_root:
            return
        with self._lock:
            seen = set()
            # Index every subdirectory, not just the two mirror buckets, so
            # free-form categories created via ``obsidian_memory add`` are
            # searchable without a code change. Dot-dirs (notably ``.trash``)
            # stay excluded — trashed notes must not come back through recall.
            _user_dir = _TARGET_DIRS["user"]
            for d in sorted(self._memory_root.iterdir()):
                if not d.is_dir() or d.name.startswith("."):
                    continue
                # Directory name is the category. The 他/咕嘎 axis is
                # independent: prefer the note's own ``memory_target`` so a
                # ``target=user`` note filed under a custom category still
                # filters as user. Directory is only the fallback (e.g.
                # hand-written notes with no frontmatter).
                dir_target = "user" if d.name == _user_dir else "memory"
                category = d.name
                for p in d.glob("*.md"):
                    if p.name.startswith("."):
                        continue
                    key = str(p)
                    seen.add(key)
                    try:
                        mtime = p.stat().st_mtime
                    except OSError:
                        continue
                    cached = self._index.get(key)
                    if cached and cached.get("mtime") == mtime:
                        continue
                    try:
                        raw = p.read_text(encoding="utf-8")
                    except OSError:
                        continue
                    fm_target = _frontmatter_field(raw, "memory_target")
                    self._index[key] = {
                        "target": fm_target if fm_target in ("user", "memory") else dir_target,
                        "category": category,
                        "content": _strip_frontmatter(raw),
                        "mtime": mtime,
                    }
            for key in list(self._index.keys()):
                if key not in seen:
                    self._index.pop(key, None)

    def _index_put(self, path: Path, target: str) -> None:
        try:
            raw = path.read_text(encoding="utf-8")
            self._index[str(path)] = {
                "target": target,
                # Parent directory is authoritative for the category, so a
                # freshly written note in a custom category is filterable
                # immediately (before the next full _refresh_index).
                "category": path.parent.name,
                "content": _strip_frontmatter(raw),
                "mtime": path.stat().st_mtime,
            }
        except OSError:
            pass

    # -- misc ---------------------------------------------------------------

    def _rel(self, path: Path) -> str:
        try:
            return str(path.relative_to(self._vault_path))
        except Exception:
            return str(path)

    def _oneline(self, content: str, limit: int = 200) -> str:
        text = re.sub(r"\s+", " ", content.strip())
        if len(text) > limit:
            text = text[:limit].rstrip() + "…"
        return text


# ---------------------------------------------------------------------------
# Plugin entry point
# ---------------------------------------------------------------------------

def register(ctx) -> None:
    """Register the Obsidian permanent-memory provider with the plugin system."""
    config = _load_plugin_config()
    provider = ObsidianMemoryProvider(config=config)
    ctx.register_memory_provider(provider)
