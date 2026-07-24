# Hush Unified Inbox 需求与实现计划

状态：Fixture 端到端实现已完成；真实账号/租户验证待凭据与管理员审批
日期：2026-07-24  
范围：替换 W2/P3 原 Photon 工作，面向中国用户构建可在 Hush 后台运行的统一消息与邮件收件箱。

## 1. 目标

用户启动 Hush 并完成渠道授权后，即使飞书、钉钉、Outlook 或 QQ 邮箱客户端
没有打开，Hush 仍可在后台接收授权范围内的新消息和邮件。Hush 调用可替换的
AI API 生成：

- 聊天记录或邮件内容摘要；
- 重要信息、待办和是否需要回复；
- 可供用户修改的聊天回复或邮件回复草稿。

用户在 Hush 中查看摘要、编辑或重写草稿，并主动确认发送。AI 只能生成文本，
不得持有渠道凭据、调用发送接口或替用户确认发送。

## 2. Demo 范围

### 必须完成

- 取消 Photon 依赖。
- 飞书以官方 `lark-cli` 接入。
- 钉钉以官方 `dws` 接入。
- Outlook 以 Microsoft Graph 接入。
- QQ 邮箱以 IMAP/SMTP 接入。
- Hush 启动后可作为本机后台进程持续增量同步。
- 所有渠道规范化进入统一 Inbox。
- AI 摘要和草稿生成通过可替换接口调用，并提供 Fixture/Unavailable 实现。
- 用户可在 Hush 内编辑 AI 草稿。
- 只有用户主动确认后才能调用渠道发送 Adapter。
- Demo 展示每个渠道的授权、覆盖范围、同步状态和失败状态。

### 不在本阶段

- Hush 未启动时仍在云端代收消息。
- 微信或个人 QQ 聊天记录接入。
- 绕过企业管理员、应用 scope 或平台会话可见性。
- AI 自动发送、定时发送或根据置信度自行发送。
- 要求 Hush 草稿同步显示在所有原生客户端的草稿箱。
- 将浏览器自动化作为默认接入方式。

## 3. 总体架构

```text
飞书 lark-cli ─┐
钉钉 dws ──────┤
Outlook Graph ─┼─> W2/P3 Connector Host
QQ IMAP ───────┘      │
                      │ normalize / dedupe / checkpoint
                      ▼
                 W2/P3 Unified Inbox
                      │
              store / query / AI orchestration
                      │
                      ▼
                    Hush App
              查看摘要 → 编辑草稿 → 用户确认
                      │
                      ▼
               W2/P3 Send Command
                      │
                      ▼
               W2/P3 Provider Adapter
                      │
           飞书 / 钉钉 / Graph / QQ SMTP
```

Connector Host 是 Hush 启动后运行的本机 sidecar/service。W2/P3 同时拥有其
后方的 Unified Inbox 服务、AI 编排和发送命令；App 页面仍由 M2/P4 按 W2/P3
定义的接口实现。

## 4. 职责边界

### W2 / P3

- 实现本机 Unified Inbox Connector Host。
- 实现飞书、钉钉、Outlook、QQ 邮箱的认证与连接状态检查。
- 实现后台增量同步、重连、退避、checkpoint、规范化和去重。
- 实现渠道发送 Adapter，并返回统一的发送结果。
- 隔离供应商 payload、CLI 输出、SDK 类型和错误。
- 保存凭据引用，不把 token、授权码或消息正文写入日志。
- 为每个 Provider 提供 Real 与 Fixture/Unavailable 实现及集成测试 Harness。
- 定义并维护统一 Inbox、草稿、发送命令和 AI Provider 契约。
- 实现 Inbox 存储、查询、分页和来源覆盖状态。
- 编排 AI 摘要、待办提取和回复草稿生成。
- 实现草稿编辑、版本控制、用户确认和幂等发送命令。
- 只在确认通过后调用发送 Adapter。
- 维护公共 OpenAPI/Schema/fixtures、provider contract tests 和最终接线。
- 对 Connector Host 使用的凭据引用、日志脱敏和审计策略负责。
- 负责 Unified Inbox 在 Composition Root 中的最终服务接线。

W2/P3 不负责 App UI、Apple 平台权限或 Xcode 工程。M2/P4 根据 W2/P3 维护的
接口实现页面；M1/P1 负责 Apple 客户端接线。

