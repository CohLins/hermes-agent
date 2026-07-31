# Hermes Agent Skills、Tools 与配置指南

> 目的：快速判断“某项能力应该用 Skill、Tool、Plugin 还是 MCP”，以及它需要在哪里启用、配置和保存凭据。
>
> 本文提供分类、配置位置和高频前置条件；所有 Tool 参数、环境变量与 Skill 清单以文末权威索引为准。

## 1. 概念边界与选型

| 概念 | 是什么 | 适合什么场景 | 配置/来源 |
| --- | --- | --- | --- |
| **Tool** | 模型可直接调用的结构化能力 | 读写文件、执行命令、浏览器自动化、搜索、定时任务等 | Toolset、`hermes tools`、运行时依赖/凭据 |
| **Toolset** | 一组 Tool 的命名组合 | 按会话、平台或任务限制能力范围 | `--toolsets`、`config.yaml`、`hermes tools` |
| **Skill** | 按需加载的知识与操作流程文档 | 固化工作流、领域知识、CLI 操作方法 | `~/.hermes/skills/` |
| **Plugin** | 动态发现的扩展包 | 团队/第三方/非核心能力 | `plugins/` 或 `~/.hermes/plugins/` |
| **MCP Server** | 外部工具服务 | 需要独立服务、跨 MCP Host 复用的结构化能力 | `mcp_servers`，运行时生成 `mcp-<server>` Toolset |

### 选型优先级

新增能力优先使用：

1. 扩展已有能力；
2. CLI 命令 + Skill；
3. 服务/凭据就绪时才出现的门控 Tool；
4. Plugin；
5. MCP Server；
6. core Tool（最后选择）。

原因：core Tool 会进入模型的工具 schema。功能越多，模型每轮请求的上下文、成本与维护边界越大。单纯的流程、知识和 CLI 编排应优先写成 Skill，而不是新增 Tool。

---

## 2. 配置、凭据和状态放在哪里

默认根目录为 `~/.hermes/`，可通过 `HERMES_HOME` 改变。

| 位置 | 保存内容 | 操作建议 |
| --- | --- | --- |
| `~/.hermes/config.yaml` | 非敏感设置：模型名称、Provider 选择、终端后端、Toolset、MCP、Skill 行为配置 | 可用 `hermes config edit/get/set/unset` 管理 |
| `~/.hermes/.env` | API Key、Bot Token、密码等凭据；也承载部分历史兼容或平台级环境变量设置 | `chmod 600 ~/.hermes/.env`；不提交、不粘贴到聊天 |
| `~/.hermes/auth.json` | 部分 Hermes 管理的 OAuth 凭据与凭据池 | 由 `hermes auth`、`hermes model` 等认证流程管理；部分 Provider 使用其他认证文件 |
| `~/.hermes/weixin/accounts/<account_id>.json` | Weixin iLink QR 登录得到的账户 token、base URL 等状态 | 与 `.env` 中的 Weixin 环境变量共同保存；不要遗漏备份 |
| `~/.hermes/skills/` | 当前 profile 实际加载的 Skill；包含内置复制、Hub 安装和 Agent 创建的 Skill | 用 `hermes skills` 管理 |
| `skills/` | 仓库随附的内置 Skill 源 | 用于开发和发布，不是运行时唯一事实来源 |
| `optional-skills/` | 官方可选 Skill 源 | 按需安装，不默认全部启用 |
| `~/.hermes/plugins/` | 用户安装的外部 Plugin | 独立于核心仓库维护 |
| `~/.hermes/logs/` | 运行和网关日志 | 用于诊断；不要把日志中的敏感信息提交到仓库 |

### 配置命令

```bash
hermes config                 # 查看配置
hermes config edit            # 打开 config.yaml
hermes config get KEY         # 查看解析后的某项
hermes config set KEY VALUE   # 设置某项
hermes config unset KEY       # 删除用户设置
hermes config check           # 检查配置缺项/结构问题
hermes config migrate         # 交互式补齐迁移项
```

