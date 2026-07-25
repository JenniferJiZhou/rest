# 飞书 / 钉钉真实账号 Demo 验证

本 Runbook 面向比赛 Demo 操作员，Windows PowerShell 优先。目标是在指定
Windows 电脑上，用飞书或钉钉官方 CLI 完成真实用户授权，并验证：

```text
真实 provider -> 官方 CLI -> Hush Connector -> StepFun -> Hush Inbox
```

最后一步发送是可选的高风险操作。只有操作员在 Hush 中人工核对目标与最终草稿
后，才可临时启用一次发送。

> 状态声明：本文只提供验证步骤，不代表任何真实账号已经完成授权或验证。

## 1. 适用范围、非目标与完成标准

### 适用范围

- 比赛 Demo 前，在指定电脑验证一个或两个真实 provider：飞书、钉钉。
- 验证真实消息只读同步、StepFun 摘要/待办/草稿、会话聚合和 checkpoint 恢复。
- 人工确认后，对已核对的单个 Hush item 执行一次 guarded send。
- 操作员可以不熟悉后端，但必须能使用 PowerShell、Hush UI 和 provider 客户端。

### 非目标

- 不验证生产部署、长期凭证轮换、批量账号或批量发送。
- 不把 Outlook 或 QQ 邮箱作为比赛 Demo 的阻塞条件；对应配置可以留空。
- 不通过本文导出、查看或记录 provider token。
- 不证明飞书或钉钉真实账号已经验证；只有实际执行并记录无敏感信息的结果后，
  才能判断当次验证是否完成。

### 完成标准

当前 provider 只有同时满足以下条件才算完成：

- 官方 CLI 已对真实目标账号授权，且一次性网络 preflight 通过。
- read smoke 返回 `sync_ready=true`、`stepfun_summary=true` 和
  `private_id_fields=false`。
- Hush 中可见正确的 provider/会话标签、摘要、待办和可编辑草稿。
- 群聊形成一个持续演进的 digest；按 exact revision acknowledge 后，新消息形成
  下一张卡；重启后 checkpoint 延续且无重复卡。
- 回复目标证据和需要的 `@` target 已在 Hush 中人工核对。
- 发送只在人工核对后临时设置 `HUSH_SMOKE_ALLOW_SEND=true`，只执行一次，并在
  真实客户端确认送达。

## 2. 安全规则

以下内容不得提交到 Git，不得粘贴到聊天、Issue、共享终端记录或本文，也不得
写入比赛证据表：

- OAuth access token、refresh token。
- 授权 URL、device code 或浏览器授权页面内容。
- StepFun API key。
- 真实消息正文、摘要、待办或草稿内容。
- 真实用户、账号、corp、会话或 provider ID。
- 本地 Hush token。
- 含账号、姓名、消息、授权信息或 ID 的截图。

`HUSH_APP_TOKEN` 和 `HUSH_CONNECTOR_TOKEN` 是两个不同的本地 Hush HTTP API
token，不是飞书/钉钉 token。每个值使用 32 到 128 个字符，两个值不得相同：

- `HUSH_APP_TOKEN`：供 Hush App 和本 Runbook 的 smoke 命令访问 App API。
- `HUSH_CONNECTOR_TOKEN`：供 Connector API 使用，不要拿它代替 App token。

provider 登录态只保存在官方 CLI 自己的本地凭证存储中。不要把 provider token
复制到 `.env`，也不要用脚本从 CLI 凭证存储中提取它。

其他安全要求：

- 测试消息只能使用临时、无敏感含义的内容。
- PowerShell 中只使用本文的占位符；实际 secret 只输入指定电脑的本地 `.env`
  或当前进程环境。
- read smoke 不输出正文或 ID，也绝不发送消息。
- guarded send 遇到结果 `unknown`、超时或连接中断时，不要自动重试；先在真实
  客户端和 Hush 中人工确认状态。

## 3. Windows 准备

除非小节另有说明，本 Runbook 的仓库命令都从当前 worktree 的
`<repository-root>` 或其 `server` 目录执行。不要在另一份 clone 中混用 `.env`
和 CLI 登录态。

### 3.1 检查工具与分支

执行目录：`<repository-root>`

```powershell
Set-Location "<repository-root>"

node --version
corepack pnpm --version
git branch --show-current
git status --short
```

继续前确认：

- Node 为 `20.19.x`。
- pnpm 为 `9.15.9`。
- 当前分支为 `feat/w2/unified-inbox-implementation`。
- `git status --short` 中没有来源不明的 secret、`.env` 或真实验证产物。

