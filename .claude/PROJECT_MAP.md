# Hermes Agent 项目 Map

> 用途：改代码前先读本文件，按需渐进加载上下文，避免一上来扫全仓库。
> 最后校准：2026-09-11，分支 `feishu-cam-del`（HEAD `7655fa7d0`）。

## 1. 当前项目形态

本仓库是 Hermes Agent 的内部分支，已按"数字员工"落地方向做过一轮裁剪，现在只剩**两个交付面**：

1. **飞书 Gateway**（主入口）：`python ./hermes -p feishu gateway run` 常驻，通过 `plugins/platforms/feishu/adapter.py` 收发飞书消息，真实业务能力放在 `~/.hermes/profiles/feishu/skills` 与 `~/.hermes/profiles/feishu/scripts`。
2. **Campaign AI Web**（`campagin-ai-web/`，目录名含历史拼写错误，勿改）：Ant Design + React 19 的 Web 工作台，经 Vite dev proxy 打到同一个 gateway 进程里的 `api_server` 平台（`127.0.0.1:8642`）。

产品目标文档：`docs/digital-employee-platform.md`。

**已从仓库删除、不要再引用**：`ui-tui/`、`web/`、`apps/desktop/`、`apps/shared/`、`website/`、`optional-skills/`、`optional-mcps/`、`gateway/platforms/ADDING_A_PLATFORM.md`。
`hermes_cli/web_dist/` 只是旧 dashboard 的构建产物，源码已不在仓库内，不要试图改它。

## 2. 先读顺序

1. 读本文件，判断落在"飞书链路"还是"Web 链路"。
2. 只读对应链路的入口文件和最近相关测试。
3. 再读同目录 2-3 个相邻实现，确认输入输出协议、配置来源和错误处理风格。
4. 最后才按符号名 grep 精准扩展，不做全仓库泛扫。
5. 涉及飞书/多用户/启动/技能治理的背景，优先查 `.claude/docs/`（见 §8），再查 hermes-mcp 文档。

## 3. 顶层骨架

| 路径 | 职责 | 优先入口 |
| --- | --- | --- |
| `hermes` | 本地源码运行包装脚本 | `hermes_cli.main:main` |
| `hermes_cli/` | Python CLI、配置、profile、gateway/cron/mcp/model/doctor 等命令面 | `hermes_cli/main.py`, `hermes_cli/subcommands/`, `hermes_cli/profiles.py` |
| `run_agent.py` | Agent 主类与运行时聚合层，保留大量测试 monkeypatch 兼容导出 | `AIAgent`, `main` |
| `agent/` | Agent loop、模型适配、上下文、记忆、技能、压缩、工具调度辅助 | `agent/conversation_loop.py`, `agent/prompt_builder.py`, `agent/tool_dispatch_helpers.py` |
| `model_tools.py` | 工具注册发现与工具调用分发窄腰 | `get_tool_definitions`, `handle_function_call` |
| `toolsets.py` | toolset 分组与平台默认工具集 | `hermes-feishu`, `hermes-api-server`, `hermes-gateway`, `hermes-cron`, `hermes-cli` |
| `tools/` | 内置工具实现（93 项），自注册到 `tools.registry` | `tools/registry.py`, `tools/feishu_doc_tool.py`, `tools/feishu_drive_tool.py`, `tools/send_message_tool.py`, `tools/cronjob_tools.py`, `tools/skills_sync.py` |
| `gateway/` | 网关运行时：配置、鉴权、会话、投递、slash 命令、Web 登录态 | `gateway/config.py`, `gateway/run.py`, `gateway/session.py`, `gateway/web_auth.py` |
| `gateway/platforms/` | 内置平台：只剩 `api_server.py`（HTTP/SSE 面）+ `base.py` + `qqbot/` | `gateway/platforms/api_server.py` |
| `plugins/platforms/` | 插件化平台适配器，飞书在这里 | `plugins/platforms/feishu/adapter.py`, `plugins/platforms/feishu/plugin.yaml` |
| `plugins/` | 其他打包插件（memory、kanban、observability、model-providers…） | `plugins/*/plugin.yaml` |
| `campagin-ai-web/` | Campaign AI Web 前端（Vite + React 19 + antd 6） | `campagin-ai-web/src/App.tsx`, `campagin-ai-web/vite.config.ts` |
| `config/campaign-users.json` | Web 账号与飞书身份绑定的落盘用户表（未入 git，含口令 scrypt 摘要） | 只经 `gateway/web_auth.py` 读写 |
| `cron/` | 内置 cron 调度、任务与执行记录 | `cron/scheduler.py`, `cron/jobs.py` |
| `tui_gateway/` | Python 后端与本地 TUI 的桥接服务（TUI 前端已删，服务仍在） | `tui_gateway/server.py` |
| `locales/` | i18n 语料（16 种，含 `zh.yaml` / `zh-hant.yaml` / `en.yaml`），以 data-files 方式打包 | `locales/*.yaml` |
| `providers/` | Provider 抽象与基础类型 | `providers/base.py` |
| `skills/` | 仓库内置 skills 模板；**feishu profile 已用 `.no-bundled-skills` opt-out，不会被 seed 进去** | `*/SKILL.md` |
| `scripts/` | 安装、发布、CI、诊断脚本 | `scripts/install.sh`, `scripts/run_tests.sh`, `scripts/ci/` |
| `tests/` | Python pytest（按子系统分目录） | `tests/gateway/`, `tests/tools/`, `tests/hermes_cli/` |
| `tests-js/` | 唯一的 npm workspace，几个残留 TS 单测 | `tests-js/package.json` |
| `diagrams/` | 架构图产出快照（时间戳目录） | `diagrams/<ts>/diagram.json` |
| `docs/` | 仅剩产品定位文档与 superpowers | `docs/digital-employee-platform.md` |

