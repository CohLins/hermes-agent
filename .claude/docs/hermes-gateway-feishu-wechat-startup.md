# Hermes Gateway：飞书与个人微信启动手册

> 适用仓库：`/Users/szld2403178/IdeaProjects/hermes-agent`  
> 目标：飞书与个人微信使用**完全隔离的两个 Profile**（身份、记忆、会话、凭证各自独立），并以**两个独立 Gateway 进程**分别运行。

## 1. 运行架构

飞书和微信不再共用一个 Gateway，而是各自拥有独立的 Profile 和独立进程：

```text
Profile: feishu                         Profile: weixin
~/.hermes/profiles/feishu/              ~/.hermes/profiles/weixin/
  ├─ config.yaml / .env / SOUL.md         ├─ config.yaml / .env / SOUL.md
  └─ 记忆 / 会话 / cron 独立               └─ 记忆 / 会话 / cron 独立
        │                                        │
飞书（WebSocket）                          个人微信（iLink）
        │                                        │
Gateway 进程 A                             Gateway 进程 B
python ./hermes -p feishu gateway run     python ./hermes -p weixin gateway run
        │                                        │
        ├─ 按消息触发 Agent                       ├─ 按消息触发 Agent
        ├─ 调用模型 Provider（各自 .env）          ├─ 调用模型 Provider（各自 .env）
        ├─ 独立会话、记忆、消息回传                 ├─ 独立会话、记忆、消息回传
        └─ 独立 Cron 调度                         └─ 独立 Cron 调度

浏览器 Dashboard（可选，机器级独立进程，可切换任一 Profile）
```

两个 Profile 之间不共享任何身份或状态：`SOUL.md` 不同、记忆不同、会话不同、凭证不同。

## 2. 为什么是两个 Gateway，而不是一个多路复用进程

Hermes 支持 `gateway.multiplex_profiles`（单个 Gateway 服务所有 Profile），但**本方案不使用**，原因是飞书属于“端口绑定型平台”。

多路复用模式下，端口绑定型平台（`webhook`、`api_server`、`feishu`、`wecom_callback`、`bluebubbles`、`sms`、`whatsapp_cloud`、`line` 等）**只允许配置在默认 Profile 上**；次级 Profile 若启用这类平台会被判为配置错误并整体跳过。

因此飞书无法作为“次级多路复用 Profile”存在。要让飞书和微信都拥有独立身份，只能采用**每个 Profile 一个独立 Gateway 进程**的模型。

> 证据：`website/docs/user-guide/multi-profile-gateways.md:130-164`（端口绑定平台在多路复用下的限制）。

## 3. Python 环境

仓库要求 Python `>=3.11,<3.14`，见 `pyproject.toml` 的 `requires-python`。

现有 `~/.venvs/automation/`（Python 3.9.6）**不能运行当前 Hermes**。请用 `/opt/homebrew/bin/python3.11`（3.11.x）创建独立环境：

```bash
/opt/homebrew/bin/python3.11 -m venv ~/.venvs/hermes
source ~/.venvs/hermes/bin/activate

cd /Users/szld2403178/IdeaProjects/hermes-agent
python -m pip install --upgrade pip
python -m pip install -e ".[messaging,feishu,mcp]"
```

> 依赖组说明:`messaging` 通用消息、`feishu` 飞书适配、`mcp` **MCP 客户端 SDK(`mcp` + `starlette`)**。
> 只有装了 `mcp` 组,才能连接 MCP 服务器;否则 `mcp test/list` 会报 `requires the 'mcp' Python SDK, but it is not installed`。
> `mcp` 是代码环境级依赖,装一次两个 Profile 都生效。若已建好环境只是漏装,补装即可:
> `python -m pip install -e ".[mcp]"`(需要全部可选功能时用 `".[all]"`)。

验证本地源码可运行：

```bash
python ./hermes --help
```

后续所有命令都建议在该环境下、从仓库根目录用 `python ./hermes` 调用，确保使用本地源码而非全局安装的 `hermes`：

```bash
source ~/.venvs/hermes/bin/activate
cd /Users/szld2403178/IdeaProjects/hermes-agent
python ./hermes <命令>
```

## 4. Profile 与配置目录结构

迁移后存在两个命名 Profile，各自是独立的 Hermes home 目录：

