# 飞书 / 钉钉真实账号 macOS / iOS 黑客松 Demo 验证

本 Runbook 面向比赛 Demo 操作员。Mac 同时运行飞书/钉钉官方 CLI、Hush
Fastify server、Connector 和 StepFun；macOS App 在同一台 Mac 上通过 loopback
访问，iOS App 只通过受信任局域网访问这台 Mac：

```text
真实 provider -> 官方 CLI -> Hush Connector -> StepFun -> Hush Inbox API
                                                           -> macOS / iOS App
```

> 当前实现硬限制：`UnifiedInboxDemoStore.items = .fixture`。仓库内现有 SwiftUI
> 页面不连接真实 Unified Inbox API、不读取真实渠道、不执行真实发送，也没有可供
> 真实发送使用的真实 item id。它的“确认模拟发送”只更新本地状态。因此当前代码
> 最多取得 **Backend PASS**；Apple UI integration 和 guarded send 必须记录为
> `BLOCKED` 或 `SKIPPED`，不得记录为 `PASS`。

本文只提供执行步骤，不代表任何真实账号已完成授权或验证。CI、fixture、mock、
本地测试或编译通过都不能证明真实账号、真实 provider 链路或 Apple 真实 UI 已
验证。

## 1. 范围与完成标准

### 1.1 适用范围

- 在比赛用 Mac 上验证飞书、钉钉中的一个或两个真实账号。
- 验证官方 CLI 授权、真实消息只读同步、StepFun 摘要/待办/草稿、会话聚合和
  checkpoint 恢复。
- 在具备 API-connected Apple build 后，验证 macOS 同机 loopback 和 iOS
  trusted-LAN 两种客户端连接。
- 只有操作员在 App 内核对当前选中项并主动确认后，才允许一次 guarded send。
- Outlook 和 QQ 邮箱不是本次比赛 Demo 的阻塞条件，相关配置可以留空。

### 1.2 Backend PASS

每个 provider 只有同时满足以下条件才算 **Backend PASS**：

- 固定版本官方 CLI 已安装，目标真实账号授权成功，一次性网络 preflight 通过。
- read smoke 输出 `PASS provider=<provider> stage=read`。
- 同一输出包含 `sync_ready=true`、`stepfun_summary=true` 和
  `private_id_fields=false`。
- 输出和证据中没有正文、raw JSON、真实 ID 或其他私有字段。

`GET /v1/health` 只证明 Fastify 进程存活。它不访问 provider，不证明 Connector
ready，不证明 StepFun 成功，也不证明 Apple UI 已连接。

### 1.3 Full Demo PASS

**Full Demo PASS = Backend PASS + API-connected Apple build 的人工验收。**
该 Apple build 必须实际调用本 Runbook 验证的 Unified Inbox API，并完成：

- 真实列表和详情渲染，而不是 `.fixture`。
- group digest 的 exact-revision acknowledge。
- 草稿编辑并保存正确版本。
- 可见、可核对的 reply target 和所有 `@` target。
- App 内用户确认及真实发送，并在真实客户端确认只送达一次。
- macOS loopback 或 iOS trusted-LAN 对应的连接验收。

缺少 API-connected Apple build、build 仍使用 `.fixture`、或无法从 App 内安全
传递当前选中项时：

- Apple UI integration、summary/draft UI、guarded send 只能记
  `BLOCKED` 或 `SKIPPED`。
- 不得从 server 日志、raw API、CLI JSON、状态文件或其他调试输出抄取 item id
  绕过 App。
- Backend PASS 不得改写成 Full Demo PASS。

## 2. 安全与隐私规则

以下内容不得提交到 Git，不得粘贴到聊天、Issue、共享终端记录或证据表：

- OAuth access token、refresh token、StepFun API key。
- 授权 URL、device code 或浏览器授权页面内容。
- 真实消息正文、摘要、待办、草稿或发送内容。
- 真实用户、账号、corp、会话、provider、item、draft 或 message ID。
- 本地 Hush token。
- CLI raw JSON、server 日志或含账号、消息、授权信息、ID 的截图。