## 4. 链路一：飞书 Gateway

```
飞书开放平台 ──WebSocket/webhook──> plugins/platforms/feishu/adapter.py
                                        │
                                   gateway/run.py（会话、投递、授权、slash）
                                        │
                                run_agent.py / agent/conversation_loop.py
                                        │
                            model_tools.py → tools/ + MCP + profile skills
```

- 启动：`python ./hermes -p feishu gateway run`（Python 3.11，venv `~/.venvs/hermes`）。profile 包装脚本 `~/.local/bin/feishu` 等价于 `hermes -p feishu`。
- 平台注册：飞书是**插件平台**，元数据在 `plugins/platforms/feishu/plugin.yaml`，运行时经 `gateway/platform_registry.py` 注入；`hermes_cli/platforms.py` 的静态 `PLATFORMS` 里列的是 `cli` / `feishu` / `api_server` / `cron` 四个键与各自默认 toolset。
- 凭证与开关全部走 profile `.env`（键名见 §6），不要往仓库里写。
- 群聊靠 `FEISHU_REQUIRE_MENTION` / `FEISHU_GROUP_POLICY` 收口，私聊靠 `FEISHU_ALLOWED_USERS` 或配对审批。
- 飞书专属能力代码：`adapter.py`（主体，含卡片、线程、媒体）、`feishu_comment.py` + `feishu_comment_rules.py`（云文档评论事件）、`feishu_meeting_invite.py`。
- 测试：`tests/gateway/test_feishu.py`、`tests/gateway/feishu_helpers.py`。

## 5. 链路二：Campaign AI Web

### 5.1 前端结构（`campagin-ai-web/`）