```text
~/.hermes/profiles/feishu/
  ├─ config.yaml       # 模型、toolsets、审批等
  ├─ .env              # LUNORA + FEISHU 凭证（不含微信），权限 0600
  └─ SOUL.md           # 飞书办公助手身份

~/.hermes/profiles/weixin/
  ├─ config.yaml       # 模型、toolsets、审批等
  ├─ .env              # LUNORA + WEIXIN 凭证（不含飞书），权限 0600
  ├─ SOUL.md           # 微信个人助手身份
  └─ weixin/           # iLink Bot 账号与会话状态

~/.hermes/                # 默认 Profile，保留作为回滚基线，日常不再直接启动
```

每个 Profile 会在 `~/.local/bin/` 自动生成同名包装脚本（`feishu`、`weixin`），等价于 `hermes -p <name>`。因为本项目使用本地源码，**推荐仍以 `python ./hermes -p <name>` 为准**；`feishu`/`weixin` 包装脚本仅在全局已安装 hermes 且在 PATH 中时作为快捷方式。

> 证据：`website/docs/user-guide/profiles.md`（Profile 目录结构与 `-p` 用法）、`hermes_cli/profiles.py`。

## 5. 安全原则

不要把任何密钥提交进项目仓库，也不要外发以下内容：

- 模型 API Key（`LUNORA_API_KEY`）；
- `FEISHU_APP_SECRET`；
- `WEIXIN_TOKEN`；
- Dashboard 登录密码或签名密钥。

两个 Profile 的 `.env` 都应保持 `0600` 权限：

```bash
chmod 600 ~/.hermes/profiles/feishu/.env
chmod 600 ~/.hermes/profiles/weixin/.env
```

编辑某个 Profile 的凭证：

```bash
nano ~/.hermes/profiles/feishu/.env
nano ~/.hermes/profiles/weixin/.env
```

## 6. 模型配置（Lunora 中转站）

两个 Profile 都使用同一个 Lunora 中转站，但各自在自己的 `.env` 内保存 `LUNORA_API_KEY`（不共享环境变量）。

两个 Profile 的 `config.yaml` 中模型部分一致：

```yaml
# config.yaml（feishu 与 weixin 各一份）
custom_providers:
  - name: lunora
    base_url: https://api.uselunora.com/v1
    key_env: LUNORA_API_KEY
    api_mode: chat_completions

model:
  provider: custom:lunora
  default: gpt-5.5
```

各自 `.env` 内填写：

```dotenv
LUNORA_API_KEY=你的实际中转站_API_Key
```

## 7. 飞书 Profile 配置

### 7.1 飞书开发者后台前置条件

在飞书开放平台 <https://open.feishu.cn/> 中，应用应满足：

1. 已启用**机器人**能力；
2. 已配置并发布应用版本；
3. 已订阅事件：`im.message.receive_v1`；
4. 至少授予：`im:message`、`im:message:send_as_bot`、`im:resource`、`im:chat`、`im:chat:readonly`。

推荐额外授权：`im:message.reactions:readonly`、`admin:app.info:readonly`、`contact:user.id:readonly`。

### 7.2 飞书凭证（写入 feishu Profile 的 .env）

```dotenv
# ~/.hermes/profiles/feishu/.env
# 飞书机器人
FEISHU_APP_ID=cli_a956775cb4b89ed0
FEISHU_APP_SECRET=你的_app_secret
FEISHU_DOMAIN=feishu
FEISHU_CONNECTION_MODE=websocket

# 私聊：推荐配对审批，初次测试时保持用户列表为空
FEISHU_ALLOW_ALL_USERS=false
FEISHU_ALLOWED_USERS=

# 群聊：仅在 @机器人 时响应
FEISHU_GROUP_POLICY=open
FEISHU_REQUIRE_MENTION=true
```

`FEISHU_CONNECTION_MODE=websocket` 由本机主动连接飞书，无需公网 IP、域名、证书或 Webhook。仅在已有公网 HTTP 服务时才考虑 `webhook` 模式（并需同时设置 `FEISHU_ENCRYPT_KEY` 与 `FEISHU_VERIFICATION_TOKEN`）。

> 飞书 Profile 的 `.env` 中**不应包含任何 `WEIXIN_*` 凭证**。

## 8. 微信 Profile 配置（Weixin / iLink Bot）

