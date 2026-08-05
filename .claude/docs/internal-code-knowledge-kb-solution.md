# 多项目内部代码知识库落地方案

> 状态：方案设计
>
> 目标：在不让知识库替代当前源码的前提下，减少内部多项目代码排查时的全仓库搜索时间。
>
> 适用环境：当前 macOS + Hermes Agent + `feishu` profile + `service-registry` 代码镜像/worktree 体系。

---

## 1. 最终结论：第一期到底落地成什么

### 1.1 推荐形态

第一期不是单独做一个“会自己回答问题的知识库”，而是落地为三个相互配合的部分：

```text
┌──────────────────────────────────────────────┐
│ internal-code-knowledge Skill                 │
│ 规定什么时候查知识库、什么时候必须回源码验证 │
└──────────────────┬───────────────────────────┘
                   │ 调用现有 terminal/file
                   ▼
┌──────────────────────────────────────────────┐
│ code-kb CLI                                   │
│ 路由、索引、检索、版本检查、失效、验证记录    │
└──────────────────┬───────────────────────────┘
                   │ 只读读取当前 worktree
                   ▼
┌──────────────────────────────────────────────┐
│ 本地 SQLite + FTS5                            │
│ 多项目 / 多分支 / commit 快照 / 证据版本       │
└──────────────────────────────────────────────┘
```

**最终形式：**

1. **CLI 是事实管理和更新机制的主体**，例如 `code-kb search`、`code-kb verify`、`code-kb refresh`。
2. **Skill 是 Agent 的操作规程和安全门禁**，告诉 Agent 如何使用 CLI，以及什么时候不能直接相信结果。
3. **SQLite + FTS5 是本地知识索引和证据存储**，不是对外发送的云端向量库。
4. **不新增 Hermes core Tool**。现有 `terminal`、`file`、Skill 已足够调用第一期 CLI。
5. **第一期不做 MCP**。如果后续需要给 IDE、其他 Agent 或远程客户端复用，再增加一个薄 MCP 适配层，MCP 不拥有自己的知识库逻辑。
6. **不把代码事实写入 Memory**。Memory 保存用户偏好和稳定工作习惯；代码事实放在带版本的 code-kb 数据库中。

### 1.2 不推荐的形态

| 方案 | 是否采用 | 原因 |
|---|---:|---|
| 只写一个大型 Skill 文档 | 否 | 更新困难，无法感知 commit、分支和工作区变化 |
| 只做 Markdown 知识库 | 否 | 适合人读，但不适合按文件/符号/commit 精确失效 |
| 只做向量数据库 | 否 | 精确字段、SQL ID、方法名、枚举值更适合全文/符号索引；还会引入嵌入模型和数据外泄风险 |
| 直接把代码知识写入 Memory | 否 | Memory 没有源码版本语义，容易把旧实现当成当前实现 |
| 新增 Hermes core Tool | 否 | 增加每轮模型工具 schema 和核心维护面；当前已有 terminal/file 能调用 CLI |
| 第一版直接做 MCP | 否 | 先解决本地多项目索引和证据门禁，MCP 只是后续复用接口 |
| 用 code-wiki 代替运行知识库 | 否 | code-wiki 是一次性参考文档生成器，不负责实时失效和验证门禁 |
| 用 GitNexus 代替运行知识库 | 否 | GitNexus 适合图可视化和调用关系探索，不是当前项目事实的版本化证据库 |

---

## 2. 结合当前 Hermes 和现有 Skill 的现状

### 2.1 当前已经存在的能力

当前环境已经有以下关键能力，不应该重复建设：

| 现有能力 | 当前职责 | 本方案中的定位 |
|---|---|---|
| `service-registry` | 业务名/项目别名 → 项目、服务、代码目录、日志 Skill、默认分支；支持 worktree | **唯一项目路由入口**，不在 code-kb 中复制项目映射 |
| `internal-code-investigation` | 内部项目代码排查流程和代码证据要求 | 保留为主要领域调查 Skill，增加 code-kb 的快速定位步骤 |
| `legacy-project-code-research` | 老项目/截图/业务名 → 项目路由 → 代码链路调查 | 作为老项目调查流程，调用 code-kb 做候选定位，最终仍回源码 |
| `bit-log-search`、`opensearch-query`、`dynatrace-data` 等 | 运行日志、监控、业务数据查询 | 继续作为 L3 运行证据来源；不放入代码索引 |
| `code-wiki`（仓库 optional skill） | 生成 Markdown Wiki、Mermaid 图 | 在需要产出文档时使用；不作为实时事实源 |
| `gitnexus-explorer`（仓库 optional skill） | 代码知识图谱和网页可视化 | 作为可选的架构/调用关系可视化工具，不作为判断门禁 |
| `llm-wiki` | 互联 Markdown 研究知识库 | 可用于人工研究笔记，但不存放当前代码事实 |
| Hermes `terminal` + `file` | 执行 CLI、读取源码、搜索文件 | 第一阶段足够，不增加新 core Tool |

### 2.2 当前代码镜像纪律必须保留