- 入口 `src/main.tsx` → `src/App.tsx`：`AuthProvider` → 路由守卫（`src/pages/auth/RouteGuards.tsx`）→ `SessionProvider` → `AppShell`，业务页全部 `lazy` 分包。
- 侧栏七项（`src/layout/navItems.ts`）：对话首页 `/`、能力管理 `/capability`、服务可观测 `/observe/:tab?`、知识库 `/knowledge`(+`/knowledge/:collection/:docId`)、定时任务 `/tasks`、告警管理 `/alerts`、设置 `/settings/:tab?`。
- 数据层只经 `src/api/*`，页面不直接 import `src/mock`。**当前真假混合，改前先看清**：
  - 已接真实后端：`api/agent.ts`（runs / sessions / 审批 / 停止）、`api/sse.ts`（`/v1/runs/{id}/events`）、`api/auth.ts`。
  - 仍是 mock（`mockGet` + `src/mock/*`）：`alerts`、`capability`、`chat`、`knowledge`、`observe`、`settings`、`tasks`。
  - `api/client.ts` 是这层的公共壳（`delay` / `clone` / `mockGet` / `ApiError`）。
- 对话页最重的两块：`src/hooks/useAgentRun.ts`（SSE 状态机、审批、pending runs）与 `src/pages/chat/`（Composer、SlashMenu、ToolTable、TurnDetail、ApprovalModal、CapabilityDrawer）。Markdown/Mermaid/KaTeX 渲染在 `src/components/Markdown.tsx`、`MermaidBlock.tsx`。
- 主题：`src/theme/antdTheme.ts` + `src/theme/global.css`。

### 5.2 dev server 与代理（`campagin-ai-web/vite.config.ts`）

- dev 端口 `5273`，代理目标 `AGENT_API_TARGET`（默认 `http://127.0.0.1:8642`）。
- `/auth`、`/api`、`/v1` 全部 rewrite 成 `/web<path>` 再转发。
- `API_SERVER_KEY` 由 dev server 每次请求从 `~/.hermes/profiles/feishu/.env` 读出、以 `Authorization: Bearer` 注入；**绝不能用 `VITE_*` 暴露给浏览器**（该 key 等价远程代码执行）。
- `changeOrigin: false` 是刻意的：`api_server` 的 `_origin_allowed` 需要看到原始 `Origin`（`http://localhost:5273`），配套 `API_SERVER_CORS_ORIGINS`。
- 代理会摘掉 `accept-encoding`，否则 SSE 被中间层攒成一整块。
- `server.fs.deny` 屏蔽 `campaign-users.json`；另有 `reject-unsafe-request-path` 插件拦 `..`/编码穿越。

### 5.3 后端：`gateway/platforms/api_server.py`

路由表集中在 `_routes()`（约 `api_server.py:1660-1725`）：

- OpenAI 兼容：`/v1/chat/completions`、`/v1/responses[/{id}]`、`/v1/models`、`/v1/capabilities`。
- 会话：`GET/POST /api/sessions`、`GET/PATCH/DELETE /api/sessions/{id}`、`/messages`、`/fork`、`/chat[/stream]`。
- 运行：`POST /v1/runs`、`GET /v1/runs/{id}`、`GET /v1/runs/{id}/events`(SSE)、`POST /v1/runs/{id}/approval`、`POST /v1/runs/{id}/stop`。
- 定时任务：`/api/jobs` 全套（list/create/get/patch/delete/pause/resume/run）。
- 平台事件入口 `POST /api/platforms/{platform}/events`（由目标适配器自己的验签鉴权，**不是** `API_SERVER_KEY`）；`POST /api/cron/fire` 用 NAS 下发的 JWT。
- 多 profile 前缀：`/p/<profile>/v1/...`。

**关键机制**：循环把每个 `/api/*`、`/v1/*` 路由再注册一份 `/web` 前缀版本，套上 `_web_protected_handler` —— 即浏览器侧统一走 `/web/...`，用 Cookie 会话鉴权；机器侧走裸路径，用 `API_SERVER_KEY`。前端 proxy 的 rewrite 就是为这条线服务的。

### 5.4 Web 鉴权与飞书绑定（`gateway/web_auth.py`）