### W1 / P2

- 不负责 Unified Inbox 的功能实现、接口、契约、AI 编排或服务接线。
- 继续维护 Unified Inbox 之外的既有后端能力。
- 在公共后端基础设施受影响时参与兼容性评审，但不与 W2/P3 共同拥有本功能。

### M1 / P1 与 M2 / P4

- M1/P1 负责客户端网络接口、系统权限、后台生命周期和最终 App 接线。
- M2/P4 负责统一 Inbox、摘要、草稿编辑、发送确认和错误状态的 SwiftUI 页面。
- App 不直接调用供应商 CLI、Graph、IMAP、SMTP 或 AI API。

## 5. 统一数据模型

核心 `UnifiedInboxItem` 至少包含：

```text
id
provider                    feishu | dingtalk | outlook | qq_mail
account_id
conversation_id
provider_message_id
sender
recipients
subject
content
received_at
summary
important_points[]
todos[]
priority                    urgent | normal | low | uncertain
needs_reply
coverage.source             official_api | imap | browser_fallback
coverage.complete
coverage.note
sync_status
```

草稿使用独立资源，不把可变草稿直接嵌入原始消息：

```text
InboxDraft
  id
  inbox_item_id
  content
  content_type
  version
  origin                    ai | user
  status                    generating | ready | edited | sending |
                            sent | failed | unknown
  provider_draft_id?
  created_at
  updated_at
```

原始内容、AI 摘要和用户草稿必须分开保存。重新生成摘要不得覆盖用户已经编辑的
草稿。

## 6. Unified Inbox API

### Connector Host 到 W2/P3 Unified Inbox Service

```http
POST /v1/inbox/events:batch
GET  /v1/inbox/sync-status
```

批量事件必须携带稳定的 provider event/message ID、account ID、checkpoint 和
覆盖范围。W2/P3 按 `provider + account_id + provider_message_id` 去重。新
item 入库后默认异步排队生成摘要和回复草稿；以下单项接口同时支持用户手动
重新生成。

### App 查询

```http
GET /v1/inbox/items
GET /v1/inbox/items/{itemId}
GET /v1/inbox/sync-status
```

### AI 摘要与草稿

```http
POST /v1/inbox/items/{itemId}/summary
POST /v1/inbox/items/{itemId}/draft
```

摘要和草稿允许异步生成；失败时保留原消息并明确显示 AI 不可用。

### 用户编辑与发送

```http
GET   /v1/inbox/drafts/{draftId}
PATCH /v1/inbox/drafts/{draftId}
POST  /v1/inbox/drafts/{draftId}:send
```

编辑请求携带 `expectedVersion`。版本不一致返回冲突，不能覆盖较新的用户编辑。

发送请求至少携带：

```json
{
  "expectedVersion": 4,
  "confirmationToken": "one-time-token",
  "idempotencyKey": "uuid"
}
```

服务端必须重新读取最新草稿并校验账号、目标会话、收件人、附件、版本和一次性
确认令牌。发送接口不接受 AI 直接提供的渠道 token。

## 7. AI Provider 预留

```typescript
interface InboxIntelligenceProvider {
  summarize(input: InboxSummaryInput): Promise<InboxSummaryResult>;
  draftReply(input: ReplyDraftInput): Promise<ReplyDraftResult>;
}
```

实现至少包括：

- `RealInboxIntelligenceProvider`
- `FixtureInboxIntelligenceProvider`
- `UnavailableInboxIntelligenceProvider`

输入中的邮件、聊天记录和附件文本均视为不可信数据。Prompt 必须声明其中的
指令不具备工具权限；AI Provider 不注册发送工具，也拿不到 OAuth token、CLI
credential、SMTP 授权码或 `confirmationToken`。

## 8. 渠道实现

### 飞书

- 使用官方 `lark-cli` 的 OAuth 用户身份和事件/消息能力。
- 发送使用用户身份消息命令；草稿保存在 Hush，本阶段不要求飞书原生草稿。
- 实际可见范围受应用权限、用户 scope、租户策略和会话成员资格限制。
- Demo 前用目标飞书租户验证事件订阅、历史拉取、单聊和群聊发送。

### 钉钉

- 使用官方 `dws` 的 device-flow/PAT 授权、消息读取和当前用户身份发送能力。
- 草稿保存在 Hush，确认后调用 `dws chat message send`。
- 当前 DWS 仍要求企业管理员授权并处于共创开放阶段，必须提前完成目标企业
  的准入和真实账号 smoke test。