`service-registry` 当前使用的镜像路径类似：

```text
~/.cache/claude-skills/service-registry/repos/<project>/
├── .bare/
└── wt/
    ├── release/
    ├── ECR-xxxx/
    └── ...
```

必须继续遵守：

- 镜像 worktree 只读检索，不在里面编辑、提交或推送；
- 需要其他分支时通过 `service_registry.py worktree <project> <branch>` 获取；
- 不在 code-kb 中复制或修改 `services.yaml`；
- code-kb 只写自己的索引目录和 SQLite，不写回业务仓库；
- `service_registry.py resolve` 默认可能触发 fetch/reset，第一期调用时默认使用 `--no-fetch`；需要刷新代码时走显式 `refresh` 流程。

### 2.3 为什么不直接修改现有 service-registry

`service-registry` 的职责是“路由到哪个项目和代码目录”，而 code-kb 的职责是“索引什么代码、当前索引对应哪个 commit、哪些知识已经过期”。两者的数据生命周期不同：

```text
service-registry：项目路由配置
code-kb：代码快照、文件索引、符号索引、证据和失效状态
```

把两者合并会导致：

- 项目路由 YAML 变成大型知识库；
- 每次代码更新都修改路由数据；
- 不能区分“项目没命中”和“代码知识过期”；
- 多分支证据容易互相覆盖。

因此采用适配器调用，而不是合并存储。

---

## 3. 第一阶段的目标边界

### 3.1 第一阶段必须解决的问题

1. 通过中文业务名快速定位多个项目，而不是手工猜仓库路径。
2. 对每个项目按 `project + branch + commit` 建立独立索引。
3. 支持精确检索字段、类、方法、枚举、Mapper SQL ID、Controller 路由和配置 key。
4. 返回候选文件和符号时，明确这是 **navigation hint**，不是最终结论。
5. 每次查询前检查当前 worktree 的 branch、HEAD、dirty 状态。
6. 代码变化后，自动增量更新索引并把相关知识标记为 `stale`。
7. 删除、重命名、分支切换、rebase 后，不继续沿用失效引用。
8. 只有读取当前源码并生成证据后，知识条目才能进入 `source_verified`。
9. 运行日志、数据库、接口响应和生产部署版本作为独立 L3 证据保存，不能被源码事实替代。
10. 两个项目同名字段、同名类、同名业务词互不覆盖。

### 3.2 第一阶段明确不做的事情

- 不自动修改业务仓库代码；
- 不自动 fetch、reset、切换分支，除非用户明确执行刷新动作；
- 不抓取生产数据库或日志到 code-kb；运行数据仍由现有日志/数据 Skill 查询；
- 不默认使用外部 embedding、云端向量数据库或第三方代码上传服务；
- 不让 LLM 根据一段历史自然语言自动覆盖事实；
- 不把生产行为推断为源码行为，也不把源码行为推断为生产已部署行为；
- 不实现全语言精确 AST 分析；第一期优先 Java、XML、SQL、配置和通用文本索引；
- 不建设图形 UI；需要可视化时再调用 GitNexus。

---

## 4. 目标架构和调用链

### 4.1 查询链路

```text
用户提出业务问题
       │
       ▼
匹配 internal-code-knowledge / internal-code-investigation Skill
       │
       ▼
code-kb route/resolve
       │  调用 service-registry，得到 canonical project 和 worktree
       ▼
code-kb preflight
       │  branch、HEAD、dirty、索引快照是否匹配
       ▼
code-kb search
       │  精确字段/符号/全文/业务别名检索，返回候选路径
       ▼
Agent 使用 read_file/search_files 读取当前源码
       │  不允许只依据候选摘要回答
       ▼
Agent 追踪调用链、SQL、配置和实际运行入口
       │
       ├── 需要运行事实：调用现有日志/数据库/监控 Skill
       │
       ▼
code-kb verify / record-evidence
       │  将当前 commit 的证据绑定到事实
       ▼
结构化回答：确认事实 / 运行事实 / 推断 / 未确认项
```

### 4.2 关键职责边界

| 层 | 可以做什么 | 不可以做什么 |
|---|---|---|
| Skill | 规定工作流、证据等级、回答格式、禁止事项 | 不能成为代码事实的唯一存储 |
| CLI | 路由、索引、版本检查、检索、失效和证据记录 | 不能替 Agent 直接声称业务结论已确认 |
| SQLite | 保存索引、快照、事实版本和来源引用 | 不保存无来源的确定性事实 |
| 当前源码 | 确认静态实现 | 不能单独证明生产已部署和运行结果 |
| 日志/DB/接口 | 确认运行时事实 | 不能反向替代源码调用链 |
| MCP（未来） | 将 CLI 的结构化能力暴露给其他客户端 | 不复制一套索引和更新逻辑 |

---

## 5. 本地落盘形式

### 5.1 CLI 代码位置

第一期建议把 CLI 做成**独立的本地 Python 项目**，不要放进 Hermes core：