- 服务类 `WebAuthService`，由 `api_server._web_auth()` 惰性构造，两个落盘位置：
  - 用户表：`<repo>/config/campaign-users.json`（`Path(__file__).parents[2] / "config" / ...`）
  - 运行态（待绑定码、会话）：`get_hermes_home() / "web-auth-runtime.json"`
- 口令：scrypt（n=131072, r=8, p=1, dklen=32），最小长度 6；邮箱正则校验。
- 会话 TTL 8 小时，Cookie 名 `hermes_web_session`，另发 CSRF token；绑定码 16 位 Crockford 风格字母表、TTL 5 分钟。
- 路由：`POST /web/auth/register`、`POST /web/auth/login`、`GET /web/auth/me`、`POST /web/auth/logout`。
- 注册闭环：网页注册拿到绑定码 → 在飞书私聊对机器人发 `/bind <16位码>`（`plugins/platforms/feishu/adapter.py` 的 `_WEB_BIND_COMMAND_RE`，约 `adapter.py:301`）→ 适配器取 `gateway_runner.adapters[Platform.API_SERVER].web_auth_service`，先过 `_is_user_authorized(source)` 再 `consume_feishu_binding(code, union_id, user_id, open_id)` → 写回 `campaign-users.json` 的 `feishu` 身份（`union_id` 为主，`user_id` / `open_id` 作 fallback）。
- 测试：`tests/gateway/test_web_auth.py`、`tests/gateway/test_feishu.py`、`tests/gateway/test_api_server*.py`。

## 6. feishu profile 运行时（`~/.hermes/profiles/feishu/`）

仓库只有代码，**业务能力与配置都在 profile 里**，改行为前先确认是改仓库还是改 profile。

- `config.yaml`：模型 `custom:lunora`（`transport: codex_responses`，默认 `gpt-5.6-terra`，`context_length` 342000）；`toolsets: [hermes-gateway]`；`cron.user_isolation: true`（按创建者 user_id 隔离 cron，CLI/调度器无 user_id 视为管理员）；`agent.max_turns: 90`、`gateway_timeout: 1800`、`reasoning_effort: max`；`approvals.mode: manual` 且 deny 了 `git push` / `git commit` / `rm -rf` / `curl|sh` 等；`display.language: zh`；`mcp_servers` 里有 `mcp-atlassian`（只读）。
- `.env` 键名（值不要读进上下文）：`API_SERVER_ENABLED/HOST/PORT/KEY/CORS_ORIGINS`、`FEISHU_APP_ID/APP_SECRET/DOMAIN/CONNECTION_MODE/GROUP_POLICY/REQUIRE_MENTION/ALLOWED_USERS/ALLOW_ALL_USERS`、`HERMES_FEISHU_WS_IDLE_MAX_SECONDS`、`LUNORA_API_KEY`、`AUTOMATION_VENV`、以及 Dynatrace / OpenSearch / Jira / Confluence / SSO 的账号密钥。
- `skills/`：`.no-bundled-skills` opt-out 掉仓库内置 skills，自建业务技能分类为
  - `tools/`：`archery-query`、`bit-log-search`、`opensearch-query`、`dynatrace-data`、`grafana-kafka-metrics`、`service-registry`、`sso-bit-login`、`code-wiki`、`log-business-metrics-analysis`
  - `observability/`：`batch-liteflow-log-analysis`、`kafka-consumer-log-correlation`、`metrics-query-tooling`
  - `orchestration/`：`excalibur-investigation`、`kafka-observability-maintenance`、`luban-campaign-investigation`、`rapid-business-triage`、`service-observability`
  - `knowledge/`：`internal-code-knowledge`、`code-map-release-sync`、`documentation-evidence-review`、`release-wiki-draft-only`
  - `security/third-party-authorization-risk`
  - 其余（`creative/`、`productivity/`、`software-development/`、`autonomous-ai-agents/` …）来自 skills hub。
