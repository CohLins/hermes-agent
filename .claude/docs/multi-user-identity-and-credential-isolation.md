# 新 Agent 平台的多用户身份关联与凭证隔离结论

> 调研结论，仅记录方案，未修改运行代码。
>
> 调研范围：飞书助手身份关联、BIT SSO Cookie、lark-cli 用户授权、MCP Key/OAuth Token 及相关个人配置的多用户隔离。

## 1. 核心结论

新平台需要把“平台用户”和“飞书助手收到消息的用户”关联到同一个内部身份 `principal_id`，再以 `principal_id` 作为所有个人凭证和运行时资源的隔离边界。

```text
新平台登录用户 ───────┐
                      ├── principal_id = user_42
飞书助手消息发送者 ───┘

principal_id = user_42
  ├── lark-cli 用户授权
  ├── BIT SSO Cookie
  ├── MCP OAuth Token
  ├── MCP 个人 API Key
  └── 其他个人配置
```

不能继续以飞书 profile 的单份 `.env`、单份 `~/.cache` 或单个长驻 MCP 进程承载所有人的身份，否则不同用户仍会共享下游权限。

## 2. “关联”是什么

关联不是简单记录一个用户名，而是在数据库中保存一条经过验证的身份映射：

```text
principal_id       = user_42       # 新平台内部稳定主键
feishu_union_id    = on_xxx        # 飞书开发者域稳定 ID
feishu_user_id     = u_xxx         # 飞书租户域 ID（如可用）
feishu_open_id     = ou_xxx        # 飞书应用域 ID
sso_subject/email  = ...           # BIT SSO/Casdoor 身份
bound_at           = ...
bound_by           = oidc_email | bind_code | admin
revoked_at         = NULL
```

后续两个入口都先解析 `principal_id`：

```text
飞书消息 → sender ID → 关联表 → principal_id
平台请求 → 已认证平台 Session → principal_id
```

### 推荐的建立方式

#### 方案 A：统一 SSO 登录后自动匹配

1. 用户在新平台通过 BIT SSO/Casdoor OIDC 登录。
2. 平台获得经过 SSO 签名/验证的 `sub`、邮箱等身份声明。
3. 通过飞书通讯录按企业邮箱查询对应飞书用户。
4. 写入 `principal_id ↔ feishu_union_id` 关联。

优点：用户操作少，登录身份和 BIT SSO Cookie 所需身份天然一致。

前提：飞书账号邮箱和 SSO 邮箱一致，且通讯录 API 能返回所需飞书 ID。

#### 方案 B：一次性绑定码兜底

1. 用户登录平台后点击“绑定飞书”。
2. 平台生成一次性随机绑定码，并关联平台用户。
3. 用户在飞书私聊助手发送 `/bind <code>`。
4. 飞书事件中的发送者 ID由飞书提供，平台验证绑定码后写入关联表。
5. 绑定码立即失效。

这种方式不依赖邮箱一致性。Hermes 已有 `gateway/pairing.py`，包含随机码、过期、限流、失败锁定和安全落盘等实现基础；但现有 PairingStore 解决的是“是否允许使用助手”，记录中没有新平台账号字段，因此不能直接等同于完整身份关联。

建议采用：**统一 SSO 邮箱自动匹配为主，一次性绑定码为兜底，管理员手工绑定作为异常处理手段**。

## 3. 飞书助手当前身份信息

飞书适配器会接触三类用户 ID（`plugins/platforms/feishu/adapter.py:4655-4680`）：

| ID | 作用域 | 稳定性及注意事项 |
|---|---|---|
| `open_id` | 飞书应用域 | 换 bot 应用可能变化，但通常容易取得 |
| `user_id` | 飞书租户域 | 同一企业内较稳定，需要相应权限 |
| `union_id` | 飞书开发者域 | 同一开发者下跨应用稳定，适合身份关联 |

Hermes 当前将 `user_id`（不存在时回退到 `open_id`）放入 `SessionSource.user_id`，将 `union_id` 放入 `user_id_alt`。网关 turn 会把 primary ID 注入 `HERMES_SESSION_USER_ID`（`gateway/run.py:16497`），但 `user_id_alt` 目前不是同一环境变量协议的一部分。

因此：

- **不要把 `HERMES_SESSION_USER_ID` 直接当作长期平台主键**；它可能是租户域 ID，也可能是应用域 `open_id`。
- 关联表应优先保存 `union_id`，同时保存 `user_id`/`open_id` 作为当前应用和租户内的查找索引。
- 真正的隔离目录应使用新平台内部稳定的 `principal_id`，不直接使用飞书 ID。