```text
/Users/szld2403178/IdeaProjects/hermes-code-kb/
├── pyproject.toml
├── src/hermes_code_kb/
│   ├── cli.py
│   ├── registry_adapter.py
│   ├── git_snapshot.py
│   ├── indexer.py
│   ├── search.py
│   ├── freshness.py
│   ├── facts.py
│   └── schema.sql
└── tests/
```

命令名：

```bash
code-kb <subcommand>
```

原因：

- 内部项目和日志系统属于用户环境能力，不应进入 Hermes core；
- Hermes 当前贡献规范倾向于“CLI + Skill / 独立 Plugin”，保持 core narrow waist；
- 独立项目可单独安装、升级和测试，不影响 Hermes 对话主循环；
- 未来可以给 Claude Code、Codex、IDE 或其他 Agent 复用。

### 5.2 Skill 位置

第一期 Skill 安装到当前 `feishu` profile 的本地 Skill 目录：

```text
$HERMES_HOME/skills/internal-code-knowledge/SKILL.md
```

在当前环境中，`$HERMES_HOME` 应通过 Hermes 当前 profile 解析，不要在 Skill 中硬编码其他 profile 的路径。

Skill 的职责是：

- 触发条件；
- `code-kb` 命令使用顺序；
- `service-registry` 路由纪律；
- navigation hint 与 source evidence 的区别；
- stale/dirty/commit 不一致时的处理；
- 最终回答模板；
- 修改代码前的重新验证门禁。

现有 `internal-code-investigation` 和 `legacy-project-code-research` 不必被替代。稳定后可以在这两个 Skill 中增加一小段“优先调用 code-kb 做候选定位”，但不把它们的完整领域流程合并到 code-kb 中。

### 5.3 数据位置

默认使用当前 Hermes profile 的数据根：

```text
$HERMES_HOME/code-kb/
├── code-kb.sqlite3
├── snapshots/
├── evidence/
├── exports/
└── logs/
```

第一期只保存本地元数据、路径、符号、摘要和证据引用，不复制整仓库源码。源码仍以当前 worktree 为准。这样可以：

- 减少重复占用空间；
- 避免索引内容脱离当前文件；
- 让当前源码读取成为强制验证环节；
- 不把公司代码上传外部服务。

如果将来需要多 profile 共享，可以增加显式配置：

```text
code_kb.root = /Users/szld2403178/.local/share/hermes-code-kb
```

第一期不默认共享，避免 profile 之间意外读取和修改状态。

---

## 6. 数据模型

第一期用 Python 标准库 `sqlite3` + SQLite FTS5，避免新增向量数据库和大型依赖。

### 6.1 `repository`

记录 canonical 项目，不复制 service-registry 的全部内容：

```text
project_id             service-registry 的 canonical project
repo_path              当前实际 worktree 路径
registry_key           本次路由关键词
default_branch         默认分支
created_at
updated_at
```

`project_id` 必须使用 service-registry 的项目名，而不是中文别名。别名只作为路由输入和检索标签。

### 6.2 `source_snapshot`

每次索引对应一个源码快照：

```text
snapshot_id
project_id
branch
head_commit
is_dirty
remote_status          known / unknown / not_checked
captured_at
index_status           complete / partial / failed
file_count
```

约束：`project_id + branch + head_commit + is_dirty` 组成快照识别条件。不同项目、不同分支、不同 commit 不能共用事实版本。

### 6.3 `source_file`

```text
file_id
snapshot_id
relative_path
blob_hash               git blob hash 或内容 hash
language                java / xml / sql / yaml / json / python / ts / text
size_bytes
mtime
status                  active / deleted / renamed
```

行号只作为当前快照的辅助信息，不作为唯一定位依据。真正的引用必须同时保存相对路径、符号/SQL ID 和 blob/content hash。

### 6.4 `source_symbol`

第一期通过轻量规则提取，不要求完整 AST：

```text
symbol_id
file_id
kind                    class / interface / enum / method / field / mapper_sql / route / config_key
qualified_name
name
start_line
end_line
signature_or_context
```

优先提取：

- Java package、class、interface、enum、方法和字段；
- MyBatis XML namespace、`select/insert/update/delete` 的 id；
- Controller 路由注解；
- Kafka topic、消费者类和 handler 名；
- YAML/JSON/properties 配置 key；
- 常见数据库表名、字段名和 SQL 关键片段。

### 6.5 `source_fts`

SQLite FTS5 虚表，索引以下内容：

```text
project_id
branch
relative_path
symbol_name
qualified_name
content_terms
business_aliases
```

检索顺序：

1. exact field/symbol/SQL ID；
2. path and filename；
3. FTS5 关键词；
4. 业务别名映射；
5. 后续有明确需求时再增加 embedding。

### 6.6 `knowledge_fact`

知识条目不是一段无版本 Markdown，而是版本化事实：

```text
fact_id
project_id
branch
fact_text
fact_type               field_mapping / call_chain / condition / config / runtime
verification_level      L1 / L2 / L3
status                  unverified / source_verified / runtime_verified /
                        stale / superseded / contradicted /
                        broken_reference / partial
verified_snapshot_id
created_at
updated_at
supersedes_fact_id
```

