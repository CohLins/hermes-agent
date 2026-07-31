# 当前项目启动与多平台运行 SOP

> 适用范围：当前已打开的 Hermes Agent 仓库。本文从“已有源码目录”开始，不包含 clone、拉取代码或二开分支同步流程。
>
> 目标：在当前环境中完成模型配置，并接入 **Weixin（个人微信 iLink Bot）** 与 **Feishu / Lark**；使用**同一个 Gateway 进程**同时运行两种平台。

## 1. 结论：Weixin 和 Feishu 能否同时支持？

**可以同时支持。**

Gateway 的 `platforms` 是多平台配置集合；启动时会遍历所有 `enabled` 平台，分别创建并连接 adapter。Weixin 与 Feishu 没有互斥配置或共享凭据锁。

推荐组合：

```text
Weixin：iLink 长轮询
Feishu：WebSocket 长连接（推荐）
```

这两个模式都由 Hermes 主动建立出站连接，**不监听本机端口**，因此可在同一个 Gateway 进程中并行运行。

正确方式：

```bash
hermes gateway setup  # 依次完成 Weixin 和 Feishu 配置
hermes gateway run    # 只启动一个 Gateway 进程
```

不要分别为 Weixin 和 Feishu 启动两个 Gateway。相同 `HERMES_HOME` 默认只应运行一个 Gateway；同一 Weixin token 或同一 Feishu App ID 也不能被多个本地 Gateway 实例同时消费。

### 共享什么，不共享什么

| 项目 | Weixin 与 Feishu 的关系 |
| --- | --- |
| 默认模型、Provider、Persona、Memory、Toolset | 同一个 profile 下默认共享 |
| Gateway 进程与 `max_concurrent_sessions` | 共享；一个平台的长任务会占用另一个平台也要使用的并发配额 |
| 聊天历史 / Session | 默认隔离；session key 包含平台名，不会自动跨平台续聊 |
| 平台凭据 | 独立；Weixin 使用 iLink 账户凭据，Feishu 使用 App ID/App Secret |
| Channel 覆盖 | 可独立配置；可按平台 chat/channel 设置不同模型或系统提示 |

如果其中一个平台暂时连接失败，但另一个平台仍在线，Gateway 会保持运行并对失败平台执行重连。

---

## 2. 当前项目的环境准备

### 2.1 确认当前目录和 Python 环境

在仓库根目录执行：

```bash
pwd
git status --short
python3 --version
uv --version
```

当前项目要求 Python `>=3.11,<3.14`。开始前保留已有未提交改动，不要用初始化命令覆盖它们。

### 2.2 安装当前仓库依赖

仅运行 Weixin 与 Feishu Gateway 时：

```bash
uv sync --extra messaging --extra feishu
```

如果当前 checkout 已使用外置或既有虚拟环境，先激活该环境后安装等价 extras：

```bash
# 示例：当前仓库内存在 venv 时
source venv/bin/activate
uv pip install -e ".[messaging,feishu]"
```

依赖说明：

| 平台 | 最低 Python 依赖 | 来源 |
| --- | --- | --- |
| Weixin | `aiohttp`、`cryptography` | `messaging` extra 提供 `aiohttp`；`cryptography` 是核心依赖 |
| Feishu WebSocket | `lark-oapi`、`websockets` | `feishu` extra 提供 `lark-oapi`；项目核心依赖包含 `websockets` |
| Feishu webhook | Feishu WebSocket 依赖 + `aiohttp` | 同时安装 `messaging` 与 `feishu` |
| 终端二维码显示 | `qrcode` | `messaging` / `feishu` extras 都包含 |

安装后先执行诊断：

```bash
uv run hermes doctor
```

验收标准：Python 环境可用；`doctor` 不报告 Weixin/Feishu 依赖缺失；尚未配置模型或平台凭据时出现对应提示属于正常现象。

---

## 3. 配置 LLM（两种平台共用）

Weixin 和 Feishu 同一个 profile 默认使用同一份模型配置。先配置模型，再启动 Gateway。

### 3.1 推荐通过向导配置

```bash
uv run hermes model
```

或：

```bash
uv run hermes setup
```

完成后做一次真实请求：

```bash
uv run hermes chat -q "回复 OK，确认模型连接正常"
```

### 3.2 OpenAI-compatible 中转站最小配置

推荐使用命名 custom provider，将密钥与模型路由分离。

`~/.hermes/config.yaml`：

```yaml
providers:
  relay:
    base_url: "https://llm.example.com/v1"
    key_env: "RELAY_LLM_API_KEY"

model:
  provider: "custom:relay"
  default: "替换为中转站实际支持的模型 ID"
```

`~/.hermes/.env`：