`hermes config set` 会自动路由：API Key 等密钥写入 `.env`，其他值写入 `config.yaml`。

### 密钥规则

1. **密钥、Token、密码优先进入 `.env` 或对应 OAuth/Provider 凭据存储**；
2. **模型、超时、工具集、功能开关等行为设置优先进入 `config.yaml`**；少数平台为兼容现有网关流程会把平台级设置写入 `.env`；
3. 不把真实值写入 `.env.example`、`cli-config.yaml.example`、文档、Issue、截图或 Git 历史；
4. 不要为普通开关新增用户可见的 `HERMES_*` 变量；优先增加 `config.yaml` 字段；
5. Docker、SSH、云沙箱只转发任务所需的最少凭据，避免把完整 `.env` 暴露给终端或容器。

---

## 3. Tools / Toolsets 分类

启用某个 Toolset 不保证所有 Tool 一定出现。Tool 仍可能受 API Key、OAuth、系统二进制、浏览器/服务连接、平台权限或模型能力门控。

### 3.1 本地开发、文件与代码

| Toolset | 主要能力 | Key/依赖 | 风险与建议 |
| --- | --- | --- | --- |
| `file` | `read_file`、`write_file`、`patch`、`search_files` | 无外部 Key | 具备读写项目文件能力；对外部输入要防提示注入 |
| `terminal` | `terminal`、`process` | 本机 Shell；可配 Docker/SSH/云后端 | 可执行命令；生产环境优先隔离后端和审批 |
| `coding` | 文件、终端、搜索、Web、Skills、浏览器、记忆、委派等组合 | 继承各组件依赖 | 适合代码工作区；权限范围较大 |
| `debugging` | `file` + `terminal` + `web` | Web 后端按需配置 | 适合排错，不等于安全只读模式 |
| `code_execution` | `execute_code`，用 Python 编程调 Tool | Python 运行环境 | 可扩大一次调用的执行范围，需审查输入与权限 |
| `delegation` | `delegate_task`，启动子 Agent | 可用 Agent 运行环境 | 会增加成本、上下文和权限传播范围 |
| `todo` | 任务分解和进度管理 | 无 | 仅会话内规划能力 |

### 3.2 Web、浏览器与研究

| Toolset | 主要能力 | 常见配置 | 说明 |
| --- | --- | --- | --- |
| `web` | `web_search`、`web_extract` | `EXA_API_KEY`、`PARALLEL_API_KEY`、`TAVILY_API_KEY`、`FIRECRAWL_API_KEY`、`BRAVE_SEARCH_API_KEY` 任选合适后端 | 搜索和网页抽取；自建 SearXNG 可用 `SEARXNG_URL` |
| `search` | 仅 `web_search` | 同 `web` | 只需要搜索，不开放抓取时使用 |
| `browser` | 导航、快照、点击、输入、滚动、CDP、控制台等 | 本地浏览器/Playwright/CDP；云端可用 Browserbase 或 Browser Use Key | 能登录网站和执行有状态操作；与真实账户联用要最小授权 |
| `x_search` | X/Twitter 搜索 | xAI OAuth 或 `XAI_API_KEY` | 默认关闭，按需在 `hermes tools` 启用 |
| `safe` | `web`、视觉和图片生成的只读/低风险组合 | 继承后端配置 | 不包含终端、文件写入和代码执行；适合不可信外部内容的起点 |

### 3.3 知识、记忆与 Skills

| Toolset | 主要能力 | 配置位置 | 说明 |
| --- | --- | --- | --- |
| `skills` | 列出、读取、创建和管理 Skill | `~/.hermes/skills/` | Skill 全文按需加载，避免每轮注入全部说明 |
| `memory` | 跨会话记忆 | `~/.hermes/memories/` 或 Memory Plugin | 内置记忆默认可用；外部记忆后端可能需要额外配置 |
| `session_search` | 搜索历史会话并总结 | `~/.hermes/sessions/` / 状态数据库 | 受会话保留策略影响 |
| `clarify` | 结构化向用户追问 | 无 | 网关/API 场景可能因交互界面限制而不可用 |