> 本节是**个人微信**，不是企业微信（WeCom）。

### 8.1 核心限制

个人微信适配使用腾讯 **iLink Bot API**，扫码后连接的是独立的 iLink Bot 身份，而不是把扫码用的普通微信号改成机器人。

- 私聊通常可用；
- 普通微信群消息通常无法稳定投递给 iLink Bot；
- 若腾讯 iLink 未投递群事件，Hermes 无法接收。

如果主要目标是稳定的群聊机器人，应评估企业微信，不要依赖个人微信 iLink 群消息。

### 8.2 微信凭证（写入 weixin Profile 的 .env）

迁移已把 iLink 账号与会话状态复制到 `~/.hermes/profiles/weixin/weixin/`。凭证在该 Profile 的 `.env`：

```dotenv
# ~/.hermes/profiles/weixin/.env
WEIXIN_ACCOUNT_ID=你的_iLink_Bot_账号_ID
WEIXIN_TOKEN=你的_iLink_Bot_Token
WEIXIN_BASE_URL=https://ilinkai.weixin.qq.com
WEIXIN_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c

# 推荐：首次由配对机制授权
WEIXIN_DM_POLICY=pairing
WEIXIN_GROUP_POLICY=disabled
```

> 微信 Profile 的 `.env` 中**不应包含任何 `FEISHU_*` 凭证**。

### 8.3 只有普通微信号：需在 weixin Profile 内扫码一次

没有 iLink 凭证时，需在 weixin Profile 下完成一次扫码，腾讯成功后发放账号 ID 和 Token：

```bash
python ./hermes -p weixin gateway setup
```

在菜单中只选择 **Weixin / WeChat**，扫码并在手机确认后，向导会写入该 Profile 的 `.env` 与 `weixin/` 目录。Token/会话失效前无需重复扫码。

## 9. 启动两个 Gateway（各自包含 Agent 与 Cron）

飞书与微信各自一个独立 Gateway 进程，建议开两个终端分别前台运行并观察日志：

**终端 A —— 飞书**

```bash
source ~/.venvs/hermes/bin/activate
cd /Users/szld2403178/IdeaProjects/hermes-agent
python ./hermes -p feishu gateway run -v
```

**终端 B —— 微信**

```bash
source ~/.venvs/hermes/bin/activate
cd /Users/szld2403178/IdeaProjects/hermes-agent
python ./hermes -p weixin gateway run -v
```

若全局已安装 hermes 且包装脚本在 PATH，可用等价快捷方式：

```bash
feishu gateway run -v      # 等价于 hermes -p feishu gateway run -v
weixin gateway run -v      # 等价于 hermes -p weixin gateway run -v
```

每个进程都会：连接自己 Profile 配置的平台、收到消息后创建并运行会话 Agent、用各自 `.env` 的模型 Provider 生成回复、管理各自独立的会话与记忆、并运行各自的 Cron 调度。

### 不要重复启动同一 Profile 的 Gateway

同一 Profile 的平台凭证（飞书 App ID、微信 Token）同时只应被一个 Gateway 使用。已安装后台服务后就不要再对同一 Profile 额外执行 `gateway run`，否则会产生连接/Token 锁冲突。两个不同 Profile 的 Gateway 同时运行是正常的，互不冲突。

## 10. 配对码授权

启用配对策略（飞书 `FEISHU_ALLOW_ALL_USERS=false` 未列白名单、微信 `WEIXIN_DM_POLICY=pairing`）时，**未授权用户首次给机器人发消息，机器人会回复一串配对码**（例如微信里看到的 `CMMPCTPY`）。

这串配对码的含义是：**发信人尚未被授权，机器人不会正常对话，需要机器人拥有者在运行 Gateway 的主机上执行“批准”命令。** 它不是错误，也不需要用户做别的操作。

批准命令必须在对应 Profile 下执行：

**飞书配对码**

```bash
python ./hermes -p feishu pairing list                 # 查看待批准列表
python ./hermes -p feishu pairing approve feishu <配对码>
```

**微信配对码**

```bash
python ./hermes -p weixin pairing list                 # 查看待批准列表
python ./hermes -p weixin pairing approve weixin <配对码>
```

批准后，该用户即可正常与对应 Profile 的机器人对话。

飞书若已知用户 `open_id`，也可直接配白名单免配对：