不要为运行本 Runbook 清理或覆盖其他人的未提交改动。

### 3.2 安装仓库依赖

执行目录：`<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"
corepack pnpm install --frozen-lockfile
```

### 3.3 创建本地 `.env`

配置文件位置：`<repository-root>\.env`，不是
`<repository-root>\server\.env`。从仓库的 `.env.example` 创建本机文件并只填
占位符对应的本地真实值；不得提交 `.env`。

下面示例刻意不包含任何真实 secret 或真实 ID：

```dotenv
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
PUBLIC_BASE_URL=http://127.0.0.1:3000
TRUST_PROXY=false

HUSH_APP_TOKEN=<32-to-128-character-local-app-token>
HUSH_CONNECTOR_TOKEN=<different-32-to-128-character-local-connector-token>

INBOX_STEPFUN_API_KEY=<local-stepfun-api-key>
INBOX_STEPFUN_TIMEOUT_MS=15000
INBOX_POLL_INTERVAL_MS=30000
INBOX_INITIAL_LOOKBACK_MINUTES=60
INBOX_SYNC_BATCH_LIMIT=100

LARK_CLI_PATH=<absolute-path-to-lark-cli-executable>
LARK_ACCOUNT_ID=feishu-demo

DWS_CLI_PATH=<absolute-path-to-dws-executable>
DINGTALK_ACCOUNT_ID=dingtalk-demo
```

说明：

- `LARK_ACCOUNT_ID=feishu-demo` 和
  `DINGTALK_ACCOUNT_ID=dingtalk-demo` 只是 Hush 本地稳定标签，不是 provider
  account ID、corp ID、用户 ID、会话 ID 或 token。
- 只验证一个 provider 时，只配置该 provider 的 `*_CLI_PATH` 和
  `*_ACCOUNT_ID` 即可；另一个 provider 可以留空。
- Outlook 的 `OUTLOOK_ACCOUNT_ID`、`OUTLOOK_ACCESS_TOKEN` 和 QQ 的
  `QQ_EMAIL_ADDRESS`、`QQ_EMAIL_AUTH_CODE` 可以留空，不阻塞本次验证。
- `LARK_CLI_PATH` 和 `DWS_CLI_PATH` 必须是当前 Windows 电脑上的绝对可执行文件
  路径。可用 `Get-Command lark-cli` 或 `Get-Command dws` 查找路径，但不要把
  输出中的用户目录或其他本机信息写入证据表。
- `INBOX_STEPFUN_TIMEOUT_MS=15000` 表示每次 AI 请求最多等待 15 秒。

## 4. Provider 官方 CLI 授权与 preflight

只执行要验证的 provider 小节。授权和 preflight 可以在任意目录运行；为减少
混淆，下面统一在 `<repository-root>` 执行。授权流程出现 URL 或 device code
时只在指定电脑上完成，不截图、不复制、不共享。

### 4.1 飞书

执行目录：`<repository-root>`

```powershell
Set-Location "<repository-root>"

npx @larksuite/cli@latest install
lark-cli config init --new
lark-cli auth login --scope "search:message im:message.reactions:read im:message.send_as_user im:message"
```

以比赛 Demo 使用的真实个人账号完成浏览器授权。授权 scope 必须精确包含：

```text
search:message
im:message.reactions:read
im:message.send_as_user
im:message
```

授权完成后执行一次 preflight：

```powershell
lark-cli --version
lark-cli auth status --json --verify
```

只有输出表明 effective identity 为 `user`，且 `--verify` 网络校验成功时才能
继续。不要把 JSON 输出粘贴到证据表，因为不同 CLI 版本可能包含本机或账号
信息。

`--verify` 只用于这次 preflight：它通过网络验证官方 CLI 本地保存的登录态，
不会要求操作员打印 token。Hush Connector 的日常 poll 只调用
`lark-cli auth status --json`，不会加 `--verify`。

### 4.2 钉钉

执行目录：`<repository-root>`

```powershell
Set-Location "<repository-root>"

irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex
dws auth login
```

没有浏览器交互能力的 headless 电脑可改用：

```powershell
dws auth login --device
```

device code 和授权 URL 只在指定电脑上使用，不复制、不截图、不记录。

如果 CLI 提示 access disabled，管理员必须进入：

```text
DingTalk Developer Platform -> CLI Access Management
```

开启 CLI access，并审批该真实账号的请求。权限或 entitlement 未获批时不要把
空结果误判为“没有消息”。

授权完成后执行一次 preflight：

```powershell
dws version
dws auth status --format json
dws profile list --format json
```

只有以下条件同时成立才继续：