### 3.4 自动化与协同

| Toolset | 主要能力 | 依赖 | 注意事项 |
| --- | --- | --- | --- |
| `cronjob` | 创建、暂停、触发和管理定时任务 | 本地 Hermes scheduler | 定时任务会在未来自动执行；创建前确认目标与权限 |
| `kanban` | 多 Agent 任务、阻塞、交接、附件 | Kanban dispatcher 或显式 Toolset | `all` / `*` 不会自动启用；会修改共享任务状态 |
| `project` | Desktop Projects 的创建/切换 | GUI/Desktop 会话 | CLI/消息平台通常不适用 |
| `computer_use` | 后台截图、鼠标、键盘、滚动、拖拽 | `cua-driver` 在 `PATH` | 不抢占鼠标焦点，但仍能操作桌面；仅在可信任务启用 |

### 3.5 多媒体

| Toolset | 主要能力 | 常见凭据/依赖 | 说明 |
| --- | --- | --- | --- |
| `vision` | 图片理解 | 支持视觉的模型或视觉后端 | 模型是否可用由 Provider/模型能力决定 |
| `image_gen` | 图片生成 | 通常 `FAL_KEY`；也可能使用已配置的受管后端 | 按服务计费与内容策略执行 |
| `video` | 视频理解 | 视频分析后端/模型 | 非默认 Toolset，按需启用 |
| `video_gen` | 文生视频、图生视频、编辑/扩展 | 取决于启用的视频 Provider Plugin，如 FAL、xAI、DeepInfra | 工具本体不内置唯一后端 |
| `tts` | 文本转语音 | Edge TTS 可免 Key；云端见下方凭据矩阵 | 输出音频格式受平台限制 |
| 语音转写 | 收到语音后的 STT | 本地 STT 或 Groq/OpenAI/Mistral/ElevenLabs/xAI/DeepInfra | 某些格式转换需要 `ffmpeg` |

### 3.6 平台和外部集成

| Toolset / 能力 | 用途 | 凭据或前置条件 |
| --- | --- | --- |
| `homeassistant` | 查询状态、调用 Home Assistant 服务 | `HASS_TOKEN`；通常还需 `HASS_URL` |
| `discord` / `discord_admin` | Discord 内容交互与管理 | `DISCORD_BOT_TOKEN`；管理能力还取决于 Bot 权限 |
| `feishu_doc` / `feishu_drive` | 飞书文档读取、评论操作 | 飞书/Lark 应用授权、平台配置和相关依赖 |
| `yuanbao` | 元宝群信息、成员、私聊、贴纸 | 元宝 App ID / App Secret 与平台连接 |
| `spotify` | 播放控制、搜索、歌单、专辑和资料库 | Spotify PKCE OAuth；先配置 Client ID，再执行 `hermes auth spotify` |
| `mcp-<server>` | 某个 MCP Server 暴露的动态 Tool 集 | 取决于 MCP 配置：本地命令、HTTP、OAuth、Token 或外部服务 |

---

## 4. 启用、禁用与限制 Tools

### 会话级启用

```bash
hermes chat --toolsets web,file,terminal
hermes chat --toolsets debugging
hermes chat --toolsets safe
```

### 交互式管理

```bash
hermes tools
```

会话中可使用：

```text
/tools list
/tools enable <tool-or-toolset>
/tools disable <tool-or-toolset>
```

### 在 `config.yaml` 定义组合

```yaml
toolsets:
  - hermes-cli

custom_toolsets:
  research-readonly:
    - web
    - vision
    - skills
    - memory
```

### MCP Toolset

每个 MCP Server 在运行时生成一个 `mcp-<server>` Toolset：

