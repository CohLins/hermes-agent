# 飞书 Profile Skill 精简与复原手册

> 记录时间：2026-07-21
> 适用对象：`feishu` Profile（`~/.hermes/profiles/feishu/`）
> 目标：精简 feishu 能看到的 skill，**全程只动 feishu，不影响个人微信（weixin）**。

## 背景：skill 的两种类型

| 类型 | 位置 | 删除影响 | 复原来源 |
|------|------|---------|---------|
| **自研 local**（3 个） | `~/.hermes/profiles/feishu/skills/<name>/` 顶层 | 删了不会自动回来 | 需从 atom-project 原版重新迁移 |
| **bundled builtin** | 各 category 子目录，seed 自 hermes 仓库 `skills/` + `optional-skills/` | 删了会被 `hermes update`/sync **重新 seed 回来**（除非 opt-out） | hermes 自带，`opt-in --sync` 可恢复 |

**只影响 feishu 的原理**：每个 Profile 的 skills 目录物理独立（`profiles/feishu/skills/` vs `profiles/weixin/skills/` 各有整套副本），`opt-out` 标记也只写进当前 Profile。因此删 feishu 的任何 skill，weixin 那份原封不动。

---

## 一、清除操作（本次实际执行）

### 1. 停止 bundled seeding（关键，防止删了又被 seed 回来）

```bash
source ~/.venvs/hermes/bin/activate
cd /Users/szld2403178/IdeaProjects/hermes-agent
python ./hermes -p feishu skills opt-out
# → 写标记 ~/.hermes/profiles/feishu/.no-bundled-skills
#   （仅 feishu；不删现有文件；此后 install/update/sync 不再向 feishu seed bundled skill）
```

### 2. 精确删除指定 skill

> ⚠️ 两个坑（本次踩过）：
> 1. **zsh 不对未加引号的变量做单词分割** → 必须用数组 `("${arr[@]}")`，不能 `for s in $VAR`。
> 2. **部分 skill 的物理目录名 ≠ 显示名（frontmatter name）** → `find -name <显示名>` 会找不到，需按实际目录名删。已知差异：
>    - `audiocraft-audio-generation` → 目录 `mlops/models/audiocraft`
>    - `serving-llms-vllm` → 目录 `mlops/inference/vllm`
>    - `evaluating-llms-harness` → 目录 `mlops/evaluation/lm-evaluation-harness`

```bash
SKDIR=/Users/szld2403178/.hermes/profiles/feishu/skills

# 按显示名能直接 find 到的（目录名==显示名）
TODELETE=(xurl research-paper-writing openhue polymarket blogwatcher arxiv \
  petdex teams-meeting-pipeline huggingface-hub weights-and-biases llama-cpp \
  youtube-content heartmula gif-search songsee \
  codebase-inspection github-auth github-code-review github-issues github-pr-workflow github-repo-management \
  himalaya jupyter-live-kernel songwriting-and-ai-music \
  apple-notes apple-reminders findmy imessage \
  hermes-desktop-plugins yuanbao computer-use dogfood)
for s in "${TODELETE[@]}"; do
  find "$SKDIR" -type d -name "$s" -exec rm -rf {} + 2>/dev/null
done

# 目录名 ≠ 显示名的 3 个，按实际路径删
rm -rf "$SKDIR/mlops/models/audiocraft" \
       "$SKDIR/mlops/inference/vllm" \
       "$SKDIR/mlops/evaluation/lm-evaluation-harness"

# 清理删空后的 category 目录
find "$SKDIR" -mindepth 1 -type d -empty -delete 2>/dev/null
```

### 3. 让飞书侧生效

删除改的是磁盘目录；运行中的 gateway 会话仍持有旧的 `<available_skills>` 索引，必须重启重建：

```bash
python ./hermes -p feishu gateway restart      # 或前台 run 的话 Ctrl-C 重跑
```

### 4. 验证