```dotenv
RELAY_LLM_API_KEY=替换为实际密钥
```

通用 OpenAI-compatible 中转站默认走 `chat_completions`，不必设置 `api_mode`。只有中转站明确提供 Anthropic Messages 兼容接口时，才设置：

```yaml
api_mode: anthropic_messages
```

保护本地配置：

```bash
chmod 600 ~/.hermes/.env ~/.hermes/config.yaml
```

---

## 4. 配置 Weixin（个人微信）

> Weixin 使用腾讯 **iLink Bot API**，与企业微信 WeCom 不同。

### 4.1 使用二维码向导配置

```bash
uv run hermes gateway setup
```

在平台菜单中选择 **Weixin / WeChat**。向导会：

1. 从 iLink 请求二维码；
2. 在终端显示二维码或登录链接；
3. 使用微信扫码并在手机确认；
4. 保存 `account_id`、token、base URL；
5. 询问 DM 与群聊授权策略。

向导完成后，凭据会写入：

```text
~/.hermes/.env
~/.hermes/weixin/accounts/<account_id>.json
```

最低连接条件：

```dotenv
WEIXIN_ACCOUNT_ID=你的 iLink Bot ID
WEIXIN_TOKEN=你的 iLink Bot Token
```

### 4.2 推荐安全策略

在向导中选择：

```text
DM：Use DM pairing approval
Group：Disable group chats
```

对应最小安全配置：

```dotenv
# 全局与 Weixin 平台都不允许未知用户直接获得权限
GATEWAY_ALLOW_ALL_USERS=false
WEIXIN_DM_POLICY=pairing
WEIXIN_ALLOW_ALL_USERS=false
WEIXIN_GROUP_POLICY=disabled
```

陌生用户首次私信会进入配对流程；只批准你确认过的配对请求：

```bash
uv run hermes pairing approve <配对码>
```

配置后检查以下内容未意外扩大访问范围：

- `GATEWAY_ALLOWED_USERS`；
- `WEIXIN_ALLOWED_USERS`；
- 已批准的 pairing 记录；
- 其他全局 allow-all 配置。

### 4.3 Weixin 运行特性与限制

- Hermes 使用**出站长轮询**接收消息，不需要公网 webhook，也不占用本机监听端口。
- 每个联系人对应的 `context_token` 会持久化，重启后可继续回复。
- QR 登录得到的是 iLink bot 身份，例如 `...@im.bot`，**不是可脚本化控制的普通个人微信客户端**。
- iLink bot 通常不能像普通联系人一样加入微信群，且普通微信群事件通常不会投递。因此先按**私聊可用**设计；`WEIXIN_GROUP_POLICY` 不会绕过 iLink 平台限制。

---

## 5. 配置 Feishu / Lark

### 5.1 创建或接入 Feishu 应用

执行：

```bash
uv run hermes gateway setup
```

在同一个平台菜单中继续选择 **Feishu / Lark**。可选方式：

1. **扫码创建（推荐）**：用 Feishu / Lark 手机端扫码，Hermes 创建 Bot 应用并保存凭据；
2. **手工输入**：先在开发者平台创建应用，再输入 App ID 和 App Secret。

开发者平台：

- 飞书中国版：<https://open.feishu.cn/>
- Lark 国际版：<https://open.larksuite.com/>

手工创建 App 时，必须完成：

1. 开启 **Bot** capability；
2. 添加至少 `im:message`、`im:message:send_as_bot`、`im:resource`、`im:chat`、`im:chat:readonly` 权限；
3. 在事件订阅中订阅 `im.message.receive_v1`；
4. 发布应用版本；企业环境可能还需要管理员审核。

仅保存 App ID 和 App Secret 不代表消息权限已经生效；没有发布应用或订阅事件时，Bot 不会正常收消息。

### 5.2 推荐使用 WebSocket 模式

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=secret_xxx
FEISHU_DOMAIN=feishu
FEISHU_CONNECTION_MODE=websocket

# 生产环境建议限制可用用户
FEISHU_ALLOWED_USERS=ou_xxx,ou_yyy
```

| 配置 | 含义 |
| --- | --- |
| `FEISHU_DOMAIN=feishu` | 飞书中国版 |
| `FEISHU_DOMAIN=lark` | Lark 国际版 |
| `FEISHU_CONNECTION_MODE=websocket` | 推荐默认；SDK 建立出站长连接，不需要公网 URL |
| `FEISHU_ALLOWED_USERS` | 允许使用 Bot 的 Open ID 列表；生产环境建议配置 |
| `FEISHU_HOME_CHANNEL` | cron / 通知的默认目标聊天 |

WebSocket 模式适合本机、内网主机或无公网入口的服务器；它不监听本机端口，可与 Weixin 长轮询安全地同进程运行。

### 5.3 Webhook 模式（仅按需）

只有已具备公网入口、反向代理与入站安全配置时才使用：

```dotenv
FEISHU_CONNECTION_MODE=webhook
FEISHU_WEBHOOK_HOST=127.0.0.1
FEISHU_WEBHOOK_PORT=8765
FEISHU_WEBHOOK_PATH=/feishu/webhook