- `scripts/`：技能背后的 Python 实现 —— `bit_log_search.py`、`opensearch_query.py`、`dynatrace_query.py`、`archery_query.py`、`grafana_kafka_metrics.py`、`grafana_kafka_auth.py`、`service_registry.py`、`sso_bit_login.py`、`code_map.py`、`pii_masker.py`。SSO/日志类脚本经 `.env` 的 `AUTOMATION_VENV` 指到 `~/.venvs/hermes`。
- 其余：`SOUL.md`（人格）、`memories/`、`state.db` / `projects.db` / `kanban.db` / `response_store.db`、`logs/`、`web-auth-runtime.json`、`gateway.pid` / `gateway.lock`。
- 同机还有 `~/.hermes/profiles/weixin/`（个人微信 profile，另一套 skills）。`~/.hermes/` 默认 profile 仅作回滚基线。

## 7. 配置、依赖与打包

- Python 包配置：`pyproject.toml`；Python `>=3.11,<3.14`（本机 3.11：`/opt/homebrew/bin/python3.11`，venv `~/.venvs/hermes`）。
- `[project.scripts]`：`hermes = hermes_cli.main:main`、`hermes-agent = run_agent:main`、`hermes-acp = acp_adapter.entry:main`。
- 包发现（`pyproject.toml:278`）：`agent`, `tools`, `hermes_cli`, `gateway`, `tui_gateway`, `cron`, `acp_adapter`, `plugins`, `providers`。
- `locales/` 是裸数据目录，靠 `[tool.setuptools.data-files]` + `MANIFEST.in graft locales` 进包，不要改成 package-data。
- 前端：**根 `package.json` 的 workspaces 只剩 `tests-js`**，`campagin-ai-web/` 不在 workspace 内，要 `cd campagin-ai-web` 单独 `npm install`。Node `>=20`。

## 8. 参考文档（`.claude/docs/`）

| 文档 | 用途 |
| --- | --- |
| `hermes-gateway-feishu-wechat-startup.md` | 飞书/微信双 profile 启动手册（运行架构、Python 环境、凭证、安全原则、模型中转站） |
| `multi-user-identity-and-credential-isolation.md` | 多用户身份与凭证隔离设计，Web 绑定与 cron 隔离的上游依据 |
| `project-startup-and-custom-development-sop.md` | 项目启动与自定义开发 SOP |
| `skills-tools-configuration-guide.md` | skills / tools 配置指南 |
| `feishu-skill-inventory-and-cleanup.md` | 飞书 profile 技能盘点与清理 |
| `internal-code-knowledge-kb-solution.md` | 内部代码知识库方案（对应 `knowledge/internal-code-knowledge`） |

## 9. 常用验证命令

按变更范围最小化运行：

| 变更范围 | 优先命令 |
| --- | --- |
| Python 单测 | `uv run pytest tests/<target>.py` |
| 飞书 / Web 鉴权 | `uv run pytest tests/gateway/test_feishu.py tests/gateway/test_web_auth.py` |
| api_server | `uv run pytest tests/gateway/test_api_server.py` |
| Python 全量 | `uv run pytest`（`addopts = -m 'not integration'`） |
| Python lint | `uv run ruff check <paths>` |
| Python type | `uv run ty check` |
| Campaign Web 静态检查 | `cd campagin-ai-web && npm run check`（= `tsc -p tsconfig.app.json --noEmit` + `eslint .`） |
| Campaign Web 构建 | `cd campagin-ai-web && npm run build` |
| Campaign Web 本地跑 | 先 `python ./hermes -p feishu gateway run`，再 `cd campagin-ai-web && npm run dev`（`http://localhost:5273`） |
| 残留 JS workspace | `npm run check`（根，仅 `tests-js`） |

不要为小改动默认跑全量；先跑最贴近变更的测试，再按风险扩大。

## 10. 渐进式定位指南

