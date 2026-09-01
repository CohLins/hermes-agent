# obsidian — Obsidian 永久记忆 Provider

把 agent 的内置永久记忆（`USER.md` 用户画像 / `MEMORY.md` 助手自记）**自动镜像**进
Obsidian vault，并在**每轮对话前自动回忆**相关条目。让永久记忆变成一个存在 Obsidian 里、
人类可读、可与知识库联动的「第二大脑」。

这是**永久记忆层**（自动、后台）。与之叠在同一个 vault 上的**知识库层**（主动、按规则沉淀/
组织/维护）由 obsidian-mcp 工具 + `obsidian-kb` skill 负责，两者互不干涉。

## 工作原理

- **纯文件系统**：直接用 pathlib 读写 vault 的 Markdown（如 Holographic 直连 SQLite），
  **不经 obsidian-mcp**、无需插件、无需打开 Obsidian.app。
- **镜像**：内置 memory 工具每次成功写入（add/replace/remove）时，`MemoryManager` 调
  `on_memory_write(action, target, content, metadata)`；本 provider 据此在 vault 落地/更新/回收笔记。
  - `target=user`  → `<vault>/<subdir>/画像/`
  - `target=memory` → `<vault>/<subdir>/知识/`
  - `replace` = 回收旧条（按 `metadata.old_text`）+ 写新条；`remove` = 移入 `.trash/`（软删，可恢复）。
  - 文件名 = `<内容首行slug>-<内容sha1前10位>.md`，同内容天然去重、幂等。
  - 每篇带 frontmatter：`type: agent-memory` / `memory_target` / `tags` / `created` / `updated` / `source`。
- **回忆**：`prefetch(query)` 用 **CJK-aware 内存打分**（字符 bigram + 子串 + token 重叠）从镜像区
  取 top-k 注入。索引按文件 mtime 增量刷新，vault 为权威源（外部在 Obsidian 里的手改也会被读到）。
  > 为何不用 SQLite FTS5：默认分词器不切中文；trigram 分词器又匹配不到 2 字中文查询
  > （如「偏好」「地址」）。内存打分对短中文查询召回正确、无索引漂移、无需额外 DB 文件。
- **主动工具**：暴露 `obsidian_memory`（`search` / `add` / `get` / `list`），供 agent 主动深检索、
  沉淀一条长期事实、读全文、列清单。
- **上下文隔离**：非 `primary`（cron / subagent / flush）上下文的写入被跳过，避免污染用户长期画像；
  读取不受限。
- **备份**：镜像目录在 vault 内（HERMES_HOME 之外），已通过 `backup_paths()` 声明，`hermes backup` 会收录。

## 配置

Profile 级 `config.yaml`（**绝不写全局 `~/.hermes/config.yaml`**，否则其它 profile 会一起激活）：

```yaml
memory:
  memory_enabled: true          # 内置记忆必须开着，才有写入可镜像（默认即 true）
  user_profile_enabled: true    # 用户画像同理
  provider: obsidian            # 激活本 provider

plugins:
  obsidian-memory:
    vault_path: /abs/path/to/vault   # 留空 → $OBSIDIAN_VAULT_PATH → ~/Documents/Obsidian Vault
    subdir: Agent记忆                 # vault 内镜像子目录
```

vault 路径优先级：`plugins.obsidian-memory.vault_path` → 环境变量 `OBSIDIAN_VAULT_PATH`
（写在 profile 的 `.env`）→ 默认 `~/Documents/Obsidian Vault`。

## 目录布局（vault 内）

```
<vault>/Agent记忆/
  画像/      # target=user   用户画像镜像
  知识/      # target=memory 助手自记镜像
  .trash/    # 软删除的笔记（可恢复）
```

`obsidian-kb` skill 把 `Agent记忆/` 当**只读**，维护/体检时跳过，两层不打架。

## 只用一个外部 provider

同一时刻只能激活一个外部 memory provider。启用 `obsidian` 后，该 profile 不能同时用
mem0 / honcho / holographic 等。内置记忆始终与外部 provider 并存。

## 测试

```bash
uv run pytest tests/plugins/memory/test_obsidian_provider.py
```