## 4. BIT SSO Cookie 隔离

当前 SSO skill 的共享状态目录是：

```text
~/.cache/sso-bit/
  storage-state.json
  state.json
  mfa.txt
  debug/
  login-events.jsonl
```

相关下游还使用：

```text
~/.cache/bit-log-search/{,uat,test}/auth.json
~/.cache/archery/auth.json
~/.cache/archery/schema-cache.json
```

SSO 脚本和下游脚本均支持环境变量覆盖状态路径，例如：

- `SSO_BIT_STATE_DIR`
- `SSO_BIT_STORAGE_STATE`
- `BIT_LOG_*_CACHE_DIR` / `BIT_LOG_*_AUTH_FILE`
- `ARCHERY_CACHE_DIR` / `ARCHERY_AUTH_FILE` / `ARCHERY_SCHEMA_CACHE`

SSO 的锁文件、generation 文件也由状态目录派生（`sso_bit_login.py:1011-1048`），因此为每个用户切换到独立状态目录后，登录锁和 Cookie 写入也会自然分开。

推荐布局：

```text
~/.hermes/profiles/feishu/users/<principal_id>/
  sso/
    storage-state.json
    state.json
    mfa.txt
    debug/
  bit-log-search/
  archery/
```

用户请求没有解析出 `principal_id` 时，应拒绝使用个人 SSO 状态，不能回退到公共 `~/.cache/sso-bit/` 或上一个用户的 Cookie。

### 重要限制

OIDC 登录成功拿到的是平台用于识别用户的 ID Token/Access Token，不一定等于 Casdoor 浏览器会话 Cookie `casdoor_session_id`。因此必须确认以下之一：

1. Casdoor 是否支持可交换为浏览器会话的 Token 流程；或
2. 每个用户首次通过浏览器/MFA 完成一次登录，生成自己的 `storage-state.json`。

## 5. lark 用户授权隔离

当前 lark-cli 使用用户级 OAuth 授权时，机器上只有一份有效用户身份（实测 `auth list` 只有一个用户）。`lark-cli auth status --json --verify` / `whoami` 显示的是当前有效的 user token。

lark-cli 的配置位于用户 HOME 下。将 HOME 改为一个新的目录后，lark-cli 会看到全新的未配置环境（已用临时 HOME 探针验证）。因此可以按 `principal_id` 隔离：

```text
users/<principal_id>/home/
  .lark-cli/
    config.json
    cache/
    locks/
```

每个用户第一次访问自己的文档、云盘、日历、邮箱等资源时，在该用户的 HOME 下单独走：

```text
lark-cli auth login --domain docs --no-wait --json
# 用户在浏览器完成授权
lark-cli auth login --device-code <device_code>
```

### Bot 身份和 User 身份必须区分

- `--as bot`：应用身份；不能代表用户访问其个人文档、云盘、日历、邮箱。
- `--as user`：用户 OAuth 身份；只能在当前请求已绑定 `principal_id` 并完成该用户授权时使用。

建议：

- 公共知识库、应用自己的资源、应用发消息：使用 bot 身份。
- “我的文档”“我的云盘”“我的日历”“我的邮箱”等个人资源：使用对应 `principal_id` 的 user 身份。
- 没有 `principal_id` 时，禁止使用 user 身份，也禁止回落到机器上最近一次登录的人。

Hermes 已有子进程 HOME 契约：`hermes_constants.py:789-832` 的 `get_subprocess_home()` / `apply_subprocess_home_env()`，以及 `tools/environments/local.py:481-482` 的应用链路。后续可扩展为按用户设置 HOME；但不能依赖模型记住手工设置环境变量，必须在框架/进程启动层强制注入。

## 6. MCP Key 和 OAuth Token 隔离

MCP 凭证不能只按 `server_name` 共享，应该按：

```text
(profile_name, principal_id, mcp_server_name)
```

或对于跨 profile 的统一平台按：

```text
(principal_id, mcp_server_name)
```

### 6.1 当前静态 Key 的共享原因

MCP 配置通常写在 profile 的 `config.yaml`，例如：

```yaml
mcp_servers:
  mcp-atlassian:
    env:
      JIRA_USERNAME: ${JIRA_USERNAME}
      JIRA_API_TOKEN: ${JIRA_API_TOKEN}
```

