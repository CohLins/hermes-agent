# Hermes Agent 项目 Map

> 用途：后续改代码前先读本文件，按需渐进加载上下文，避免一上来扫全仓库。

## 1. 项目定位

Hermes Agent 是一个自改进 AI Agent 项目：Python 负责 CLI、Agent loop、工具系统、网关、调度与后端运行时；TypeScript/React 负责 TUI、Web dashboard、Desktop shell、官网文档站。

## 2. 先读顺序

改代码前按这个顺序加载上下文：

1. 读本文件，判断所属子系统。
2. 只读对应子系统的入口文件和最近相关测试。
3. 再读同目录下 2-3 个相邻实现，确认输入输出协议、配置来源和错误处理风格。
4. 最后才按符号名 grep 精准扩展，不做全仓库泛扫。

## 3. 顶层骨架

| 路径 | 职责 | 优先入口 |
| --- | --- | --- |
| `hermes` | 本地源码运行包装脚本 | `hermes_cli.main:main` |
| `hermes_cli/` | Python CLI、配置、子命令、setup、doctor、gateway/cron/mcp/model 等命令面 | `hermes_cli/main.py`, `hermes_cli/subcommands/` |
| `run_agent.py` | Agent 主类与运行时聚合层，保留大量测试 monkeypatch 兼容导出 | `AIAgent`, `main` |
| `agent/` | Agent loop、模型适配、上下文、记忆、技能、压缩、工具调度辅助 | `agent/conversation_loop.py`, `agent/prompt_builder.py`, `agent/tool_dispatch_helpers.py` |
| `model_tools.py` | 工具注册发现和工具调用分发窄腰 | `get_tool_definitions`, `handle_function_call` |
| `toolsets.py` | toolset 分组、平台默认工具集、工具组合规则 | `TOOLSETS`, `_HERMES_CORE_TOOLS` |
| `tools/` | 内置工具实现，自注册到 `tools.registry` | `tools/registry.py`, 具体 `*_tool.py` |
| `gateway/` | 多平台消息网关配置、鉴权、会话、平台适配 | `gateway/config.py`, `gateway/platforms/` |
| `cron/` | 内置 cron 调度、任务、执行记录和建议 | `cron/scheduler.py`, `cron/jobs.py` |
| `tui_gateway/` | Python 后端与 Node/Ink TUI 的本地桥接服务 | `tui_gateway/server.py` |
| `ui-tui/` | Ink/React 终端 UI workspace | `ui-tui/src/entry.tsx`, `ui-tui/src/app.tsx` |
| `web/` | Vite/React Web dashboard | `web/src/` |
| `apps/desktop/` | Electron 桌面壳 | `apps/desktop/src/`, `apps/desktop/electron/` |
| `apps/shared/` | 前端 workspace 共享类型/JSON-RPC/计费工具 | `apps/shared/src/index.ts` |
| `plugins/` | 打包插件与插件 manifest | `plugins/*/plugin.yaml` |
| `providers/` | Provider 抽象/基础类型 | `providers/base.py` |
| `skills/`, `optional-skills/` | Hermes skills 文档 | `*/SKILL.md` |
| `optional-mcps/` | 可选 MCP catalog manifest | `optional-mcps/*/manifest.yaml` |
| `tests/` | Python pytest 测试 | `tests/test_*.py` |
| `tests-js/` | JS/TS 测试 workspace | `tests-js/package.json` |
| `docs/` | 工程设计、RCA、契约和补充说明 | 相关主题文档 |

## 4. 关键入口和运行链路

### CLI 启动

- 包入口：`pyproject.toml` 的 `[project.scripts]` 暴露：
  - `hermes = hermes_cli.main:main`
  - `hermes-agent = run_agent:main`
  - `hermes-acp = acp_adapter.entry:main`
- 本地脚本：`./hermes` 直接调用 `from hermes_cli.main import main`。
- `hermes_cli/main.py` 负责早期 TUI/CLI 判定、子命令路由、setup/gateway/cron/doctor/model 等命令。

### Agent turn

- `run_agent.py` 聚合配置、工具定义、模型客户端、上下文与运行状态。
- 实际对话主循环已拆到 `agent/conversation_loop.py`，负责：模型调用、工具调用、重试、fallback、压缩、post-turn hooks、记忆/技能 review nudges。
- 不要随意改 `run_agent.py` 中的重导出符号；大量测试和兼容路径通过 `mock.patch("run_agent.<name>")` 依赖它们。

### 工具系统

- `tools/registry.py` 是工具注册中心。
- `model_tools.py` import/discover 内置工具与插件，提供 `get_tool_definitions()` 和 `handle_function_call()`。
- `toolsets.py` 定义工具分组；CLI、网关、cron、desktop/TUI 根据启用的 toolset 生成 schema。
- 新增工具时通常要同时看：相邻 `tools/*_tool.py`、`tools/registry.py` 用法、`toolsets.py` 是否需要暴露、相关测试。