```yaml
mcp_servers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
```

此示例会生成 `mcp-github`。MCP 的凭据、OAuth 和安全要求由该 Server 自身决定。

### 重要限制

- `all` 或 `*` 只会扩展已注册的 Toolset，**不会**绕过凭据、系统依赖或运行时能力检查；
- `kanban` 即使在 `all` / `*` 下也保持显式 opt-in；
- `hermes tools` 禁用单个 Tool 后，即使其 Toolset 已启用，该 Tool 仍不会暴露；
- 在消息网关中，应按照平台信任等级缩减 Toolset；不要向不可信公开入口开放终端、文件写入、代码执行或桌面控制。

### Weixin 的特别提醒

`hermes-weixin` 默认继承完整核心工具集合，包含文件、终端、浏览器、代码执行、定时任务和委派等高权限能力。个人微信接入推荐：

```dotenv
# 确认全局放行开关也关闭；否则会绕过平台级的 pairing 策略
GATEWAY_ALLOW_ALL_USERS=false
WEIXIN_DM_POLICY=pairing
WEIXIN_ALLOW_ALL_USERS=false
WEIXIN_GROUP_POLICY=disabled
```

先只批准自己的测试账号，再逐步开放联系人或能力。配置后还应检查没有遗留的 `GATEWAY_ALLOWED_USERS`、平台 allowlist 或已批准的 pairing 记录扩大了实际授权范围。iLink Bot 身份不是可脚本化控制的普通个人微信号，普通微信群事件可能不会投递。

---

## 5. Skills：来源、分类与生命周期

### 5.1 Skills 如何工作

Skill 是带 frontmatter 的 `SKILL.md` 操作知识文档。Agent 采用渐进式加载：先看到名称、描述和分类；只有真正需要时才读取完整内容，避免增加每轮 token。

已安装 Skill 可通过斜杠命令调用：

```text
/github-pr-workflow create a pull request
/test-driven-development fix the regression
/plan design an implementation plan
```

### 5.2 Skill 来源

| 来源 | 位置/方式 | 特点 |
| --- | --- | --- |
| 内置 Skill | 仓库 `skills/`，安装时复制到 `~/.hermes/skills/` | 默认提供常用能力 |
| 官方可选 Skill | 仓库 `optional-skills/` | 较重或较专门，按需安装 |
| Skills Hub | `hermes skills browse/search/install` | 可发现、安装和更新的目录来源 |
| 外部目录 | `skills.external_dirs` | 团队私有或多仓库共享 Skill |
| Agent 创建 | `skill_manage` 或 `/learn` | 由当前 profile 管理，需要写入审批时遵守审批策略 |
| Skill bundle | `~/.hermes/skill-bundles/*.yaml` | 将常用多个 Skill 组合为一个短命令 |

### 5.3 常用分类

| 类别 | 代表方向 |
| --- | --- |
| 软件开发 | 规划、TDD、调试、代码审查、GitHub 工作流、Hermes Skill 编写 |
| 研究 | arXiv、论文写作、博客监控、LLM Wiki、网络研究 |
| 生产力 | Notion、Google Workspace、Airtable、OCR/PDF、PPT、地图 |
| 创意与媒体 | 架构图、Excalidraw、ComfyUI、信息图、音频、YouTube、GIF |
| MLOps | Hugging Face、vLLM、llama.cpp、评测、训练、向量数据库 |
| DevOps | Docker、CLI、隧道、watcher、容器监管 |
| 平台与设备 | Apple、智能家居、元宝、邮件、社交媒体 |
| 安全与专业领域 | 1Password、OSINT、取证、区块链、金融、健康等可选能力 |

完整目录见文末 Skills Catalog 链接；不要把本表当作完整可安装列表。

### 5.4 管理命令

```bash
hermes skills list
hermes skills browse
hermes skills search <keyword>
hermes skills inspect <skill-id>
hermes skills install <skill-id>
hermes skills check
hermes skills update
hermes skills audit
```