```dotenv
# ~/.hermes/profiles/feishu/.env
FEISHU_ALLOW_ALL_USERS=false
FEISHU_ALLOWED_USERS=ou_xxxxxxxxx,ou_yyyyyyyyy
FEISHU_GROUP_POLICY=allowlist
FEISHU_REQUIRE_MENTION=true
```

> 注意：配对状态按 Profile 隔离。飞书的配对码只能用 `-p feishu` 批准，微信的只能用 `-p weixin` 批准；用错 Profile 会找不到对应的待批请求。

## 11. 后台常驻（macOS，可选）

每个 Profile 各自安装独立的 LaunchAgent 服务，名称互不冲突：

```bash
python ./hermes -p feishu gateway install
python ./hermes -p weixin gateway install

python ./hermes -p feishu gateway status
python ./hermes -p weixin gateway status
```

日常管理（对每个 Profile 分别执行 start/stop/restart/status）：

```bash
python ./hermes -p feishu gateway restart
python ./hermes -p weixin gateway restart
```

服务文件路径：`~/Library/LaunchAgents/ai.hermes.gateway-feishu.plist` 与 `ai.hermes.gateway-weixin.plist`。

> 本手册按用户要求**只完成迁移**，macOS 后台服务安装与线上验证由用户自行决定执行。

## 12. Web Dashboard（可选，机器级独立进程）

Dashboard **不包含在任何 Gateway 进程中**，是机器级的独立进程，可在侧边栏切换器里管理**任一** Profile 的配置、会话、日志、技能和定时任务。

```bash
source ~/.venvs/hermes/bin/activate
cd /Users/szld2403178/IdeaProjects/hermes-agent
python ./hermes dashboard
```

默认地址 `http://127.0.0.1:9119`。`python ./hermes -p feishu dashboard` / `-p weixin dashboard` 会打开同一个机器级 Dashboard，并预选对应 Profile。

> 因此两个 Profile 隔离后，Web UI 不受影响：仍是一个机器级界面，通过切换器选择要管理的 Profile。

## 13. 按 Profile 添加 MCP 与 Skill

MCP 与 Skill 都通过各自的 `HERMES_HOME` 解析(`hermes_constants.py:1195-1197` 的 `get_skills_dir()`;MCP 写入各 Profile 的 `config.yaml`),因此**飞书加一批、微信加另一批,互不影响**。用 `-p feishu` / `-p weixin` 分别操作。

前置依赖:MCP 客户端需要 `[mcp]` 组(见第 3 节);stdio 型服务器还需其运行器(如 `uvx` / `npx`)已在 PATH。

### 13.1 密钥写法(重要)

**key 不要明文写进 `config.yaml`**。真正的密钥放对应 Profile 的 `.env`,配置里用 `${变量名}` 引用——`${VAR}` 与 `${env:VAR}` 均可,从该 Profile 的密钥作用域解析(`tools/mcp_tool.py:3933-3948`)。

- stdio 型:密钥走 `env:` 映射;
- HTTP 型:密钥走 `headers:` 映射;
- 变量未设置时占位符会**原样保留**导致连接失败,务必确认 `.env` 已填。

原因:`config.yaml` 属于可分发/可导出文件(`profile_distribution.py`),明文密钥易被一起导出或提交;`.env` 才是密钥存放处且按 Profile 隔离。

### 13.2 命令行添加(自动写入该 Profile 的 config.yaml)

```bash
# stdio 型
python ./hermes -p feishu mcp add 我的server --command npx --args -y @some/mcp-server
# HTTP 型
python ./hermes -p feishu mcp add 我的server --url https://example.com/mcp --auth header

python ./hermes -p feishu mcp list
python ./hermes -p feishu mcp test 我的server
python ./hermes -p feishu mcp remove 我的server
```

### 13.3 手写配置示例:mcp-atlassian(只读,带密钥)

在 `~/.hermes/profiles/feishu/config.yaml` 新增顶层 `mcp_servers:` 段(非密钥项内联,账号/Token 用 `${}` 引用):