`HUSH_APP_TOKEN` 与 `HUSH_CONNECTOR_TOKEN` 是两个不同的本地 Hush HTTP API
token，不是 provider token。每个值必须为 32 到 128 个字符，且两者不得相同：

- `HUSH_APP_TOKEN` 供 Apple App 和本 Runbook 的 smoke 访问 App API。
- `HUSH_CONNECTOR_TOKEN` 只供 Connector API 使用。

provider 登录态只保存在官方 CLI 的本地凭证存储。不得将 provider token 写入
`.env`，也不得编写脚本提取 CLI 凭证。

其他规则：

- 只使用临时、无敏感含义的测试消息。
- 不在 shell 命令行中写 `HUSH_APP_TOKEN` 字面值，避免进入 shell history。
- 环境变量本身仍是敏感信息；只在当前 shell 使用并在收尾时 `unset`。
- read smoke 不输出正文或 ID，也绝不发送消息。
- 任何 `stage=send` 非 `PASS` 都属于歧义发送结果。遇到
  `INBOX_SEND_UNKNOWN`、`HUSH_SMOKE_SEND_NOT_CONFIRMED`、
  `HUSH_SMOKE_NETWORK_ERROR`、超时或连接中断，先查真实客户端，禁止直接重跑。
- 不在公共 Wi-Fi 上运行，不做路由器端口转发、隧道或公网暴露。

## 3. Mac 工具链与分支准备

除非小节另有说明，仓库命令都在当前 worktree 的 `<repository-root>` 或其
`server` 目录执行。不要混用另一份 clone 的 `.env` 或 CLI 登录态。

### 3.1 检查版本、分支和工作树

执行目录：`<repository-root>`

```bash
cd "<repository-root>"
node --version
corepack pnpm --version
git branch --show-current
git status --short
```

继续前确认：

- Node 为 `20.19.x`。
- pnpm 为 `9.15.9`。
- 当前分支为 `feat/w2/unified-inbox-implementation`。
- 工作树中没有来源不明的 `.env`、secret 或真实验证产物。

不要为了运行本 Runbook 清理、覆盖或提交其他人的改动。比赛日不要升级 Node、
pnpm、官方 CLI 或仓库依赖。

### 3.2 安装 server 依赖

执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
corepack pnpm install --frozen-lockfile
```

不得修改 lockfile，也不得改用非 frozen install。

## 4. 固定并校验官方 CLI

以下 integrity 值于 **2026-07-25** 查询。先从 npm registry 查询，再由操作员
逐字符人工精确比对；任何字符不同都必须停止，不得安装。

| Package | 固定版本 | Expected `dist.integrity` |
| --- | --- | --- |
| `@larksuite/cli` | `1.0.77` | `sha512-xsyUkGS6WsMmxiVHG7Qpl/U8vmi5qoZterAprAMBYQ0/lA5kMjUv5NL2pfDv/Krp2frQme/OtRjD5+jlEw0RPg==` |
| `dingtalk-workspace-cli` | `1.0.54` | `sha512-R1gNPwc7yVgU5VKbyI7FaYNjh2L2+/yBo7cdqEdrBP35Xcnm0yOjJcRbk/EEq31Sk60feSBoQ3RtKVhxwduW+Q==` |

### 4.1 查询 integrity

执行目录：`<repository-root>`

```bash
cd "<repository-root>"
npm view @larksuite/cli@1.0.77 dist.integrity
npm view dingtalk-workspace-cli@1.0.54 dist.integrity
```

只在两行结果分别与表中 expected 值精确一致后继续。不要把查询结果当作自动
信任，也不要把 registry 返回的其他 metadata 写入证据。

### 4.2 安装固定版本

执行目录：`<repository-root>`

```bash
cd "<repository-root>"
npx @larksuite/cli@1.0.77 install
npm install -g dingtalk-workspace-cli@1.0.54
```

禁止使用浮动版本、从可变分支下载执行脚本，或在比赛日临时升级。

安装后可在同一目录确认可执行文件位置；不要把包含本机用户名的绝对路径写入
证据表：

```bash
cd "<repository-root>"
command -v lark-cli
command -v dws
```

## 5. 本机 `.env` 配置

配置文件位置是 `<repository-root>/.env`，不是 `server/.env`。以
`.env.example` 为准创建本机文件；不得提交或共享。下面所有值均为占位符。
这不是 `.env.example` 的全量复制；未列出的非 Inbox 字段沿用默认值或留空，
不参与本验证。

### 5.1 macOS App 同机 loopback 模式

```dotenv
HOST=127.0.0.1
PORT=3000
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:3000
TRUST_PROXY=false