# 生产环境建议同时配置
FEISHU_VERIFICATION_TOKEN=...
FEISHU_ENCRYPT_KEY=...
```

Webhook 默认地址是：

```text
http://127.0.0.1:8765/feishu/webhook
```

注意：绑定 `127.0.0.1` 时，飞书云端无法直接访问；必须通过反向代理或其他可达入口转发。Webhook 会监听本机端口，端口不能与其他服务冲突。若没有明确需求，使用 WebSocket。

### 5.4 Feishu 的访问策略

- 私聊：Bot 会处理 direct message；生产环境建议设置 `FEISHU_ALLOWED_USERS`。
- 群聊：默认需要 `@` Bot；默认群聊策略为 `allowlist`。
- 如需禁用群聊：

  ```dotenv
  FEISHU_GROUP_POLICY=disabled
  ```

- 不建议设置 `FEISHU_REQUIRE_MENTION=false`，除非明确需要 Bot 读取群内全部消息并已完成权限和隐私评估。

---

## 6. 同时启动、验证和后台运行

### 6.1 一次配置两个平台

`hermes gateway setup` 有平台配置循环。完成 Weixin 后不要退出；返回菜单，继续配置 Feishu，然后选择 `Done`。

检查 `~/.hermes/.env` 至少具备：

```dotenv
# Weixin
WEIXIN_ACCOUNT_ID=...
WEIXIN_TOKEN=...
WEIXIN_DM_POLICY=pairing
WEIXIN_GROUP_POLICY=disabled