### 6.7 `fact_source`

每个事实至少绑定一个来源引用：

```text
fact_id
snapshot_id
relative_path
symbol_name
start_line
end_line
blob_hash
source_excerpt_hash
role                    definition / query / caller / condition / runtime_evidence
```

没有 `fact_source` 的条目只能是 `unverified`，不能进入 `source_verified`。

### 6.8 `revalidation_queue`

```text
queue_id
project_id
branch
old_snapshot_id
new_snapshot_id
fact_id
reason                  file_changed / symbol_changed / deleted /
                        renamed / branch_changed / forced_update
status                  pending / verified / rejected / blocked
created_at
resolved_at
```

代码变化不直接改写事实，而是产生重新验证任务。

---

## 7. CLI 设计

第一期命令尽量少，所有命令返回人类可读文本；加 `--json` 时返回机器可读结构。命令不直接修改业务仓库。

### 7.1 诊断和项目路由

```bash
code-kb doctor
code-kb route "鲁班"
code-kb route "campaign-atom" --all
code-kb route "鲁班" --branch ECR-7002 --no-fetch
```

输出至少包含：

```json
{
  "type": "route_result",
  "matched": true,
  "project": "hytech-campaign-atom",
  "repo_path": ".../wt/release",
  "resolved_branch": "release",
  "route_source": "service-registry",
  "must_verify_current_source": true
}
```

`route` 默认只调用 `service_registry.py resolve ... --no-fetch`，避免查询时隐式 fetch/reset。

### 7.2 快照状态

```bash
code-kb status hytech-campaign-atom
code-kb status hytech-campaign-atom --branch release --json
```

检查：

- worktree 是否存在；
- 当前 branch；
- 当前 HEAD；
- `git status --porcelain` 是否为空；
- 该项目/分支最后一次索引对应的 HEAD；
- 是否有 stale facts；
- 是否有待重新验证项；
- 远端状态是否未知。

### 7.3 建立或更新索引

```bash
code-kb index hytech-campaign-atom
code-kb index hytech-campaign-atom --branch release
code-kb index hytech-campaign-atom --incremental
code-kb index hytech-campaign-atom --full
```

规则：

- 默认只读当前 worktree，不 fetch；
- 当前没有 worktree 时只报告缺失，不自动创建；
- `--incremental` 使用旧 HEAD 到新 HEAD 的 changed paths；
- 无法可靠计算 diff、检测到 rebase/force update、索引损坏时自动要求 `--full`；
- `--full` 只重建 code-kb 索引，不修改业务仓库。

### 7.4 显式刷新代码并重新索引

```bash
code-kb refresh hytech-campaign-atom
code-kb refresh hytech-campaign-atom --branch ECR-7002
code-kb refresh --all
```

`refresh` 是有本地副作用的命令，第一期必须：

- 明确显示将调用 `service-registry sync/worktree`；
- 显示目标项目、分支、worktree；
- 不在 Agent 未获得明确确认时执行；
- 完成后再次检查 HEAD、dirty 状态并更新索引。

不建议后台默认 refresh。后续如需定时更新，应由用户显式创建 Hermes cron，并使用独立、可审计的命令。

### 7.5 检索候选

```bash
code-kb search "opt_in_type"
code-kb search "参加类型" --project hytech-campaign-atom
code-kb search "selectCampaignListByParams" --project hytech-campaign-atom --branch release
code-kb search "账户维度" --project hytech-campaign-atom --mode alias
```

返回结构必须包含：

```json
{
  "type": "navigation_hint",
  "freshness": "stale|current|unknown",
  "must_verify_current_source": true,
  "project": "hytech-campaign-atom",
  "branch": "release",
  "indexed_head": "abc123",
  "current_head": "def456",
  "is_dirty": false,
  "candidates": [
    {
      "path": "hytech-campaign-flow/src/main/.../CampaignParticipant.java",
      "symbol": "CampaignParticipant.optInType",
      "lines": "30-36",
      "reason": "exact_field",
      "source_hash": "..."
    }
  ]
}
```

即使 `freshness=current`，也必须带 `must_verify_current_source=true`。索引只是导航，不是最终证据。

### 7.6 当前源码验证

```bash
code-kb verify --project hytech-campaign-atom \
  --branch release \
  --path hytech-campaign-flow/src/main/.../CampaignParticipant.java \
  --symbol CampaignParticipant.optInType \
  --fact "opt_in_type 保存活动参与规则"
```

`verify` 执行：

1. 重新读取当前 worktree 的 branch、HEAD、dirty；
2. 重新读取目标文件；
3. 检查路径、符号和内容 hash；
4. 生成来源引用；
5. 只有证据存在时才允许保存为 `source_verified`；
6. 如果 dirty，则记录 `working_tree` 快照，不能伪装成 commit 版本；
7. 如果文件已删除/符号不存在，返回 `broken_reference`，不自动保留旧结论。

### 7.7 查看和重新验证