HUSH_APP_TOKEN=<32-to-128-character-local-app-token>
HUSH_CONNECTOR_TOKEN=<different-32-to-128-character-local-connector-token>
HUSH_DEMO_MODE=false
HUSH_DEMO_TOKEN=

INBOX_STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
INBOX_STEPFUN_MODEL=step-3.7-flash
INBOX_STEPFUN_API_KEY=<local-stepfun-api-key>
INBOX_STEPFUN_TIMEOUT_MS=15000
INBOX_POLL_INTERVAL_MS=30000
INBOX_INITIAL_LOOKBACK_MINUTES=60
INBOX_SYNC_BATCH_LIMIT=100
INBOX_STATE_FILE=.data/unified-inbox-state.json

LARK_CLI_PATH=<absolute-path-to-lark-cli-executable>
LARK_ACCOUNT_ID=feishu-demo
DWS_CLI_PATH=<absolute-path-to-dws-executable>
DINGTALK_ACCOUNT_ID=dingtalk-demo

OUTLOOK_ACCOUNT_ID=
OUTLOOK_ACCESS_TOKEN=
QQ_EMAIL_ADDRESS=
QQ_EMAIL_AUTH_CODE=

LOG_LEVEL=info
```

macOS App 的运行时 Base URL 必须是 `http://localhost:3000`。同机访问不需要
LAN listener。

### 5.2 iOS trusted-LAN 模式

只在 iPhone 与 Mac 位于同一受信任私人网络时，将上述配置的两行改为：

```dotenv
HOST=0.0.0.0
PUBLIC_BASE_URL=http://<mac-lan-ip>:3000
```

iOS App 的运行时 Base URL 必须是
`http://<mac-lan-ip>:3000`，不能使用 `localhost` 或 `127.0.0.1`，因为它们在
iPhone 上指向 iPhone 自身。

查找 Mac 当前接口和 LAN IP。执行目录：`<repository-root>`

```bash
cd "<repository-root>"
route -n get default
ipconfig getifaddr en0
```

若默认接口不是 `en0`，将第二条命令中的接口名替换为第一条命令显示的实际接口。
IP 只用于现场配置，不写入证据表、聊天或截图。

`HOST=0.0.0.0` 不是访问控制。只允许受信任局域网和本机防火墙中必要的入站
访问；不要使用公共 Wi-Fi，不要开放到公网。局域网 HTTP 不提供传输加密。
`docs/15_APPLE_MOCK_INTEGRATION_RELEASE.md` 只可参考 LAN Base URL、Local
Network permission 和 ATS 机制；它不证明当前真实 Inbox UI 已接入或通过。

配置说明：

- `LARK_ACCOUNT_ID` 与 `DINGTALK_ACCOUNT_ID` 只是 Hush 本地稳定标签，不是
  provider 账号、corp、用户或会话 ID。
- 只验证一个 provider 时，另一个 provider 的 CLI path 和 account label 可留空。
- `INBOX_STEPFUN_TIMEOUT_MS=15000` 将单次 AI 请求限制在 15 秒。
- `INBOX_POLL_INTERVAL_MS=30000`、`INBOX_INITIAL_LOOKBACK_MINUTES=60`、
  `INBOX_SYNC_BATCH_LIMIT=100` 分别控制 poll、初始 lookback 和 batch 上限。

## 6. Provider 授权与一次性 preflight

授权 URL、device code、status JSON 和 profile JSON 只在比赛用 Mac 本地查看，
不截图、不复制、不共享。preflight 可在任意目录运行；这里统一使用仓库根目录。