已修改的 bundled Skill 被视为用户内容，后续同步不会盲目覆盖。需要恢复官方版本时，使用：

```bash
hermes skills reset <name> --restore
```

非交互环境另加 `--yes`。如果只想恢复同步跟踪、保留当前本地副本，则使用不带 `--restore` 的 `hermes skills reset <name>`。

### 5.5 Skill 的配置与密钥

- Skill 的**非密钥**行为配置可以通过其 frontmatter / `skills.config` 进入 `config.yaml`；
- Skill 所需 API Key、Token 等仍应在 `.env` 或 OAuth 存储中配置；
- 在消息网关和非交互会话中，不应让 Agent 通过聊天请求、接收或回显密钥；应提示使用者在本机 CLI 或 `.env` 配置。

---

## 6. 高频凭据与系统依赖矩阵

以下均为“按需配置”，不要求一次性设置全部变量。

### 6.1 LLM 与中转站

| 场景 | 推荐位置 | 凭据方式 |
| --- | --- | --- |
| 官方/内置 Provider | `model` 配置 + `.env` | 如 `ANTHROPIC_API_KEY`、`OPENROUTER_API_KEY`、`GOOGLE_API_KEY`、`GLM_API_KEY`、`KIMI_API_KEY`、`MINIMAX_API_KEY`、`HF_TOKEN`、`NVIDIA_API_KEY` 等 |
| OAuth Provider | `auth.json` 或 Provider 特定认证文件 | 使用 `hermes model` 或 `hermes auth` 管理；以当前 Provider 文档为准 |
| OpenAI-compatible 中转站 | `providers.<name>` + `model.provider: custom:<name>` | `key_env` 指向 `.env` 中的专用变量 |
| 无认证本地模型 | `providers.<name>.base_url` | 可省略 key；Hermes 使用 `no-key-required` 占位值 |

推荐命名中转站配置：

```yaml
# ~/.hermes/config.yaml
providers:
  relay:
    base_url: "https://llm.example.com/v1"
    key_env: "RELAY_LLM_API_KEY"

model:
  provider: "custom:relay"
  default: "实际模型 ID"
```

```dotenv
# ~/.hermes/.env
RELAY_LLM_API_KEY=你的中转站密钥
```

通用 OpenAI-compatible 中转站默认使用 `chat_completions`；只有中转站明确提供 Anthropic Messages 兼容接口时，才设置 `api_mode: anthropic_messages`。

### 6.2 Web 与浏览器

| 能力 | Key / 配置 |
| --- | --- |
| Exa 搜索/抽取 | `EXA_API_KEY` |
| Parallel 搜索/抽取 | `PARALLEL_API_KEY` |
| Tavily 搜索/抽取 | `TAVILY_API_KEY` |
| Firecrawl | `FIRECRAWL_API_KEY`；自建/兼容端点用 `FIRECRAWL_API_URL` |
| Brave Search | `BRAVE_SEARCH_API_KEY` |
| SearXNG | `SEARXNG_URL`，通常不需 API Key |
| Browserbase 云浏览器 | `BROWSERBASE_API_KEY`、`BROWSERBASE_PROJECT_ID` |
| Browser Use 云浏览器 | `BROWSER_USE_API_KEY` |
| 本地浏览器 CDP | `BROWSER_CDP_URL` 或 `/browser connect` |

### 6.3 图像、视频、语音