```bash
code-kb facts list --project hytech-campaign-atom
code-kb facts show FACT_ID
code-kb facts stale --project hytech-campaign-atom
code-kb revalidate --project hytech-campaign-atom
```

`revalidate` 只处理队列，不能把旧文本原样复制为新事实。验证结果可以是：

- 事实仍成立：生成新 snapshot 版本；
- 事实被修改：生成新 fact，旧 fact 标记 `superseded`；
- 事实不成立：旧 fact 标记 `contradicted`；
- 证据不足：保留 `stale` 或 `partial`。

---

## 8. 知识库更新机制

这是本方案的核心，不允许使用“定期把旧 Markdown 重新喂给模型”这种更新方式。

### 8.1 更新触发点

| 触发点 | 默认行为 | 是否 fetch |
|---|---|---:|
| 每次业务代码查询前 | preflight 当前 branch/HEAD/dirty；必要时增量索引 | 否 |
| 手工执行 `code-kb index` | 索引当前 worktree | 否 |
| 手工执行 `code-kb refresh` | 调用 service-registry 刷新代码，再索引 | 是，需确认 |
| 分支切换或 worktree 变化 | 立即创建新 snapshot，旧事实降级 | 否 |
| 文件内容变化 | 更新文件/符号索引，标记相关事实 stale | 否 |
| 定时任务 | 第一阶段不默认启用 | 用户显式配置后才可 |
| 解析器或 schema 升级 | 触发全量重建索引，事实重新做引用检查 | 否 |

### 8.2 查询前的新鲜度检查

每次排查必须比较：

```text
知识库 snapshot：project + branch + head_commit + dirty
当前 worktree：project + branch + HEAD + dirty
```

处理规则：

| 情况 | 处理 |
|---|---|
| branch、HEAD、dirty 全一致 | 可用索引快速定位，但仍需读取当前源码 |
| HEAD 不一致 | 索引降级为 hint；增量更新或重新索引；事实标记 stale |
| branch 不一致 | 使用独立分支命名空间；不能复用另一个分支的最终结论 |
| dirty 从 false 变 true | 当前本地源码优先；所有结论标记为 working-tree evidence |
| worktree 路径变化 | 重新确认项目身份和 branch，不能只按路径复用 |
| 无法确定当前 HEAD | 不允许 source_verified，只能返回未验证线索 |
| 远端未 fetch | `remote_status=unknown`；只能说“当前本地 worktree”，不能说“远端最新代码” |

### 8.3 增量更新流程

正常情况下：

```text
旧 snapshot: commit A
当前 snapshot: commit B
       │
       ▼
git diff --name-status A B
       │
       ├── M：重新解析文件、符号和 FTS 内容
       ├── A：新增文件和符号
       ├── D：删除文件并标记来源失效
       └── R：迁移路径但重新验证符号
       │
       ▼
根据 fact_source 找受影响事实
       │
       ▼
插入 revalidation_queue
       │
       ▼
新查询只使用新索引导航，旧事实保持 stale
```

### 8.4 必须全量重建的情况

出现以下情况不能盲目增量：

- branch 被强制重写或 rebase，旧 commit 不是新 commit 的祖先；
- 无法读取旧 snapshot；
- 索引 schema 或解析器版本变化；
- 文件 rename 检测不可靠；
- 符号解析结果和文件内容不一致；
- 发现索引中的路径在当前 worktree 大面积不存在；
- 用户显式执行 `--full`。

全量重建只重建索引，不删除事实历史。所有旧事实重新检查 source reference；无法匹配的标记 `broken_reference` 或 `stale`。

### 8.5 事实更新规则

知识事实禁止直接覆盖，采用不可变版本：

```text
fact-v1 @ commit-A  ──代码变化──> stale
       │
       └──重新读取当前源码──> fact-v2 @ commit-B
                              │
                              ├──仍成立：source_verified
                              ├──实现变化：supersedes fact-v1
                              └──不成立：contradicted
```

旧事实保留的价值：

- 能解释为什么过去的排查结论不同；
- 能定位哪个 commit 引入行为变化；
- 能审计知识库是否被错误更新；
- 能支持历史版本和生产部署版本对比。

### 8.6 远端更新和本地更新必须区分

`git fetch` 是获取远端新状态，`git reset/worktree` 是改变本地检索代码。两者都可能影响本地状态，不能隐式发生。

因此：

```text
query/search/index：默认只看当前本地 worktree
refresh：明确刷新指定项目/分支后再索引
remote_unknown：不能宣称本地代码是远端最新
```

如果后续使用 Hermes cron 做每日刷新，任务必须明确：

- 目标项目/分支；
- 是否允许 fetch/reset；
- 失败通知；
- 刷新后只报告变化和 stale facts，不直接自动给业务结论。

---

## 9. 如何防止知识库替代实际代码

### 9.1 证据等级

| 等级 | 来源 | 能回答什么 |
|---|---|---|
| L0 | 模型推测 | 只能作为假设，不能作为结论 |
| L1 | 旧知识条目、历史调查总结、检索摘要 | 只能导航，必须验证 |
| L2 | 当前 branch/worktree 的源码、SQL、配置 | 可确认当前静态实现 |
| L3 | 当前运行日志、DB、接口响应、部署镜像/commit | 可确认实际运行事实 |