| 要改什么 | 先看 | 再看 |
| --- | --- | --- |
| 飞书消息行为 | `plugins/platforms/feishu/adapter.py` | `plugins/platforms/feishu/plugin.yaml`, `tests/gateway/test_feishu.py` |
| 飞书卡片 / 评论 / 会议 | `adapter.py` 的卡片段、`feishu_comment.py` | `feishu_comment_rules.py`, `feishu_meeting_invite.py` |
| Web 登录 / 注册 / 绑定 | `gateway/web_auth.py`, `api_server.py` 的 `_handle_web_auth_*` | `campagin-ai-web/src/api/auth.ts`, `src/contexts/AuthProvider.tsx`, `tests/gateway/test_web_auth.py` |
| HTTP/SSE 接口 | `gateway/platforms/api_server.py` 的 `_routes()` | `tests/gateway/test_api_server*.py` |
| 前端页面 / 路由 | `campagin-ai-web/src/App.tsx`, `src/layout/navItems.ts` | 对应 `src/pages/<page>/` |
| 前端接数据 | `campagin-ai-web/src/api/<domain>.ts` | `src/mock/<domain>.ts`（判断该域是否还是 mock） |
| 对话 SSE / 审批 | `campagin-ai-web/src/hooks/useAgentRun.ts`, `src/api/sse.ts` | `src/pages/chat/ApprovalModal.tsx`, `api_server` 的 `/v1/runs` 段 |
| dev 代理 / key 注入 | `campagin-ai-web/vite.config.ts` | profile `.env` 的 `API_SERVER_*` |
| Agent 对话行为 | `agent/conversation_loop.py`, `run_agent.py` | `agent/turn_*`, `agent/message_*`, 相关测试 |
| 模型 / provider | `agent/*adapter.py`, `agent/transports/`, `hermes_cli/providers.py` | `agent/model_metadata.py`, profile `config.yaml` 的 `providers` |
| 工具 schema / 执行 | `model_tools.py`, `tools/registry.py`, 具体工具文件 | `toolsets.py`, `tests/tools/test_*` |
| 技能系统 | `agent/skill_*.py`, `tools/skills_sync.py`, `hermes_cli/skills_hub.py` | profile `skills/`, `.claude/docs/skills-tools-configuration-guide.md` |
| 记忆 / 上下文 | `agent/memory_manager.py`, `agent/context_*.py` | `hermes_state.py`, profile `memories/` |
| Gateway 配置 / 会话 | `gateway/config.py`, `gateway/session.py`, `gateway/run.py` | `gateway/delivery.py`, `gateway/slash_commands.py` |
| Cron | `cron/scheduler.py`, `cron/jobs.py` | `hermes_cli/cron.py`, `tools/cronjob_tools.py`, profile `config.yaml` 的 `cron.user_isolation` |
| Profile / 多实例 | `hermes_cli/profiles.py`, `hermes_cli/service_manager.py` | 每个 profile 需独立 `API_SERVER_PORT`（默认 8642） |

## 11. 注意事项

- 目录名 `campagin-ai-web` 拼写错误是既成事实，import 别名 `@` 指向 `campagin-ai-web/src`，不要顺手改名。
- `API_SERVER_KEY` 能驱动带 terminal 权限的 agent，等价远程代码执行：不进前端 bundle、不进日志、不进对话。
- `config/campaign-users.json` 未入 git 且含口令摘要与飞书身份，只经 `WebAuthService` 读写，不要 cat 出完整内容。
- `gateway/run.py.bak`、`gateway/config.py.bak` 是历史备份，不要当现行实现读，也不要改。
- `.claude/worktrees/campaign-web-auth/` 是旧 worktree 副本，grep 时排除，避免读到过期代码。当前项目默认直接在主工作区改，不再新建 worktree。
- 不要随意改 `run_agent.py` 里的重导出符号；大量测试通过 `mock.patch("run_agent.<name>")` 依赖它们。
- 安全敏感路径：飞书 webhook/验签、`/web` 鉴权与 Cookie、`API_SERVER_KEY`、文件/终端工具、MCP 加载、插件加载、依赖变更。
- 用户要求：全程简体中文；结论要有代码/文档证据；不清楚就问；库文档优先 context7；不要轻易起 subagent。