### 6.1 飞书

执行目录：`<repository-root>`

```bash
cd "<repository-root>"
lark-cli config init --new
lark-cli auth login --scope "search:message im:message.reactions:read im:message.send_as_user im:message"
```

scope 必须精确为以下四项，不增加也不减少：

```text
search:message
im:message.reactions:read
im:message.send_as_user
im:message
```

以比赛 Demo 的真实个人账号完成浏览器授权，然后执行一次 preflight：

```bash
cd "<repository-root>"
lark-cli --version
lark-cli auth status --json --verify
```

只有 effective identity 为 `user` 且 `--verify` 网络校验成功时才继续。不要把
JSON 输出粘贴到证据表。`--verify` 只用于这次 preflight；Connector 正常 poll
不执行它，而是调用 `im +messages-search` 拉取消息。

### 6.2 钉钉

执行目录：`<repository-root>`

```bash
cd "<repository-root>"
dws auth login
```

无浏览器交互时改用：

```bash
cd "<repository-root>"
dws auth login --device
```

若提示 CLI access disabled，管理员必须进入：

```text
DingTalk Developer Platform -> CLI Access Management
```

开启 CLI access 并审批目标真实账号。权限或 entitlement 未获批时，不得把空
结果误判为“没有消息”。

授权后执行一次 preflight：

```bash
cd "<repository-root>"
dws version
dws auth status --format json
dws profile list --format json
```

只有目标 profile 是 current profile、`authenticated=true` 且 refresh token
有效时才继续。不要记录 JSON。`dws auth status` 可能刷新过期 access token，
所以只放在 preflight，不放进 Connector polling loop。正常 poll 使用
`dws chat message list-all`。

## 7. 准备无敏感测试消息

操作位置：第二参与者的真实飞书或钉钉客户端。

1. 向目标账号发送一条单聊消息。
2. 在目标账号所在的测试群发送一条群聊消息。
3. 内容必须临时且无敏感含义，不包含真实项目、客户、人员、凭证或承诺。
4. 至少一条包含明确、无风险的临时行动请求，用于验证非空待办。
5. 两条消息都应在启动验证前 60 分钟内发送。
6. 证据只记“已准备 direct/group”，不记录正文、成员、群名、时间戳或 ID。

## 8. 启动 Mac server 与 backend read smoke

使用两个 Terminal 窗口。read smoke 不依赖 Apple UI；它可以在当前 fixture App
未改造时独立取得 Backend PASS，但不能证明 UI connected。

### 8.1 Terminal A：启动 server

执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
corepack pnpm dev
```

保持 Terminal A 运行。Connector 按配置的 poll interval 同步 provider。

### 8.2 Terminal B：liveness 与敏感 token 输入

loopback 模式执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
curl -fsS http://127.0.0.1:3000/v1/health
export HUSH_BASE_URL="http://127.0.0.1:3000"
printf 'HUSH_APP_TOKEN: '
read -s HUSH_APP_TOKEN
export HUSH_APP_TOKEN
echo
```

`read -s` 使 token 不回显，也不把字面值写入命令历史。macOS 自带 bash 与 zsh
均可执行上面的无 `-p` 写法。环境变量仍敏感，保持 Terminal B 私有，并在收尾
时 `unset`。

iOS LAN 模式还需从 iPhone 验证 transport：在 Safari 打开
`http://<mac-lan-ip>:3000/v1/health`，并让 API-connected debug build 使用同一
Base URL。Safari liveness 成功仍不代表 native App 的 Local Network permission、
ATS 或真实 Inbox API 集成成功。

### 8.3 两个 provider 的 read smoke

飞书，执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
corepack pnpm smoke:inbox -- --provider feishu --mode read
```

钉钉，执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
corepack pnpm smoke:inbox -- --provider dingtalk --mode read
```

只运行已配置的 provider。成功输出形状经过清洗，不含正文或 ID：

```text
PASS provider=<feishu-or-dingtalk> stage=read card_count=<positive-count> sync_ready=true conversation_metadata=true stepfun_summary=true needs_reply=<true-or-false> draft_present=<true-or-false> private_id_fields=false
```