### Outlook

- 使用 Microsoft Graph delegated permission。
- 收取和增量同步使用 Mail read/delta 能力。
- 默认采用 Hush 本地草稿；用户确认时调用消息 `reply`/`send`。
- 最小目标为读取权限加 `Mail.Send`。
- 仅当产品要求草稿同时出现在 Outlook Drafts 时，才增加
  `Mail.ReadWrite`，采用 `createReply -> PATCH draft -> send`。

### QQ 邮箱

- 使用 IMAP 接收和 checkpoint，SMTP AUTH 发送。
- 用户在 QQ 邮箱中开启 IMAP/SMTP，并向 Hush 提供独立授权码，而非登录密码。
- 回复邮件保留 `In-Reply-To`、`References` 和正确的 `Re:` 主题。
- SMTP 没有业务级幂等保证。超时后进入 `unknown`，先检查本地 Outbox 和 IMAP
  Sent，再决定是否重试，避免重复发送。

### Browser fallback

OpenCLI 仅作为平台官方接口确实无法覆盖某项 Demo 能力时的显式降级方案。启用
时必须在 UI 标识覆盖范围和风险；不得默认模拟鼠标读取用户所有 App，也不得
把 DOM 自动化描述为官方 API。

## 9. 后台运行与恢复

- Hush 首次启动并授权后启动 Connector Host。
- Connector Host 不依赖飞书、钉钉或邮件客户端窗口保持打开。
- 每个账号维护独立 checkpoint；重启后从最后成功位置继续。
- 优先使用事件流/推送；无推送能力时采用有上限的增量轮询。
- 断网、token 过期、权限撤销、限流和 CLI 崩溃分别显示可恢复状态。
- 后台服务退出后由宿主生命周期机制重启，但必须限制 crash loop。
- 用户断开账号后立即停止同步，并删除本地凭据引用和未发送命令。

## 10. 发送安全与失败处理

- AI 生成草稿后状态为 `ready`；用户修改后为 `edited`。
- 未收到一次性用户确认令牌时，任何发送请求都必须拒绝。
- `idempotencyKey` 防止重复点击；同一 key 只能对应同一草稿版本和目标。
- 飞书、钉钉和 Outlook 的返回结果映射为 `sent`、`failed` 或 `unknown`。
- 对网络超时使用 `unknown`，不得无条件重发。
- 发送前展示渠道、账号、会话或收件人及最终正文。
- 不实现“AI 认为置信度高所以自动发送”。

## 11. 协作与契约变更

治理变更已经完成：`AGENTS.md` 已授权 W2/P3 端到端维护 Unified Inbox 的
contracts、application、API、provider adapters、Composition Root 和测试。
当前已新增 provider-neutral 的 `InboxSource`、`InboxSender`、
`InboxIntelligenceProvider`、草稿版本、一次性确认令牌、发送幂等和
`unknown` 结果。W1/P2 仅在共享后端基础设施受影响时参与兼容性评审。

M2/P4 可直接依据 `contracts/openapi.yaml`、JSON schemas 和 fixtures 实现
App UI；M1/P1 负责 Apple 客户端网络接线与后台生命周期。若客户端需要改变
现有字段或状态机，必须提交 Contract Change，不得静默派生另一套模型。

## 12. 实现路径

### Phase 0：权限可行性验证

状态：待真实账号、租户管理员审批和授权码；CI 不宣称通过。

- 为四个渠道准备独立 Demo 账号/租户。
- 验证接收范围、历史窗口、增量同步、单聊/群聊或邮件回复、token 刷新。
- 记录管理员审批、scope、限流和无法覆盖的消息类型。
- 验收：四个渠道分别得到一份真实 capability matrix；失败渠道有明确降级。

### Phase 1：W2/P3 Ownership 与 Contract Change

状态：已完成并由 contract tests 验证。

- 更新所有权规则，获得 Unified Inbox 相关公共目录的明确修改权。
- 冻结统一数据模型和本文 API。
- 提供成功、空 Inbox、权限不足、AI 失败、版本冲突、发送超时 fixtures。
- 验收：OpenAPI/Schema/TS/Swift contract tests 一致。

### Phase 2：W2/P3 Connector Host