最终回答不能把 L1 写成 L2，也不能把 L2 写成 L3。

### 9.2 CLI 硬门禁

知识检索接口必须返回结构化的：

```json
{
  "type": "navigation_hint",
  "must_verify_current_source": true
}
```

知识库工具不返回“最终答案”字段，不返回没有来源的确定性业务判断。

`verify` 必须要求：

- 当前项目；
- 当前分支；
- 当前 HEAD 或 dirty 状态；
- 当前文件路径；
- 符号或明确行范围；
- 内容/源码 hash；
- 事实类型和验证等级。

### 9.3 Skill 硬规则

`internal-code-knowledge` Skill 必须写明：

1. 先 route，再 preflight，再 search；
2. search 输出只能作为候选文件列表；
3. 必须使用当前 `read_file/search_files` 读取源码；
4. 当前 HEAD 不一致、dirty、路径失效时，不可直接引用旧条目；
5. 涉及“生产是否执行/页面是否展示/数据是否已写入”时，必须继续查日志、DB、接口或部署信息；
6. 回答必须区分“当前源码确认”“运行证据确认”“知识库历史提示”“未确认推断”；
7. 修改代码前必须重新检查 branch、HEAD、dirty 和目标上下文；
8. 不能因为知识库无记录就断言源码不存在；
9. 不能因为知识库有记录就断言当前代码仍相同。

### 9.4 最终回答模板

内部代码问题建议固定输出：

```markdown
## 结论
- 当前代码确认：……
- 当前运行行为：……（如有 L3 证据）

## 当前源码依据
- `project/branch@commit`
- `path/to/File.java:line-line`
- `Class.method` / `Mapper.sqlId`
- 这里实际做了什么判断

## 知识库作用
- 仅用于提前定位了哪些文件或符号
- 是否与当前 commit 一致

## 尚未确认
- 生产部署版本是否与当前源码一致
- 运行日志/DB/接口是否缺少
```

---

## 10. 多项目、多分支和跨服务策略

### 10.1 项目身份

所有内部项目必须使用 service-registry 返回的 canonical `project` 作为主键：

```text
project_id = hytech-campaign-atom
```

中文名、品牌名、业务简称只作为 alias/query，不作为数据库主键。这样可以避免：

- “鲁班”“campaign atom”“活动平台”被建成三个项目；
- 同一项目不同别名互相产生重复索引；
- 多项目同名字段互相覆盖。

### 10.2 分支隔离

索引和事实至少按以下命名空间隔离：

```text
(project_id, branch, head_commit, dirty)
```

例如：

```text
hytech-campaign-atom / release / commit-A
hytech-campaign-atom / ECR-7002 / commit-B
campaign-platform-job / release / commit-C
```

不能用 `release` 的结论回答 `ECR-7002` 的行为，除非重新读取该分支源码并明确说明证据来自哪个分支。

### 10.3 多项目检索

默认策略：

1. 先用 service-registry route；
2. 唯一命中则进入项目范围；
3. 多命中时返回候选项目，不能把结果混在一起；
4. 用户指定项目后才跨文件/跨服务追踪；
5. 跨项目调用只在源码、接口、消息 topic、日志或配置中有直接证据时建立 edge；
6. “两个项目有同名类/字段”不等于两者存在调用关系。

### 10.4 代码和运行环境分离

同一项目可能同时存在：

```text
本地 release worktree
test ECR 分支
生产部署镜像
```

因此事实中要区分：

```text
source_verified：当前源码实现
runtime_verified：指定环境在指定时间的运行事实
```

“当前 release 源码有这个判断”不等于“生产当前页面一定按这个判断执行”。

---

## 11. 与现有 Skill 的落地关系

### 11.1 新增 Skill：`internal-code-knowledge`

第一期新增一个轻量本地 Skill，专门描述 code-kb CLI 的使用和验证门禁。它不重复完整的领域排查逻辑。

建议触发描述：

```yaml
name: internal-code-knowledge
description: Use when investigating internal code across multiple projects and branches; use code-kb for fast, version-aware candidate discovery, then verify every conclusion against the current worktree source and runtime evidence.
```

Skill 章节：

1. 适用场景和不适用场景；
2. service-registry route 规则；
3. `code-kb status/index/search/verify` 命令；
4. stale、dirty、branch mismatch 的处理；
5. Java/XML/SQL/配置的优先检索顺序；
6. L1/L2/L3 证据等级；
7. 修改前重新验证；
8. 最终回答模板；
9. 常见错误和检查清单。

### 11.2 现有 `internal-code-investigation`

不替换。后续只增加一个“快速定位”小节：

```text
项目路由完成后：
1. code-kb status
2. code-kb search 业务词/字段/SQL ID
3. 读取候选源码
4. 按原有调查流程继续 DTO → 持久化 → 运行条件 → 结果
```

该 Skill 仍负责完整调用链和业务判断。