### 网关和平台

- `gateway/config.py` 加载平台、home channel、reset policy、delivery preference 等配置。
- 平台适配在 `gateway/platforms/`，新增平台先读 `gateway/platforms/ADDING_A_PLATFORM.md`、`base.py` 和一个相近平台实现。
- 网关路径经常涉及鉴权、密钥、外部 webhook，默认按安全边界处理。

### 前端/TUI/Desktop

- 根 `package.json` 是 npm workspaces：`apps/*`, `ui-tui`, `ui-tui/packages/*`, `web`, `tests-js`。
- `ui-tui/` 是 Ink/React 终端 UI，命令见 `ui-tui/package.json`。
- `web/` 是 Vite/React dashboard，命令见 `web/package.json`。
- `apps/desktop/` 是 Electron 桌面壳，命令见 `apps/desktop/package.json`。
- 共享前端协议/类型优先看 `apps/shared/src/`。

## 5. 配置、依赖和打包

- Python 包配置：`pyproject.toml`。
- Python 版本：`>=3.11,<3.14`。
- Python 依赖策略：核心依赖多为精确 pin；provider/tool 特定依赖放 optional extras 或 lazy install。
- Python 包发现：`agent`, `tools`, `hermes_cli`, `gateway`, `tui_gateway`, `cron`, `acp_adapter`, `plugins`, `providers`。
- 前端包管理：根 `package.json` workspaces，Node 要求 `>=20`。
- 本地/发布相关：`Dockerfile`, `docker-compose*.yml`, `packaging/`, `nix/`, `setup-hermes.sh`。

## 6. 常用验证命令

按变更范围最小化运行：

| 变更范围 | 优先命令 |
| --- | --- |
| Python 单测 | `uv run pytest tests/<target>.py` |
| Python 默认测试 | `uv run pytest` |
| Python lint 相关 | `uv run ruff check <paths>` |
| Python type 相关 | `uv run ty check` |
| 全部 npm workspace 快检 | `npm run check` |
| Web | `npm run check --workspace web` |
| TUI | `npm run check --workspace ui-tui` |
| Desktop | `npm run check --workspace apps/desktop` |
| Website | `npm run typecheck --workspace website` 或 `npm run build --workspace website` |

不要为了小改动默认跑全量重命令；先跑最贴近变更的测试，再按风险扩大。

## 7. 渐进式定位指南

| 要改什么 | 先看 | 再看 |
| --- | --- | --- |
| CLI 子命令 | `hermes_cli/main.py`, `hermes_cli/subcommands/` | 相邻命令、`tests/test_*cli*` |
| Agent 对话行为 | `agent/conversation_loop.py`, `run_agent.py` | `agent/turn_*`, `agent/message_*`, 相关测试 |
| 模型/provider | `agent/*adapter.py`, `agent/transports/`, `hermes_cli/providers.py` | `agent/model_metadata.py`, provider tests |
| 工具 schema/执行 | `model_tools.py`, `tools/registry.py`, 具体工具文件 | `toolsets.py`, `tests/test_*tool*` |
| 文件/终端工具 | `tools/file_tools.py`, `tools/terminal_tool.py` | `tools/path_security.py`, `tools/approval.py` |
| 技能系统 | `agent/skill_*.py`, `tools/skills_*.py`, `skills/` | skills 相关测试 |
| 记忆/上下文 | `agent/memory_manager.py`, `agent/context_*.py` | `hermes_state.py`, 相关 tests |
| Gateway 平台 | `gateway/config.py`, `gateway/platforms/base.py` | 对应 `gateway/platforms/<platform>.py` |
| Cron | `cron/scheduler.py`, `cron/jobs.py` | `hermes_cli/cron.py`, cron tests |
| TUI | `ui-tui/src/app.tsx`, `ui-tui/src/app/`, `ui-tui/src/components/` | `ui-tui/src/__tests__/` |
| Web dashboard | `web/src/` | `apps/shared/src/`, web tests |
| Desktop | `apps/desktop/src/`, `apps/desktop/electron/` | `apps/desktop/vitest.config.ts`, desktop tests |

## 8. 注意事项

- 用户要求：全程简体中文、结论要有代码/文档证据、不清楚就问。
- 后续所有代码变更前必须先读本 map，再按本 map 渐进加载上下文。
- 修改前至少分析 3 个现有实现，确认协议、配置和环境，不要凭命名猜。
- 安全相关路径包括：网关 webhook、密钥、认证、外部 URL、文件/终端工具、MCP、插件加载、依赖变更。
- `.gitignore` 和 `.idea/` 在会话开始时已有未提交状态；不要无关改动或纳入提交。