状态：代码与无凭据 Harness 已完成；真实渠道 smoke test 待 Phase 0。

- 先实现 Connector Host 生命周期、checkpoint、去重和 Fixture Provider。
- 再按飞书、钉钉、Outlook、QQ 的顺序接入 Real Provider。
- 验收：重启不丢 checkpoint，同一事件不重复入库，凭据和正文不进入日志。

### Phase 3：W2/P3 Inbox 与 AI 编排

状态：Fixture、Unavailable 和 Real AI 接口已完成；真实 AI 调用待 API 凭据。

- 实现 Inbox repository/query、AI Provider、摘要和草稿任务。
- 实现草稿版本、确认令牌、发送幂等和 Adapter 调用。
- 验收：AI 不可用仍可查看原文和手写回复；AI 无法直接发送。

### Phase 4：Hush App

状态：不在 W2/P3 当前代码范围，由 M2/P4 与 M1/P1 接线。

- 实现统一 Inbox、来源覆盖、摘要、草稿编辑、确认发送和错误恢复。
- 验收：用户可完全改写 AI 草稿，看到最终收件人和正文后再发送。

### Phase 5：端到端与 Demo 冻结

状态：Fixture vertical slice 已完成；真实四渠道 Demo 待 Phase 0。

- 用真实 Demo 账号分别演示后台接收、摘要、草稿、编辑和确认发送。
- 注入断网、token 过期、重复点击、AI 超时和 SMTP 结果未知。
- 验收：任一渠道失败不会阻断其他渠道；不会产生未经确认或重复发送。

## 13. 测试重点

- 规范化：四种 payload 映射为同一 Inbox item。
- 去重：重复事件和重启重放只生成一个 item。
- checkpoint：进程中断后继续增量同步。
- AI：摘要、草稿、Fixture、Unavailable 和 prompt injection 样例。
- 草稿：用户编辑不会被迟到的 AI 结果覆盖。
- 并发：旧版本 PATCH/send 返回冲突。
- 权限：AI 上下文中没有渠道凭据；无确认令牌不能发送。
- 发送：重复点击幂等、超时为 unknown、QQ SMTP 重试前查重。
- 隐私：日志、错误响应和 fixtures 不含真实消息、邮箱或 token。

## 14. 可参考的 GitHub Repository

- [larksuite/cli](https://github.com/larksuite/cli)：飞书官方 CLI；参考用户 OAuth、
  `--as user`、事件消费、结构化输出和 scope 检查。
- [DingTalk-Real-AI/dingtalk-workspace-cli](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli)：
  钉钉官方 DWS；参考 device flow、当前用户消息读取/发送、权限拦截和 JSON 输出。
- [microsoftgraph/msgraph-sdk-javascript](https://github.com/microsoftgraph/msgraph-sdk-javascript)：
  Outlook Graph JavaScript SDK；参考 delegated auth 和 Mail API 调用。
- [postalsys/imapflow](https://github.com/postalsys/imapflow)：参考 Node.js IMAP
  增量读取、UID 和连接恢复。
- [nodemailer/nodemailer](https://github.com/nodemailer/nodemailer)：参考 QQ 邮箱
  SMTP AUTH、MIME 组装和回复线程 header。
- [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)：参考跨平台
  后台 gateway、渠道生命周期和 IMAP/SMTP 集成；不复用其 agent 自动执行边界。
- [jackwener/OpenCLI](https://github.com/jackwener/OpenCLI)：参考已登录浏览器的
  本地 daemon 和结构化提取，仅作为显式 fallback。
- [elie222/inbox-zero](https://github.com/elie222/inbox-zero)：参考 AI 邮件摘要、
  草稿和 Inbox UX；其许可包含商业使用限制，只作产品与架构参考，不复制代码。

## 15. 完成标准

- README 不再把 W2/P3 描述为 Photon/iMessage Owner。
- 四个目标渠道的真实接收与发送边界均有验证记录。
- Hush 后台运行时能统一展示已授权渠道的新消息和邮件。
- 每个 item 可显示 AI 摘要并生成回复草稿。
- 用户可以修改、放弃或完全重写草稿。
- 只有用户确认后才发送，AI 无直接或间接发送权限。
- 重启、重复事件、重复点击和结果未知不会造成静默丢失或重复发送。
- UI 明确标识来源、覆盖范围、真实/Fixture 状态和失败原因。