`${VAR}` 插值由 `tools/mcp_tool.py:403-419` 处理，stdio MCP 的环境由 `tools/mcp_tool.py:426-446` 和 `2212-2233` 构造。当前变量来自进程级 `.env`，所以所有用户拿到同一份 Key。

### 6.2 静态 Key 的正确处理

个人 Key 应按用户存储：

```text
credential_store/
  users/<principal_id>/
    mcp-atlassian/JIRA_API_TOKEN
    github/GITHUB_PERSONAL_ACCESS_TOKEN
```

公共服务账号可以单独存放：

```text
credential_store/
  shared/
    mcp-atlassian/JIRA_SERVICE_TOKEN
```

MCP 配置只保存凭证引用，不保存个人 Key：

```yaml
mcp_servers:
  mcp-atlassian:
    credential_scope: user
    credential_ref: jira.personal_token

  company-search:
    credential_scope: shared
    credential_ref: company-search.service_token
```

运行时规则：

- `credential_scope: user` 必须有当前 `principal_id`，否则拒绝。
- `credential_scope: shared` 可以在系统任务或未绑定用户时使用，但必须在审计中记录真实调用方（如已知）。
- Key 不得写入模型上下文、会话历史、普通日志或工具返回值。

### 6.3 MCP 长驻进程必须按用户拆分

当前 MCP server 在 `tools/mcp_tool.py:3169` 以全局 `_servers` 保存，stdio MCP 启动时会把环境变量传给长驻子进程（`tools/mcp_tool.py:2212-2233`）。

因此仅仅在每次工具调用时修改 `os.environ` 是无效且危险的：长驻进程可能已经持有另一个用户的 Key。

个人凭证的 MCP 实例缓存键应从：

```text
server_name
```

改成：

```text
(principal_id, server_name, config_fingerprint)
```

结果类似：

```text
(user_42, mcp-atlassian) → 使用 user_42 Key 的独立 MCP 子进程
(user_99, mcp-atlassian) → 使用 user_99 Key 的独立 MCP 子进程
(shared, company-search) → 公共服务账号 MCP 子进程
```

MCP OAuth Token 也必须使用相同的 scope。当前 OAuth Token 默认存放在 `HERMES_HOME/mcp-tokens/`（`tools/mcp_oauth.py:134-145`），现状是 profile 级；后续应扩展为 `users/<principal_id>/mcp-tokens/`，同时让 OAuth manager 的内存缓存、刷新锁和连接实例都包含 `principal_id`。

## 7. 统一的推荐目录和作用域

```text
~/.hermes/profiles/feishu/
  config.yaml                    # 公共配置和 MCP 定义，不放个人 Key
  .env                           # 仅保留 profile/服务级配置，不放个人凭证
  users/
    <principal_id>/
      metadata.json              # 关联状态，不存明文密码
      home/
        .lark-cli/               # lark-cli 配置和该用户的 OAuth token
      sso/
        storage-state.json       # BIT SSO Cookie
        state.json
      mcp-tokens/                # 该用户的 MCP OAuth Token
      credentials/               # 该用户的静态 Key（应加密或接入 Secret Manager）
      logs/
  shared/
    credentials/                 # 公司公共服务账号凭证
```

目录只是组织形式，不能替代访问控制。凭证存储至少需要：

- 目录 0700、文件 0600；
- 最好使用系统 Keychain、Vault 或加密数据库；
- 日志、异常、debug 页面和模型上下文脱敏；
- 凭证读取和刷新操作带锁；
- 用户解绑后撤销 Token、删除/归档 Cookie，并使旧连接失效。

## 8. 请求处理的统一链路

```text
1. 收到平台或飞书请求
2. 校验入口身份
3. 解析并校验 principal_id
4. 在当前 turn 的 ContextVar 中绑定 principal_id
5. 子进程启动层注入该用户的 HOME/凭证 scope
6. 根据资源类型选择：
   - bot scope：公共应用身份
   - user scope：当前 principal_id 的个人授权
   - shared scope：公司公共服务账号
7. 使用带 principal_id 的 MCP/SSO/lark 实例缓存
8. 执行操作并记录审计
9. turn 结束时清理 ContextVar，不保留跨请求状态
```

推荐增加一个不可伪造或不可由模型自行指定的请求身份字段，例如由已认证平台 Session 或内部签名头传递，而不是让模型通过普通参数传入 `principal_id`。

## 9. 必须避免的方案