# Feishu
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_CONNECTION_MODE=websocket
```

密钥文件权限：

```bash
chmod 600 ~/.hermes/.env
```

### 6.2 前台启动并观察日志

```bash
uv run hermes gateway run -v
```

预期日志中应分别出现 Weixin 与 Feishu 的连接成功记录。验证顺序：

1. 从已配对的 Weixin 联系人发一条测试消息；
2. 从 `FEISHU_ALLOWED_USERS` 中的飞书账号给 Bot 发私聊；
3. 在飞书群里 `@Bot` 并发送测试消息；
4. 确认两端均收到模型回复；
5. 确认 Weixin 的请求没有出现在 Feishu 会话历史中，反之亦然。

状态检查：

```bash
uv run hermes gateway status --deep
uv run hermes doctor
```

### 6.3 后台常驻

前台验证成功后：

```bash
uv run hermes gateway install
uv run hermes gateway start
uv run hermes gateway status --deep
```

生命周期操作的是整个多平台 Gateway：

```bash
uv run hermes gateway stop
uv run hermes gateway restart
uv run hermes gateway status
```

不要尝试 `gateway start --platform weixin` 或为 Feishu 再启动一个进程；平台选择由配置决定，服务操作面对整个 Gateway。

---

## 7. 多平台运行的安全与容量边界

### 7.1 Tool 权限

`hermes-weixin` 与 `hermes-feishu` 默认继承完整核心 Tool 集，可能包含：

- 文件读写；
- 终端和进程控制；
- 浏览器自动化；
- 代码执行；
- 定时任务；
- 子 Agent 委派。

因此，两个平台都应该先使用 allowlist / pairing，只开放给可信用户。对于开放群、外部协作群或不可信入口，使用 `hermes tools` 缩减能力，优先只读 Toolset（例如 `safe`、`web`、`skills`），不要默认暴露 terminal、file、code execution 或 computer use。

### 7.2 并发与会话

同一个 profile 的 `max_concurrent_sessions` 是所有入口共用的限制，包括 Weixin、Feishu、CLI、TUI 和 Dashboard。设置示例：

```yaml
# ~/.hermes/config.yaml
max_concurrent_sessions: 4
```

含义：任一平台的长任务会占用共享配额；配额满时，另一个平台的新会话可能被拒绝。高峰期需要提高该值或使用不同 profile / 独立部署隔离负载。

### 7.3 平台隔离

同一 profile 默认共享模型、Memory 与 Toolset，但**不会自动共享聊天上下文**：

- Weixin session key 包含 `weixin`；
- Feishu session key 包含 `feishu`；
- 即使用户 ID 字符串相同，也不会合并会话；
- 需要跨平台接续时，必须显式使用 session resume/switch 机制。

### 7.4 端口与实例约束

| 组合 | 是否有本机端口冲突 | 建议 |
| --- | --- | --- |
| Weixin 长轮询 + Feishu WebSocket | 否 | 推荐组合 |
| Weixin 长轮询 + Feishu webhook | Weixin 不冲突；Feishu 需要独占 webhook 端口 | 仅在已有公网接入和反代时使用 |
| 两个 Gateway 使用同一 `HERMES_HOME` | 不允许 | 只启动一个 Gateway |
| 两个 Gateway 使用同一 Weixin token / Feishu App ID | 不允许 | 每套平台凭据只绑定一个活跃实例 |

---

## 8. 当前项目代码更新后的固定流程

本节只覆盖**当前仓库已有二开代码**更新后的本地验证，不包含重新拉取源码。

1. 查看变更范围：

   ```bash
   git status --short
   git diff --stat
   ```

2. 读取 `.claude/PROJECT_MAP.md`，按目标子系统加载入口、相关测试与相邻实现。
3. 按改动范围执行验证：

   | 改动 | 命令 |
   | --- | --- |
   | Gateway / Weixin / Feishu | `scripts/run_tests.sh tests/gateway/test_weixin.py`、`scripts/run_tests.sh tests/gateway/test_feishu.py` |
   | 其他 Python 路径 | `scripts/run_tests.sh tests/<target>.py` |
   | Python lint | 激活当前项目 venv 后执行 `uv run --active ruff check <paths>` |
   | Python 类型 | 激活当前项目 venv 后执行 `uv run --active ty check` |
   | Web / TUI / Desktop | 只运行受影响 workspace 的 `npm run check --workspace <name>` |
   | 文档站 | `npm run typecheck --workspace website`、`npm run build --workspace website` |

4. 涉及 Gateway 配置或平台 adapter 时，额外做真实前台验证：

   ```bash
   uv run hermes gateway run -v
   ```

   至少确认：两个平台都能连接、授权策略按预期生效、单个平台失败不会让另一个平台不可用。

5. 提交前检查：

   ```bash
   git diff --check
   git status --short
   ```

不要提交 `~/.hermes/.env`、`auth.json`、Weixin 账户文件、日志、会话数据或真实密钥。

---

## 9. 常见故障排查

| 现象 | 先检查什么 |
| --- | --- |
| Weixin 未连接 | `WEIXIN_ACCOUNT_ID`、`WEIXIN_TOKEN`、`aiohttp` / `cryptography`、iLink 登录状态 |
| Weixin 扫码后群聊无消息 | 确认消息是发给 iLink bot 身份；普通微信群事件通常不由 iLink 投递 |
| Feishu 已配置但不收消息 | App 是否已发布；是否订阅 `im.message.receive_v1`；Bot capability 和权限是否已开通 |
| Feishu WebSocket 不连接 | `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DOMAIN`、`FEISHU_CONNECTION_MODE=websocket`、`lark-oapi` 依赖 |
| Feishu webhook 验证失败 | webhook URL 是否可达；`FEISHU_VERIFICATION_TOKEN` / `FEISHU_ENCRYPT_KEY` 是否与控制台一致 |
| 两个平台都已配置但 Gateway 只连一个 | 前台运行 `uv run hermes gateway run -v`，查看失败平台的 adapter 日志；运行 `uv run hermes doctor` |
| 新消息被拒绝 | 检查 allowlist、pairing 状态、`GATEWAY_ALLOW_ALL_USERS`、`max_concurrent_sessions` |
| 模型请求失败 | `uv run hermes model`、`uv run hermes config check`、中转站 URL/Key/模型 ID |

常用诊断命令：

```bash
uv run hermes doctor
uv run hermes config check
uv run hermes gateway status --deep
uv run hermes tools
```

---

## 10. 代码与文档依据

- 多平台 Gateway 生命周期：[`gateway/run.py`](../../gateway/run.py)
- Gateway 配置和 Weixin/Feishu 环境变量映射：[`gateway/config.py`](../../gateway/config.py)
- Weixin iLink adapter：[`gateway/platforms/weixin.py`](../../gateway/platforms/weixin.py)
- Feishu/Lark plugin：[`plugins/platforms/feishu/adapter.py`](../../plugins/platforms/feishu/adapter.py)
- 平台配置向导：[`hermes_cli/gateway.py`](../../hermes_cli/gateway.py)
- Weixin 用户接入说明：[`website/docs/user-guide/messaging/weixin.md`](../../website/docs/user-guide/messaging/weixin.md)
- Feishu/Lark 用户接入说明：[`website/docs/user-guide/messaging/feishu.md`](../../website/docs/user-guide/messaging/feishu.md)
- Toolset 与权限说明：[`toolsets.py`](../../toolsets.py)