```yaml
mcp_servers:
  mcp-atlassian:
    command: /Users/szld2403178/.local/bin/uvx   # 用绝对路径,兼容后台服务模式的 PATH
    args:
      - mcp-atlassian
    env:
      READ_ONLY_MODE: "true"                       # 只读,不会改 Jira/Confluence
      JIRA_URL: https://suntontech.atlassian.net/
      JIRA_USERNAME: "${JIRA_USERNAME}"
      JIRA_API_TOKEN: "${JIRA_API_TOKEN}"
      CONFLUENCE_URL: https://suntontech.atlassian.net/wiki
      CONFLUENCE_USERNAME: "${CONFLUENCE_USERNAME}"
      CONFLUENCE_API_TOKEN: "${CONFLUENCE_API_TOKEN}"
```

在 `~/.hermes/profiles/feishu/.env` 填真实值(Atlassian Cloud 同一站点的 Jira/Confluence 通常是**同一邮箱 + 同一 API Token**,Token 在 <https://id.atlassian.com/manage-profile/security/api-tokens> 生成):

```dotenv
JIRA_USERNAME=你的Atlassian邮箱
JIRA_API_TOKEN=你的API_Token
CONFLUENCE_USERNAME=你的Atlassian邮箱
CONFLUENCE_API_TOKEN=你的API_Token
```

### 13.4 添加 Skill

Skill 存在 `~/.hermes/profiles/<profile>/skills/`:

```bash
python ./hermes -p feishu skills search <关键词>
python ./hermes -p feishu skills install <skill 标识 或 SKILL.md 的 URL>
python ./hermes -p feishu skills list
```

或手写:在 `~/.hermes/profiles/feishu/skills/<skill名>/SKILL.md` 放一个带 `name:` / `description:` frontmatter 的文件。

### 13.5 让改动生效

Dashboard/文件改动只落磁盘,运行中的 Gateway 需重载:

```bash
# 在对应平台聊天里发斜杠命令(热重载)
/reload-mcp
/reload-skills
# 或重启该 Profile 的 Gateway
python ./hermes -p feishu gateway restart
```

### 13.6 微信独立添加

把上面所有 `-p feishu` 换成 `-p weixin`,配置落在 `~/.hermes/profiles/weixin/`,密钥填 `~/.hermes/profiles/weixin/.env`,与飞书完全独立、互不可见。

## 14. 最短操作清单

### 已完成迁移，日常启动两个 Gateway

```bash
source ~/.venvs/hermes/bin/activate
cd /Users/szld2403178/IdeaProjects/hermes-agent

# 终端 A
python ./hermes -p feishu gateway run -v

# 终端 B
python ./hermes -p weixin gateway run -v
```

### 收到配对码时

```bash
# 飞书
python ./hermes -p feishu pairing approve feishu <配对码>
# 微信
python ./hermes -p weixin pairing approve weixin <配对码>
```

### 需要浏览器管理界面时

```bash
python ./hermes dashboard        # 机器级，切换器选 feishu / weixin
```

## 15. 关键证据来源

- Python 版本要求：`pyproject.toml` 的 `requires-python`。
- 可选依赖组(`mcp`/`all` 等)：`pyproject.toml` 的 `optional-dependencies`。
- MCP 配置读取与 `${VAR}` 密钥插值(按 Profile 密钥作用域)：`tools/mcp_tool.py`(`_load_mcp_config`、`_interpolate_env_vars`)。
- MCP 配置键(`command`/`args`/`env`/`url`/`headers`/`tools` 等)：官方文档 `/docs/reference/mcp-config-reference`。
- Skill 目录解析：`hermes_constants.py` 的 `get_skills_dir()`。
- CLI 本地源码入口：仓库根目录 `hermes`。
- Profile 目录结构与 `-p` / 别名用法：`website/docs/user-guide/profiles.md`、`hermes_cli/profiles.py`。
- 多路复用及端口绑定平台限制（飞书为何不能做次级多路复用 Profile）：`website/docs/user-guide/multi-profile-gateways.md:130-164`。
- Gateway 子命令与后台服务：`hermes_cli/subcommands/gateway.py`。
- Gateway 启动的 Cron scheduler：`gateway/run.py`。
- 飞书配置键与 WebSocket 默认模式：`plugins/platforms/feishu/adapter.py`。
- 微信 iLink QR 登录、Token 校验与长轮询：`gateway/platforms/weixin.py`。
- 本次迁移执行计划与回滚步骤：`docs/superpowers/plans/2026-07-21-feishu-weixin-profile-isolation.md`。