### 11.3 现有 `legacy-project-code-research`

保留其老项目特殊规则，例如：

- 旧项目通过 service-registry 路由；
- 截图文案不一定直接存在于后端源码；
- 配置保存、通用框架和运行路径要分开；
- 页面候选过滤和消费链路不能混为一谈。

code-kb 只负责更快找到候选文件，不能覆盖这些领域纪律。

### 11.4 `code-wiki`

用途改为：

```text
在一次完整源码调查完成后，按已验证证据生成可读的 Markdown Wiki/架构图。
```

它的输出可以引用 code-kb 的 evidence，但不应反向成为当前代码事实源。代码变化后，Wiki 也应根据 snapshot/commit 重新生成，而不是继续当作最新文档。

### 11.5 `gitnexus-explorer`

用途改为：

- 大项目调用图可视化；
- 需要浏览类关系和执行流时辅助探索；
- 生成架构图前做交互式检查。

它输出的图节点和路径仍需回到当前源码验证，不自动提升为 `source_verified`。

### 11.6 Memory 和 Skill 的边界

| 内容 | 放置位置 |
|---|---|
| 用户偏好，如“回答要结构化” | Memory |
| 稳定流程，如“先用 service-registry 再查代码” | Skill |
| 某项目当前字段判断 | code-kb fact，绑定 commit |
| 某次生产接口响应 | 运行证据 artifact，绑定时间/环境 |
| 一次任务进度 | 当前会话/todo，不写 Memory |

---

## 12. 第一阶段实施步骤

### Phase 0：先固定协议，不写复杂代码

产物：

- `code-kb` 命令和 JSON 输出协议；
- SQLite schema；
- evidence/freshness/status 枚举；
- `internal-code-knowledge` Skill 草稿；
- 本文档作为设计基线。

验收：能明确区分 route、index、search、verify、refresh 的权限和职责。

### Phase 1：CLI 最小可用版本

实现顺序：

1. `doctor`：检查 Python、git、SQLite FTS5、service-registry 脚本；
2. `route`：适配现有 service-registry，默认 `--no-fetch`；
3. `status`：获取 branch、HEAD、dirty 和索引状态；
4. `index`：扫描 Java/XML/SQL/YAML/JSON/properties 和通用文本；
5. `search`：exact + FTS5 + 项目/分支过滤；
6. `verify`：绑定当前文件、符号、hash 和 commit；
7. `facts`：查看事实、stale 和来源；
8. `refresh`：显式确认后调用 service-registry sync/worktree，再索引；
9. `revalidate`：处理失效队列。

验收：可以在两个临时 Git 项目中分别建立索引，修改其中一个文件后只让对应项目的事实失效。

### Phase 2：接入当前 Skill

1. 安装 `internal-code-knowledge` 到当前 profile；
2. patch `internal-code-investigation` 和 `legacy-project-code-research` 的快速定位段；
3. 不改 Hermes core、不新增工具 schema；
4. 让 Agent 通过现有 terminal/file 调用 CLI，并继续用 read_file 读源码；
5. 新会话加载 Skill 后做一次鲁班/活动类问题演练。

验收：对同一问题，回答中同时出现当前源码路径、commit、方法/SQL ID 和证据等级；仅有知识库提示时不能直接下最终结论。

### Phase 3：完善更新和质量门禁

1. 增量 diff；
2. 文件删除/重命名检测；
3. branch/rebase/full rebuild；
4. stale facts 和 revalidation queue；
5. schema/parser version；
6. 只允许带 source reference 的事实进入 verified；
7. 增加多项目、多分支和 dirty worktree 测试。

验收：覆盖代码新增、修改、删除、重命名、分支切换、未提交修改、索引过期和错误项目路由。

### Phase 4：按需要增加 MCP

只有出现以下实际需求时才做：

- 希望 Claude Code、Codex、IDE 或其他 MCP Host 直接查询；
- 不希望每个客户端都执行本地 CLI；
- 需要统一 JSON schema 和权限边界。

MCP 形态：

```text
mcp-code-kb server
       │
       └── 调用同一个 hermes-code-kb Python service
```

MCP 只暴露：

- `route_project`
- `get_freshness`
- `search_candidates`
- `get_fact`
- `get_revalidation_status`

MCP 不直接提供任意写文件、任意执行 git、任意写事实的能力。`refresh` 和 `record_verified_fact` 仍需显式安全门禁。

---

## 13. 测试和验收标准

### 13.1 功能验收

- [ ] 中文别名可以通过 service-registry 路由到 canonical project。
- [ ] 未命中时不猜项目，返回候选项目或明确未命中。
- [ ] 同一个项目的 `release` 和 ECR 分支有独立索引。
- [ ] 两个项目的同名字段不会混在一个事实中。
- [ ] 搜索结果包含 path、symbol/SQL ID、snapshot、HEAD 和 freshness。
- [ ] 搜索结果明确 `must_verify_current_source=true`。
- [ ] 当前源码验证后才可生成 `source_verified`。
- [ ] 没有 source reference 的事实不能成为 verified。
- [ ] 文件修改后相关事实自动进入 stale/revalidation queue。
- [ ] 文件删除或重命名后旧引用不会继续作为当前证据。
- [ ] dirty worktree 的事实不会伪装成 commit 版本。
- [ ] rebase/force update 会触发全量重建或明确阻断。
- [ ] `refresh` 不会在未确认时隐式 fetch/reset。