- 目标 profile 是 current profile。
- `authenticated=true`。
- refresh token 有效。

不要把 status/profile JSON 粘贴到证据表。`dws auth status` 可能刷新已过期的
access token，因此只把它作为一次性 preflight；Hush Connector 的 poll 不应
额外运行人工 preflight。

## 5. 准备无敏感测试消息

操作位置：第二参与者的真实飞书或钉钉客户端。

1. 由第二参与者向目标账号发送一条单聊消息。
2. 再在目标账号所在的测试群发送一条群聊消息。
3. 内容使用临时、无敏感含义的短句，不包含真实项目、客户、人员或凭证信息。
4. 至少一条消息应包含一个明确、无风险的临时行动请求，以便人工验证 StepFun
   生成非空待办；不要使用真实业务任务。
5. 两条消息必须在启动验证前 60 分钟内发送，以落入
   `INBOX_INITIAL_LOOKBACK_MINUTES=60` 的初始 lookback。
6. 记录“已准备单聊/群聊”即可，不记录正文、成员、群名、时间戳或任何 ID。

## 6. 两个 PowerShell 终端启动

先打开现有 Hush App，并保持可查看 Inbox。然后使用两个 PowerShell 终端。

### 6.1 终端 A：启动 server

执行目录：`<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"
corepack pnpm dev
```

保持终端 A 运行。server 启动后会按 `INBOX_POLL_INTERVAL_MS=30000` 轮询已配置
的 provider。

### 6.2 终端 B：检查进程并设置 smoke 会话

执行目录：`<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"

Invoke-RestMethod "http://127.0.0.1:3000/v1/health"

$env:HUSH_BASE_URL = "http://127.0.0.1:3000"
$env:HUSH_APP_TOKEN = "<same-local-HUSH_APP_TOKEN-from-dotenv>"
```

`/v1/health` 只证明 Hush server 进程活着并能响应 HTTP；它不检查 provider CLI
登录、权限、同步、StepFun、消息卡或发送能力。必须继续执行 read smoke。

## 7. 只读端到端 smoke

所有命令都在终端 B 的 `<repository-root>\server` 执行。read smoke 会读取
`HUSH_BASE_URL` 和 `HUSH_APP_TOKEN`，检查 sync status 和公开 Inbox 卡片。
它不打印消息正文、摘要、草稿、姓名、账号 ID、会话 ID、item ID 或 provider
ID，也不会调用任何发送接口。

### 7.1 飞书 read smoke

执行目录：`<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"
corepack pnpm smoke:inbox -- --provider feishu --mode read
```

### 7.2 钉钉 read smoke

执行目录：`<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"
corepack pnpm smoke:inbox -- --provider dingtalk --mode read
```

成功输出是经过清洗的一行。实际 CLI 用 `--mode read`，输出以 `stage=read`
表示这一模式；形状如下：

```text
PASS provider=<feishu-or-dingtalk> stage=read card_count=<positive-integer> sync_ready=true conversation_metadata=true stepfun_summary=true needs_reply=<true-or-false> draft_present=<true-or-false> private_id_fields=false
```

字段含义：

- `provider`：本次检查的 provider；必须与命令一致。
- `mode`：命令的 `--mode read`，对应输出中的 `stage=read`。
- `card_count`：该 provider 的公开卡片数量，必须大于 0。
- `sync_ready=true`：找到该 provider 的 ready sync status。
- `conversation_metadata=true`：卡片包含公开会话类型、显示名、聚合窗口等契约
  字段；不代表输出了私有 ID。
- `stepfun_summary=true`：所有被检查卡片都有非空摘要。
- `needs_reply`：至少一张卡是否需要回复，可以是 `true` 或 `false`。
- `draft_present`：每张需要回复的卡都有草稿；当 `needs_reply=true` 时必须为
  `true`。
- `private_id_fields=false`：未在公开卡片中发现 provider 私有 ID 字段。

仅有 `PASS` 仍不等于完整验收；继续在 Hush UI 做人工验证。

## 8. Hush UI 人工验证

操作位置：指定电脑上的 Hush App。不要截图真实消息或 ID。

按顺序核对：

1. 卡片 provider 标签与当前验证的飞书/钉钉一致。
2. 单聊和群聊的显示会话标签可理解，且没有显示 provider 原生私有 ID。
3. 同一群聊在 acknowledge 前只有一个 evolving group digest，后续群消息更新
   该 digest 的 `revision` 和 `message_count`，不会每条消息创建一张重复卡。
4. 摘要非空；重要点/待办区域可查看，并至少有一个与临时行动请求对应的非空
   待办。