| 能力 | 常见凭据/依赖 |
| --- | --- |
| 图片生成 | `FAL_KEY`；按启用的受管/Plugin 后端而定 |
| xAI 图片/视频/X 搜索/语音 | xAI OAuth 或 `XAI_API_KEY` |
| 视频生成 | 启用对应视频 Provider Plugin；可能用 `FAL_KEY`、`XAI_API_KEY`、`DEEPINFRA_API_KEY` |
| Edge TTS | 通常不需 API Key |
| OpenAI TTS/STT | `VOICE_TOOLS_OPENAI_KEY` 或 `OPENAI_API_KEY` |
| Groq STT | `GROQ_API_KEY` |
| ElevenLabs TTS/STT | `ELEVENLABS_API_KEY` |
| Mistral TTS/STT | `MISTRAL_API_KEY` |
| Gemini TTS | `GEMINI_API_KEY` 或 `GOOGLE_API_KEY` |
| MiniMax TTS | `MINIMAX_API_KEY` |
| 本地 STT | 本地模型/命令；非 WAV 转换常需要 `ffmpeg` |

### 6.4 平台和服务

| 集成 | 配置位置 / 凭据 |
| --- | --- |
| Weixin 个人微信 | `hermes gateway setup` 写入 `WEIXIN_ACCOUNT_ID`、`WEIXIN_TOKEN` 等到 `.env`；依赖 `aiohttp` 和 `cryptography` |
| Discord | `DISCORD_BOT_TOKEN` |
| Home Assistant | `HASS_TOKEN`，通常加 `HASS_URL` |
| Spotify | `HERMES_SPOTIFY_CLIENT_ID` 后执行 `hermes auth spotify`；OAuth 状态进入 `auth.json` |
| 飞书 / 元宝 / 企业微信 / 钉钉等 | 对应平台 setup 向导、App 凭据和平台权限 |
| MCP | 每个 Server 自己定义环境变量、OAuth、Token、远端 URL 或本地二进制 |
| GitHub / Skills Hub | `GITHUB_TOKEN` / `GH_TOKEN` 可提高 API 额度或访问私有资源；并非所有本地 Skill 都需要 |

---

## 7. 最小安全配置示例

### 7.1 只读研究会话

```bash
hermes chat --toolsets safe,skills,memory
```

适合先处理不可信网页、外部文本、邮件内容或研究资料。它不提供终端、文件写入或代码执行。

### 7.2 受控开发会话

```bash
hermes chat --toolsets coding
```

使用前确认工作目录、Git 状态和终端后端。若任务来自不可信消息或需要更强隔离，优先使用 Docker/SSH 后端，并只转发所需环境变量。

### 7.3 诊断不可用能力

```bash
hermes doctor
hermes tools
hermes config check
```

排查顺序：

1. Toolset 是否被启用；
2. Tool 是否被单独禁用；
3. 所需 API Key/OAuth 是否存在；
4. 需要的 CLI、浏览器、驱动或服务是否运行；
5. 当前平台和模型是否支持该能力；
6. 是否被 profile、Gateway 授权策略或运行时门控限制。

---

## 8. 权威索引

- 配置目录、优先级和常用命令：[`website/docs/user-guide/configuration.md`](../../website/docs/user-guide/configuration.md)
- 全量环境变量：[`website/docs/reference/environment-variables.md`](../../website/docs/reference/environment-variables.md)
- Toolset 完整参考：[`website/docs/reference/toolsets-reference.md`](../../website/docs/reference/toolsets-reference.md)
- 单个 Tool 参数：[`website/docs/reference/tools-reference.md`](../../website/docs/reference/tools-reference.md)
- Skills 系统：[`website/docs/user-guide/features/skills.md`](../../website/docs/user-guide/features/skills.md)
- 内置 Skills 全量目录：[`website/docs/reference/skills-catalog.md`](../../website/docs/reference/skills-catalog.md)
- 官方可选 Skills 目录：[`website/docs/reference/optional-skills-catalog.md`](../../website/docs/reference/optional-skills-catalog.md)
- MCP 使用与配置：[`website/docs/user-guide/features/mcp.md`](../../website/docs/user-guide/features/mcp.md)
- 示例配置：[`cli-config.yaml.example`](../../cli-config.yaml.example)、[`.env.example`](../../.env.example)
- 开发扩展边界：[`AGENTS.md`](../../AGENTS.md)