- 所有人共用 `~/.cache/sso-bit/storage-state.json`。
- 所有人共用 profile `.env` 中的个人 SSO、JIRA、GitHub 等 Key。
- 使用 `open_id` 直接作为永久内部主键。
- 没有当前用户时回退到“上一次登录用户”。
- 只切换 HOME，却继续复用按 `server_name` 缓存的长驻 MCP 进程。
- 在每次调用前临时修改进程级 `os.environ`，试图改变已经启动的 MCP server 身份。
- 把 `X-Hermes-Session-Key` 当作用户认证凭据；它是会话连续性标识，不是身份认证。
- 让模型自行决定使用哪个用户的 `principal_id` 或凭证。

## 10. 现有代码基础与主要缺口

### 已有基础

- 飞书事件已有 `user_id`、`user_id_alt(union_id)` 等身份字段。
- `HERMES_SESSION_USER_ID` 已通过 ContextVar 绑定并透传到子进程。
- `tools/environments/local.py` 已有跨会话环境变量防泄漏逻辑。
- SSO、Archery、bit-log 等脚本已有状态路径环境变量覆盖。
- SSO 锁和 generation 文件随状态目录派生。
- `lark-cli` 已支持 user OAuth 和独立 profile/HOME 下的配置。
- MCP OAuth 已有独立 token 目录和 manager。
- Hermes 已有 profile 级 secret scope、dashboard auth 和多 profile 运行时 scope，可作为扩展基础。
- cron 已保存创建者的 `origin.user_id`，并已有按用户隔离 cron 的实现先例。

### 主要缺口

1. 需要新平台的 `principal_id` 与飞书 ID 的持久化关联表。
2. `principal_id` 需要从已认证平台入口传入整个 agent turn；不能由模型参数决定。
3. 当前 `api_server` 的 `_bind_api_server_session()`（`gateway/platforms/api_server.py:4591-4620`）没有绑定 `user_id`，独立平台若通过 api_server 接入，需要补充可信身份传递协议。
4. 当前 MCP 全局实例和错误/缓存状态主要按 `server_name`，需要加入用户 scope。
5. 当前 MCP 静态 Key 主要来自 profile 级环境变量，需要增加 user/shared credential resolver。
6. 当前 `HERMES_HOME`/lark-cli HOME 默认是 profile 或 OS 用户级，需要增加 `principal_id` 级 HOME 运行时注入。
7. cron 执行会清空 `HERMES_SESSION_*`（`cron/scheduler.py:2939-2990`），若要求 cron 使用创建者的个人凭证，需要显式保存并恢复 creator scope，而不是直接恢复普通消息上下文。
8. 需要明确 BIT SSO OIDC Token 与浏览器 Cookie 是否可以互换；否则每个用户需要一次首次浏览器登录。

## 11. 推荐实施顺序

1. **先定身份协议**：建立 `principal_id`，完成新平台 Session ↔ 飞书 `union_id` 的绑定、解绑、审计。
2. **先做 fail-closed**：没有 `principal_id` 时禁止 user-scoped lark、SSO、MCP 凭证。
3. **先隔离 lark 和 SSO 文件状态**：按用户注入 HOME/状态目录，验证并发请求不会串 Cookie 和 OAuth token。
4. **再做 MCP credential scope**：区分 `user`、`shared`、必要时 `bot`，禁止个人 Key 进入公共 `.env`。
5. **最后拆 MCP 长驻实例**：实例缓存、OAuth manager、刷新锁、重连逻辑统一使用 `(principal_id, server_name)`。
6. **补齐 cron 和后台任务**：明确后台任务是使用创建者个人身份，还是只能使用 shared 服务账号。
7. **增加并发和越权测试**：至少覆盖用户 A/B 同时请求、A 的 token 失效、解绑后旧连接、无 principal_id、shared MCP、cron creator scope 等场景。

## 12. 最终判断

技术上可以实现完整的用户维度隔离，且 Hermes 现有代码已经具备不少基础设施。但这不是单纯修改某个 skill 的路径问题，而是一个统一的身份作用域问题：

```text
可信登录/绑定
  → principal_id
  → ContextVar 传播
  → user/shared/bot credential scope
  → 文件状态隔离
  → 长驻连接实例隔离
  → 审计与解绑
```

只做 Cookie 隔离而不隔离 lark OAuth、MCP Key 和 MCP 长驻实例，仍然会发生用户权限混用；只做文件目录隔离而不建立可信 `principal_id`，也无法证明哪个用户应该使用哪个目录。