5. 需要回复的卡显示 reply target evidence，操作员能判断回复对象与原因。
6. 需要回复的卡存在草稿，且草稿可以在 Hush 中编辑并保存。
7. 打开当前 group digest，使用界面显示的 exact revision 执行 acknowledge。
   revision 已变化时不要确认旧 revision，应刷新并重新核对。
8. acknowledge 后由第二参与者再发一条无敏感群消息。等待一个 poll 周期，必要时
   重跑相同 provider 的 read smoke，确认新消息产生下一张 digest 卡。
9. 停止终端 A 的 server，再从 `<repository-root>\server` 重新执行
   `corepack pnpm dev`。等待同步后确认 checkpoint 延续，已有 digest/卡片没有
   丢失，也没有因为重启产生重复卡。

发送前，必须再次核对当前卡的 provider、显示会话、最终草稿和所有 `@` target。

## 9. 人工确认后的 guarded send

这是唯一会发送真实消息的步骤。没有现场人工确认时跳过本节，read smoke 的完成
不要求自动发送。

### 9.1 发送前四项核对

操作位置：Hush App。

- provider 正确。
- 显示会话正确。
- 最终草稿已编辑并逐字核对。
- 所有 `@` target 正确；没有多余或缺失的对象。

从 Hush 当前界面取得公开 item id，仅在命令占位符位置使用。不要把 item id
写入 `.env`、文档、证据表、聊天或提交记录。

### 9.2 飞书单次发送

执行目录：终端 B 的 `<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"

$env:HUSH_SMOKE_ALLOW_SEND = "true"
try {
  corepack pnpm smoke:inbox -- --provider feishu --mode send --item-id <item-id-shown-by-Hush>
} finally {
  Remove-Item Env:HUSH_SMOKE_ALLOW_SEND -ErrorAction SilentlyContinue
}
```

### 9.3 钉钉单次发送

执行目录：终端 B 的 `<repository-root>\server`

```powershell
Set-Location "<repository-root>\server"

$env:HUSH_SMOKE_ALLOW_SEND = "true"
try {
  corepack pnpm smoke:inbox -- --provider dingtalk --mode send --item-id <item-id-shown-by-Hush>
} finally {
  Remove-Item Env:HUSH_SMOKE_ALLOW_SEND -ErrorAction SilentlyContinue
}
```

smoke 会为这一次操作创建短期 confirmation，并为 send 生成新的 idempotency
key。`HUSH_SMOKE_ALLOW_SEND` 必须只存在于这次 `try/finally` 的当前 PowerShell
进程中，永远不要写入 `.env`。

成功行形状如下，不包含正文或 ID：

```text
PASS provider=<feishu-or-dingtalk> stage=send sent=true confirmation=true idempotency_fresh=true
```

命令结束后必须：

1. 确认 `Get-Item Env:HUSH_SMOKE_ALLOW_SEND -ErrorAction SilentlyContinue`
   没有返回值。
2. 在真实飞书/钉钉客户端确认消息只送达一次，目标会话和 `@` 对象正确。
3. 只在确认送达后记录 guarded send 为通过。

如果 CLI、HTTP 或 provider 返回超时、连接中断或状态 `unknown`，不要再次执行
send。先在真实客户端检查是否已经送达，再由现场负责人决定后续处理。

## 10. 故障排查

| 现象或错误 | 含义 | 操作 |
| --- | --- | --- |
| `HUSH_SMOKE_NETWORK_ERROR` | smoke 无法访问 `HUSH_BASE_URL` | 确认终端 A 正在运行；重跑 `/v1/health`；核对 `HUSH_BASE_URL`，不要改为外网地址。 |
| `HUSH_SMOKE_CONFIG_INVALID` | 当前 PowerShell 缺少 smoke 所需环境变量 | 在终端 B 重新设置 `HUSH_BASE_URL` 和 `HUSH_APP_TOKEN`；不要打印 token。 |
| `HUSH_SMOKE_SYNC_NOT_READY` | 目标 provider 没有 ready sync status | 核对官方 CLI preflight、`.env` 中 CLI 路径和本地 account label，再查看终端 A 的清洗后错误；不要反复重新授权。 |
| `HUSH_SMOKE_PROVIDER_CARD_MISSING` | 同步已 ready，但没有当前 provider 卡 | 确认测试消息在 60 分钟 lookback 内；等待至少一个 30 秒 poll 周期后重跑 read。 |
| `INBOX_AI_UNAVAILABLE` 且 `reason=timeout` | StepFun 超过 15 秒上限 | 保持 server 运行并等待 Connector backoff 后重试同步；核对网络和 StepFun 服务，不要无限阻塞当前请求。 |
| provider permission / entitlement 错误 | 官方 CLI 登录存在，但账号无消息读取或发送授权 | 飞书核对四个 scope 和组织审批；钉钉按 CLI 的 `friendly_hint` 或 `action_url` 由管理员处理 CLI Access Management/entitlement。不要把它当成空 Inbox。 |