### 13.2 与 Hermes 的集成验收

- [ ] 不修改 Hermes agent loop、core tool schema 或默认 toolset。
- [ ] 当前 Feishu profile 可以加载新 Skill。
- [ ] Skill 只指导流程，不将大段项目事实注入每轮上下文。
- [ ] CLI 不依赖当前对话状态，可以独立运行。
- [ ] CLI 可以在没有 LLM 的情况下完成 route/status/index/search。
- [ ] code-kb 数据不写入业务仓库和 service-registry 镜像。
- [ ] 当前会话重启后仍能读取 SQLite 索引，但每次仍做 freshness check。

### 13.3 最小端到端演练

以活动平台类问题为例：

```bash
code-kb route "鲁班" --no-fetch
code-kb status hytech-campaign-atom --branch release
code-kb index hytech-campaign-atom --branch release
code-kb search "opt_in_type" --project hytech-campaign-atom --branch release
```

然后由 Agent：

1. 使用返回的候选路径读取当前 `CampaignParticipant` 和 Mapper/调用方；
2. 记录当前 branch、HEAD、dirty；
3. 区分“字段保存”“查询映射”“后续判断”“运行链路”；
4. 需要生产事实时调用日志/DB/接口 Skill；
5. 只有证据完整后才 `code-kb verify`；
6. 输出确认事实和未确认部分。

---

## 14. 风险和取舍

### 14.1 不做向量库的取舍

优点：

- 精确字段和方法名召回更可靠；
- 不需要上传公司代码；
- 依赖少，部署简单；
- SQLite 可以直接备份和检查；
- 方便绑定 commit、文件和行号。

缺点：

- 中文业务词与代码词的映射需要 alias/fact 维护；
- 对完全不同表达的自然语言召回不如 embedding；
- 需要 Skill 或 Agent 先做业务词拆解。

结论：第一期先使用 exact + FTS5 + service-registry alias；真实使用证明召回不足后再增加本地 embedding，不提前引入复杂基础设施。

### 14.2 行号会变化

不能只存行号。必须同时存：

```text
relative_path + symbol/SQL ID + blob/content hash + line range
```

行号只用于快速展示，hash 和符号用于判断引用是否仍有效。

### 14.3 “知识库更新了”不等于“知识已经验证”

更新索引和更新事实是两个动作：

```text
代码变更 → 索引更新 → 事实 stale → 人/Agent 重新读取源码 → 新事实 verified
```

自动索引不能自动把旧事实标记为仍正确。

### 14.4 生产行为风险

源码索引只能回答当前源码实现。生产行为还取决于：

- 实际部署 commit/image SHA；
- 配置中心值；
- 数据状态；
- 消息是否消费；
- 任务是否执行；
- 页面接口返回；
- 时间和时区。

因此 code-kb 不取代现有 `bit-log-search`、`opensearch-query`、`dynatrace-data`、Archery 等工具。

### 14.5 数据安全

- 默认本地 SQLite；
- 不默认发送源码和索引到外部模型/向量服务；
- 不把 token、密码、生产敏感数据写入 evidence；
- evidence 只保存必要的路径、符号、hash 和短片段 hash；
- 需要展示源码片段时由当前 `read_file` 临时读取；
- 未来 MCP/远程访问必须增加项目和路径 allowlist。

---

## 15. 推荐的最终目录和职责

第一期完成后，整体形态应类似：

```text
/Users/szld2403178/IdeaProjects/
├── hermes-agent/
│   └── .claude/docs/
│       └── internal-code-knowledge-kb-solution.md
├── hermes-code-kb/                    # 独立 CLI，不进入 Hermes core
│   ├── pyproject.toml
│   ├── src/hermes_code_kb/
│   └── tests/
└── ...业务项目（由 service-registry 管理镜像，不由 code-kb 修改）

$HERMES_HOME/
├── skills/
│   ├── internal-code-knowledge/       # 新增本地 Skill
│   ├── internal-code-investigation/   # 现有 Skill，保留并补快速定位段
│   └── legacy-project-code-research/  # 现有 Skill，保留老项目规则
└── code-kb/
    ├── code-kb.sqlite3
    ├── snapshots/
    ├── evidence/
    └── logs/
```

### 最终一句话

> **第一期落地为“独立 `code-kb` CLI + 本地 `internal-code-knowledge` Skill + SQLite/FTS5 版本化索引”；service-registry 负责项目路由，当前源码负责最终定案，日志/DB/接口负责运行事实，MCP 仅作为后续复用接口，不作为第一期核心。**

这套边界既能通过索引减少找代码时间，又能从机制上阻止 Agent 把过期知识库当成当前代码或生产事实。