只有实际出现该行，且三个必需布尔值均正确，才记录 Backend PASS。

## 9. API-connected Apple build 硬门禁

开始任何 UI 或 send 验证前，操作员必须先回答：

```text
该 build 是否已移除 UnifiedInboxDemoStore.items = .fixture，
并通过真实 Unified Inbox API 实现列表、详情、acknowledge、草稿版本保存、
可见 targets、confirmation 和 send？
```

- 答案为“否”或无法证明：本节和第 10 节停止；Apple UI integration、
  summary/draft UI、guarded send 记 `BLOCKED` 或 `SKIPPED`。
- 答案为“是”：分别执行对应平台的连接验收和 UI checklist。

### 9.1 macOS loopback 验收

- [ ] `.env` 使用 `HOST=127.0.0.1` 与
  `PUBLIC_BASE_URL=http://localhost:3000`。
- [ ] macOS App runtime Base URL 是 `http://localhost:3000`。
- [ ] App 自身显示真实 provider 列表和详情；不是 fixture 文案或 fixture ID。
- [ ] 断开 server 后 App 明确显示连接失败，恢复后重新连接。

### 9.2 iOS trusted-LAN 验收

- [ ] Mac 和 iPhone 位于同一受信任私人网络。
- [ ] `.env` 使用 `HOST=0.0.0.0` 与 Mac LAN Base URL。
- [ ] iOS App runtime Base URL 是 Mac LAN URL，不是 loopback。
- [ ] Local Network permission 和 debug/integration target 的 ATS 配置可用。
- [ ] App 自身完成真实 Inbox API 请求；Safari health 不能替代此项。
- [ ] 会话结束后关闭 LAN listener 或恢复 loopback 配置。

### 9.3 真实 UI checklist

- [ ] 列表与详情显示刚准备的真实 direct/group 测试消息对应卡片。
- [ ] provider 和显示会话正确；不显示私有 provider ID。
- [ ] StepFun 摘要、重要点和临时行动请求对应的待办可见。
- [ ] 需要回复的卡显示可理解的 reply target evidence。
- [ ] 草稿可编辑且保存后版本更新，没有被迟到 AI 结果覆盖。
- [ ] group digest 聚合为一张持续演进的卡。
- [ ] 使用界面当前显示的 exact revision 执行 acknowledge；revision 已变化时
  刷新并重新核对，不提交旧 revision。
- [ ] 第二参与者再发一条无敏感群消息；等待 poll 后出现下一张 digest 卡。
- [ ] 重启 server 后 checkpoint 延续，digest/草稿未丢失且没有重复卡。

重启验证：先在 Terminal A 按 `Ctrl+C`，再执行以下命令。
执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
corepack pnpm dev
```

## 10. 人工确认后的 guarded send

这是唯一允许发送真实消息的步骤。必须已经取得 Backend PASS 和 API-connected
Apple build 的 UI 验收；否则本节为 `BLOCKED` 或 `SKIPPED`。

发送前在 App 当前选中项逐项核对：

- provider 正确。
- 显示会话正确。
- 最终草稿已逐字核对。
- 所有 `@` target 可见、正确且无多余或缺失对象。

item id 只能由 API-connected App 的当前安全选中流程在内部传递并触发。操作员
不得查看、复制、输入或记录它，也不得从日志、raw API 或状态文件获取它。当前
fixture App 无此能力，所以不能执行真实 send。

优先由 API-connected App 自身完成 exact-version confirmation/send。若批准的
Apple integration harness 在内部调用仓库 smoke，其等价单次命令形状如下；
`HUSH_ITEM_ID` 必须由 App 安全流程注入，不能显示或落入 shell history。

飞书，执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
HUSH_SMOKE_ALLOW_SEND=true corepack pnpm smoke:inbox -- --provider feishu --mode send --item-id "$HUSH_ITEM_ID"
```