```bash
python ./hermes -p feishu skills list | tail -3
# 应显示：0 hub-installed, 38 builtin, 3 local — 41 enabled, 0 disabled
```

---

## 二、复原操作

复原**不依赖备份**，bundled skill 源在 hermes 仓库自带（`skills/` + `optional-skills/`）。

### 全部恢复（推荐，最省心）

```bash
python ./hermes -p feishu skills opt-in --sync
# → 删除 .no-bundled-skills 标记 + 立即重新 seed 全部 bundled 回来
#   （删掉的都回来，保留的不动）
python ./hermes -p feishu gateway restart
```

### 单个恢复

```bash
python ./hermes -p feishu skills reset <skill显示名> --restore
# 把该 skill 恢复为 bundled 版本
# 注：若该 skill 目录已被删除，reset 可能无 "current copy" 可替换；
#     此时最稳的做法是先 opt-in --sync 全量恢复，再重新删掉不想要的。
```

> ⚠️ **自研 3 个（archery-query / bit-log-search / sso-bit-login）不是 bundled**，
> 一旦删除，`opt-in`/`reset` 都恢复不了，只能从 atom-project 原版重新迁移。本次未删它们。

---

## 三、Skill 清单（2026-07-21 精简后）

### ✅ 保留（41 个）

**自研 local（3）**：`archery-query`、`bit-log-search`、`sso-bit-login`

**bundled builtin（38）**：

| category | 保留的 skill |
|----------|-------------|
| autonomous-ai-agents (4) | claude-code、codex、hermes-agent、opencode |
| creative (15) | architecture-diagram、ascii-art、ascii-video、baoyu-infographic、claude-design、comfyui、design-md、excalidraw、humanizer、manim-video、p5js、popular-web-designs、pretext、sketch、touchdesigner-mcp |
| mlops (1) | segment-anything-model |
| note-taking (1) | obsidian |
| productivity (7) | airtable、google-workspace、maps、nano-pdf、notion、ocr-and-documents、powerpoint |
| research (1) | llm-wiki |
| software-development (9) | hermes-agent-skill-authoring、node-inspect-debugger、plan、python-debugpy、requesting-code-review、simplify-code、spike、systematic-debugging、test-driven-development |

### ❌ 已删除（35 个）

| category | 删除的 skill |
|----------|-------------|
| (顶层) | computer-use、dogfood、hermes-desktop-plugins、yuanbao |
| apple (全部 4) | apple-notes、apple-reminders、findmy、imessage |
| data-science (全部 1) | jupyter-live-kernel |
| email (全部 1) | himalaya |
| github (全部 6) | codebase-inspection、github-auth、github-code-review、github-issues、github-pr-workflow、github-repo-management |
| media (全部 4) | gif-search、heartmula、songsee、youtube-content |
| mlops (6) | audiocraft-audio-generation、huggingface-hub、evaluating-llms-harness、weights-and-biases、llama-cpp、serving-llms-vllm |
| productivity (2) | petdex、teams-meeting-pipeline |
| research (4) | arxiv、blogwatcher、polymarket、research-paper-writing |
| smart-home (全部 1) | openhue |
| social-media (全部 1) | xurl |
| creative (1) | songwriting-and-ai-music |

---

## 四、注意事项

1. **微信不受影响**：本次操作全部带 `-p feishu`，只动 `profiles/feishu/`。weixin 的 skill 保持完整。
2. **opt-out 的副作用**：opt-out 后，将来 hermes 新版本新增的 bundled skill 也不会自动进 feishu。想恢复自动 seeding 用 `opt-in`（不加 `--sync` 只恢复未来 seeding，加 `--sync` 立即拉回全部）。
3. **删/复原后都要 `gateway restart`**：`<available_skills>` 是会话级构建并缓存的，光改磁盘不重启，正在跑的会话看不到变化。
4. **weixin 若也要精简**：把上面命令里的 `-p feishu` 换成 `-p weixin`、路径换成 `profiles/weixin/skills`，独立操作。