AI 处理是 bounded wait，不是完全异步：一次摘要或草稿请求最多等待
`INBOX_STEPFUN_TIMEOUT_MS=15000`。超时会记录本次同步失败，Connector 使用
backoff 稍后再试，避免请求无限卡死；它不会因此自动发送消息。

其他判断：

- `/v1/health` 成功但 `SYNC_NOT_READY`：进程活着，provider 链路未通过。
- `stepfun_summary=true` 但 Hush 草稿缺失：先看 `needs_reply`；只有需要回复的卡
  才要求草稿。
- permission 修复后，重新执行官方 CLI preflight，再等待 poll；不要删除
  checkpoint 或本地状态文件。
- guarded send 返回未知结果时禁止自动重试，即使现场时间紧张也应先查真实
  客户端。

## 11. 比赛日执行 checklist

操作员逐项勾选；任何 secret、正文、账号名、会话名或 ID 都不要写在旁边。

- [ ] 在指定 Windows 电脑和正确 worktree 执行。
- [ ] Node `20.19.x`、pnpm `9.15.9`、目标分支均正确。
- [ ] `.env` 只在本机，两个 Hush token 不同且各为 32 到 128 字符。
- [ ] 只配置当前要验证的飞书/钉钉；Outlook/QQ 未阻塞。
- [ ] 官方 CLI 真实账号授权和一次性网络 preflight 通过。
- [ ] 第二参与者已准备 60 分钟 lookback 内的无敏感单聊和群聊。
- [ ] 终端 A server 运行，终端 B `/v1/health` 成功。
- [ ] read smoke 为 `PASS`，且 `sync_ready=true`。
- [ ] read smoke 为 `stepfun_summary=true`。
- [ ] read smoke 为 `private_id_fields=false`。
- [ ] Hush 摘要、待办、reply target evidence、可编辑草稿均已核对。
- [ ] evolving group digest、exact revision acknowledge、下一张卡均已核对。
- [ ] 重启后 checkpoint 延续且没有重复卡。
- [ ] 发送前四项人工核对完成，或明确跳过真实发送。
- [ ] 若发送，开关只在 `try/finally` 中临时启用，真实客户端只收到一次。
- [ ] 完成证据表和收尾，未记录正文、ID、token 或隐私截图。

## 12. 最小证据表

只记录下面七类信息。`Result` 使用 `PASS`、`FAIL` 或 `SKIPPED`；不要附命令原始
JSON、日志、截图、正文或 ID。

| Provider | Date-time | Official CLI preflight | Read smoke | Summary / draft UI | Guarded send | Operator initials |
| --- | --- | --- | --- | --- | --- | --- |
| `feishu` 或 `dingtalk` | `<local-date-time>` | `<PASS-or-FAIL>` | `<PASS-or-FAIL>` | `<PASS-or-FAIL>` | `<PASS-FAIL-or-SKIPPED>` | `<initials>` |

证据表不得记录：

- 消息正文、摘要、待办或草稿。
- 用户、账号、corp、会话、item、draft、message 或 provider ID。
- token、授权 URL、device code。
- CLI JSON 原始输出、server 日志或含隐私截图。

## 13. Rollback 与收尾

### 13.1 停止服务

操作位置：终端 A。

按 `Ctrl+C` 停止 `corepack pnpm dev`，确认端口不再由本次 server 占用。

### 13.2 清除当前 PowerShell 环境

操作位置：终端 B；目录不限。

```powershell
Remove-Item Env:HUSH_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:HUSH_APP_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:HUSH_SMOKE_ALLOW_SEND -ErrorAction SilentlyContinue
```

不要删除或提交 `<repository-root>\.env`；它属于指定电脑的本地配置，应按团队
secret 管理规则保管或由负责人安全移除。

### 13.3 按需退出官方 CLI

如果指定电脑不应保留 provider 登录态，使用当前已安装 CLI 版本的官方 logout
命令退出。先用 CLI help 确认命令，不要猜测参数：

```powershell
lark-cli auth --help
dws auth --help
```

只对本次真实账号执行 logout。退出后如需再次 Demo，必须重新完成对应 provider
的授权与 preflight。