钉钉，执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
HUSH_SMOKE_ALLOW_SEND=true corepack pnpm smoke:inbox -- --provider dingtalk --mode send --item-id "$HUSH_ITEM_ID"
```

使用单命令前缀可避免 `HUSH_SMOKE_ALLOW_SEND` 残留；永远不要把它写入 `.env`。
成功输出形状为：

```text
PASS provider=<feishu-or-dingtalk> stage=send sent=true confirmation=true idempotency_fresh=true
```

命令完成后：

1. 在真实飞书/钉钉客户端确认目标会话、`@` 对象正确且只送达一次。
2. 只有真实客户端确认送达，guarded send 才记 `PASS`。
3. 清除 integration harness 内部的 item id，并确保未进入日志或证据。

`INBOX_SEND_UNKNOWN` 表示 backend 已明确持久化并返回歧义发送结果；
`HUSH_SMOKE_SEND_NOT_CONFIRMED` 表示 HTTP 2xx 响应未满足 smoke 要求的
`status=sent` 等 sent-confirmed 结构；`HUSH_SMOKE_NETWORK_ERROR` 或连接中断
表示传输层结果有歧义。三者以及任何 `stage=send` 非 `PASS` 都必须先在真实
客户端检查是否已送达，禁止直接重跑。

## 11. 故障排查

| 现象或错误 | 含义 | 操作 |
| --- | --- | --- |
| `/v1/health` 失败 | Fastify 不可达 | 确认 Terminal A、Base URL、Mac IP、listener 与防火墙；不要改为公网地址。 |
| `/v1/health` 成功但 sync 未 ready | 只有进程存活，provider 链路未通过 | 执行官方 CLI preflight，核对 CLI path 和本地 account label。 |
| `HUSH_SMOKE_CONFIG_INVALID` | smoke 缺少 Base URL 或 App token | 重新普通 export Base URL，并用 `read -s` 输入 token；不得打印 token。 |
| `HUSH_SMOKE_SYNC_NOT_READY` | provider 尚无 ready sync status | 核对 CLI 登录/权限和清洗后的 server 错误；不要反复重新授权。 |
| `HUSH_SMOKE_PROVIDER_CARD_MISSING` | ready 但 lookback 内无卡 | 确认测试消息在 60 分钟内，等待至少一个 poll 周期后只重跑 read。 |
| `INBOX_AI_UNAVAILABLE` 且 `reason=timeout` | StepFun 超过 15 秒上限 | 保持 server 运行，等待 Connector backoff；核对网络与 StepFun，不无限阻塞。 |
| provider permission / entitlement 错误 | 登录存在但无读取或发送权限 | 飞书核对精确四 scope 和组织审批；钉钉按 CLI 提示处理 CLI Access Management。 |
| `INBOX_SEND_UNKNOWN` | backend 已持久化并返回歧义发送结果 | 先查真实客户端，禁止直接重跑。 |
| `HUSH_SMOKE_SEND_NOT_CONFIRMED` | HTTP 2xx 响应不满足 `status=sent` 等 sent-confirmed 结构 | 先查真实客户端，禁止直接重跑。 |
| `HUSH_SMOKE_NETWORK_ERROR` / connection interruption | send 的传输层结果有歧义 | 先查真实客户端，禁止直接重跑。 |

AI 是 bounded wait，不是完全异步。每次摘要或草稿请求最多等待
`INBOX_STEPFUN_TIMEOUT_MS=15000`；超时使本次同步失败，Connector 按 backoff
稍后重试。它不会无限等待，也不会因此自动发送。

Outlook/QQ 未配置不阻塞飞书/钉钉验证。CI、fixture 和 mock 只能证明各自测试
路径，不能证明任何真实 provider 或 Apple 真实 UI。

## 12. 比赛日 checklist

任何 secret、正文、账号名、会话名或 ID 都不要写在 checklist 旁。

- [ ] 在指定 Mac 和正确 worktree 执行。
- [ ] Node `20.19.x`、pnpm `9.15.9`、目标分支正确。
- [ ] 两个 CLI 的固定版本 integrity 已逐字符比对后安装。
- [ ] server 依赖以 `--frozen-lockfile` 安装，比赛日未升级。
- [ ] `.env` 只在本机，两个 Hush token 不同且各为 32 到 128 字符。
- [ ] loopback 或 trusted-LAN 拓扑与目标 Apple 平台一致。
- [ ] LAN 模式只在受信任网络开放，没有公网暴露。
- [ ] 当前 provider 的官方 CLI 授权和一次性网络 preflight 通过。
- [ ] 第二参与者已准备 lookback 内的无敏感 direct/group 消息。
- [ ] `/v1/health` liveness 成功，但未把它当成 provider/UI 证明。
- [ ] read smoke 输出 `sync_ready=true`、`stepfun_summary=true`、
  `private_id_fields=false`。
- [ ] Backend PASS 已独立记录。
- [ ] 已核实 Apple build 是否 API-connected。
- [ ] 若仍为 `.fixture`，UI/send 已记 `BLOCKED` 或 `SKIPPED`，未绕过取 ID。
- [ ] 若 API-connected，macOS loopback 或 iOS LAN 连接已在 App 内验收。
- [ ] 真实列表/详情、摘要/待办、草稿编辑、visible targets 已核对。
- [ ] exact-revision acknowledge、下一张 digest 卡和 checkpoint 重启已核对。
- [ ] 发送前 provider、会话、最终草稿、所有 `@` target 已核对。
- [ ] 若发送，只使用一次临时开关，并在真实客户端确认只送达一次。
- [ ] 任何 send 歧义先查真实客户端，未直接重跑。
- [ ] 证据、状态文件决策和收尾已完成。

## 13. 最小证据表

状态只使用 `PASS`、`FAIL`、`BLOCKED`、`SKIPPED`。当前 fixture App 的 Apple UI
integration、summary/draft UI 和 guarded send 不得为 `PASS`。

| Provider | Date-time | CLI preflight | Backend read | Apple UI integration | Summary / draft UI | Guarded send | Operator initials |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `feishu` 或 `dingtalk` | `<local-date-time>` | `<status>` | `<status>` | `<status>` | `<status>` | `<status>` | `<initials>` |

证据表不得附消息正文、摘要、草稿、raw JSON、任何 ID、server 日志、token、
授权 URL、device code 或隐私截图。Mac LAN IP 也无需记录。

## 14. 状态文件、清理与退出

`<repository-root>/server/.data/unified-inbox-state.json` 是敏感文件，包含真实
消息、草稿、私有 participant binding 和 checkpoint；还可能承载 digest、
confirmation 与 send idempotency 状态。不得提交、共享、截图或用于抄取 ID。

### 14.1 保留状态

若比赛专用 Mac 需要保留状态以继续 Demo：

- 限制机器登录和磁盘访问。
- 不提交、不复制、不上传、不共享状态文件。
- 完成 restart/checkpoint 验证后再决定是否保留。

### 14.2 共享 Mac 不保留状态

必须先完成 restart/checkpoint 验证，再按 `Ctrl+C` 停止 server。确认 server
已停止后，从 server 目录执行下面的显式命令；不得使用变量或 glob：

```bash
cd "<repository-root>/server"
rm -- .data/unified-inbox-state.json
```

此删除不可通过本 Runbook 恢复，并会清空 checkpoint、digest、draft、
confirmation 和 idempotency 状态。下一次启动时，lookback 范围内的真实消息
可能重新出现。未完成 restart/checkpoint 验证前不要删除。

### 14.3 清理 shell

Terminal B，执行目录：`<repository-root>/server`

```bash
cd "<repository-root>/server"
unset HUSH_BASE_URL
unset HUSH_APP_TOKEN
unset HUSH_SMOKE_ALLOW_SEND
unset HUSH_ITEM_ID
```

确认 Terminal A 已停止。若曾启用 LAN listener，恢复 loopback 配置或确保本次
server 不再运行。

### 14.4 按需退出官方 CLI

若共享 Mac 不应保留 provider 登录态，先查看当前固定版本 help，再只对本次账号
执行官方 logout。执行目录：`<repository-root>`

```bash
cd "<repository-root>"
lark-cli auth --help
dws auth --help
```

不要猜测 logout 参数。退出后如需再次 Demo，必须重新完成授权与 preflight。
