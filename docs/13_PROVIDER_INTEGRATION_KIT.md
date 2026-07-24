# 13｜Provider Integration Kit

状态：Contract v1 Freeze。本文只定义 Provider 接入边界，不包含 Gmail、
Gmail OAuth、Photon SDK 或 Photon Webhook 的具体实现。

## 1. Contract Freeze 审计

| 不变量 | 当前覆盖 | 证据 |
|---|---|---|
| fatigue type 包含 `unknown` | 已满足 | `common.schema.json`、`fatigue-reflection.schema.json`、TS Zod |
| check-in 最多一个 follow-up | 运行时满足 | 响应只有单一 `follow_up` 对象；Application 禁止有回答后再次追问；Schema 未表达跨字段条件 |
| recommend 只返回固定 `quest_id` | 已满足 | Schema 仅返回 ID；`RestService` 验证 ID 必须来自过滤后的固定库 |
| `include_gmail=false` | 已满足 | Schema、无 Gmail fixture、Integration Test |
| 用户主动提交 `open_loops` | 已满足 | Handoff request、Open Loops Only fixtures |
| handoff 支持 `uncertain` | 已满足 | Schema、fixtures、Agent 与 Application 归一化 |
| Pause Receipt `included_sources` | 已满足 | Schema、fixtures |
| Pause Receipt `excluded_sources` | 已满足 | Schema、fixtures |
| Pause Receipt `held_items` | 已满足 | Schema、fixtures |
| Pause Receipt `tomorrow_first_step` | 运行时满足 | Schema 定义该字段，Application 与 fixtures 均输出；Schema 尚未列为 required |
| Gmail 不可用降级 `OPEN_LOOPS_ONLY` | 已满足 | `HandoffService`、Unavailable Provider、Integration Test |

以上不是仅靠 JSON Schema 保证：固定 Quest、一次追问和
`OPEN_LOOPS_ONLY` 同时由 Application invariant 与 Integration Test 保证。

### 1.1 本次未收紧的契约问题

以下修改会收紧既有 Contract v1，不能作为 Provider Kit 小修静默合入：

1. `pause-receipt.schema.json` 定义了 `tomorrow_first_step`，但未列入
   `required`。当前 Application 和全部成功 fixture 都输出该字段。
2. `fatigue-reflection.schema.json` 未使用 `if/then` 约束
   `needs_follow_up` 与 `follow_up`；当前 TS Zod 与 Application 已约束。
3. `handoff-job-failed-gmail.json` 仍保留“Gmail 失败导致 Job failed”的通用
   负面 fixture；当前 Handoff Application 对 fetch failure 的真实策略是
   `OPEN_LOOPS_ONLY` 并成功完成。该 fixture 仅用于终态错误结构覆盖。
4. Handoff Application 已将 Job-scoped `AbortSignal` 传播到 Agent、Mail、
   Draft 与 Completion 边界；Provider 仍必须把 optional signal 继续传给
   自己的 SDK/HTTP 调用。

若决定收紧 1 或 2，必须发起 Contract Change PR、更新契约版本并协调 Apple
镜像；本次不修改。

## 2. 不可修改边界

Provider Owner 不得修改：

```text
server/src/domain/ports.ts
server/src/application/**
contracts/**
server/src/composition.ts
server/src/bootstrap.ts
```

也不得新增依赖、修改 package/lock、扩大 OAuth scope 或把供应商 SDK 类型
泄漏到 Domain。若端口不足，先发起 `Contract Change PR`，说明：

1. 当前端口为何无法实现；
2. 是否向后兼容；
3. 受影响的 Application、Apple Client 和 fixtures；
4. 错误、超时、幂等或隐私语义的变化；
5. 迁移与回滚方式。

批准前不得在 Provider PR 中夹带契约修改。

---

## 3. MailProvider Kit

### 3.1 接口位置

```text
server/src/domain/ports.ts
```

主要接口和模型：

```text
MailProvider
MailFetchContext
MailItem
DraftRequest
DraftResult
ProviderCallOptions
ProviderHealth
```

### 3.2 允许修改

Gmail Owner 只允许修改：

```text
server/src/mail/**
server/tests/integration/gmail*
scripts/seed-gmail.*
scripts/clear-demo-drafts.*
docs/gmail/**
```

Provider Contract Test runner 归 W1：

```text
server/tests/provider-contracts/mail-provider.contract.ts
```

Gmail Owner 在自己的 integration test 中导入 runner，提供测试 Harness；不得
复制或修改 runner 来绕开不变量。

### 3.3 输入与输出

`fetchUnread(context, options?)`：

- `accountId`：Hush 内部账号引用；不得把 refresh token 放进该字段。
- `since`：ISO 8601，带时区。
- `maxItems`：最大返回数量；Provider 不得静默超过。
- 返回 `MailItem[]`；空邮箱返回 `[]`，不是 `null`。
- `plainText` 是供 Handoff 使用的规范文本，不返回 SDK message 对象。

`createDraft(request, options?)`：

- 只创建草稿，绝不发送邮件。
- `dedupeKey` 是 Hush 生成的稳定幂等键。
- 返回稳定的 `draftId`。
- 同一 `dedupeKey` 重试必须返回已有草稿或等价结果，不得产生第二份草稿。

Provider 不得把 Google SDK 类型、OAuth token 或原始 API response 返回给
Application。

### 3.4 错误映射

| Provider 情况 | AppError code | retryable | fallback |
|---|---|---:|---|
| 未连接账号 | `GMAIL_NOT_CONNECTED` | true | `OPEN_LOOPS_ONLY` |
| 网络、5xx、超时 | `GMAIL_UNAVAILABLE` | true | `OPEN_LOOPS_ONLY` |
| rate limit | `GMAIL_RATE_LIMITED` | true | `OPEN_LOOPS_ONLY` |
| 草稿创建失败 | `GMAIL_DRAFT_FAILED` | true | `SUMMARY_ONLY` |
| 本地输入不合法 | `INVALID_REQUEST` | false | null |

不得将 SDK error、token、邮件正文或个人数据写入日志和 `details`。

### 3.5 超时与取消

- 接收可选 `ProviderCallOptions.signal`。
- 调用前已 abort：立即停止，不发网络请求。
- 调用中 abort：尽快取消 SDK/HTTP 请求并清理临时状态。
- Provider 自身必须设置有限超时；超时映射为 `GMAIL_UNAVAILABLE`。
- 超时或 fetch 失败不得令整个 Handoff 失败；Application 会继续
  `OPEN_LOOPS_ONLY`。
- 草稿创建逐封独立失败，不能回滚已成功创建且幂等的草稿。
- 草稿失败会保留 `drafts.saved=false`，并在 Pause Receipt 中显示
  `held_items:not_saved`；不得把失败隐藏或误标成 `uncertain`。

### 3.6 环境变量

使用已有环境变量：

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_DEMO_ACCOUNT_ID
```

token/refresh token 放在被批准的秘密存储中，不写 `.env.example` 以外的仓库
文件，不提交 Demo 账号密码。

### 3.7 运行 Contract Tests

当前 Kit 自检：

```powershell
cd server
corepack pnpm test:providers
```

Gmail Provider test 应在 `server/tests/integration/gmail*.test.ts` 中：

1. 导入 `defineMailProviderContractTests`；
2. 构造可切换 ready、empty、unavailable、timeout、draft failure 的 Harness；
3. 提供隔离的 Demo Gmail 或 HTTP/SDK fake；
4. 跑完整 suite，不跳过 dedupe test。

### 3.8 本地联调

现有本地实现：

```text
FixtureMailProvider
UnavailableMailProvider
```

位置：

```text
server/src/infra/provider-stubs.ts
```

`FixtureMailProvider` 使用 `contracts/fixtures/mail-items-demo.json`，并在内存中
按 `dedupeKey` 去重草稿。它只用于 Sample/local test，不得标记为真实 Gmail。

### 3.9 Composition Root

Gmail Owner 输出一个不修改 Domain 的 Provider factory。完成并通过 Contract
Tests 后，由 W1 在：

```text
server/src/composition.ts
```

用真实实现替换 `UnavailableMailProvider`。若需要注册 OAuth routes，由 Gmail
Owner导出注册函数，W1 在 Composition/API 入口评审后接线。

---

## 4. MessagingChannel Kit

### 4.1 接口位置

```text
server/src/domain/ports.ts
```

主要接口和模型：

```text
MessagingChannel
OutboundMessage
InboundMessage
InboundMessageMapper<Payload>
InboundEventDeduplicator
ProviderCallOptions
ProviderHealth
```

`MessagingChannel` 保持 outbound 职责。Inbound 由独立 mapper 转为规范
`InboundMessage`，再由 deduplicator 在进入 Intent/Application 前 claim
`eventId`。

### 4.2 允许修改

W2 / P3 只允许修改：

```text
server/src/messaging/**
server/tests/integration/photon*
scripts/gen-qr.*
docs/photon/**
```

Provider Contract Test runner 归 W1：

```text
server/tests/provider-contracts/messaging-channel.contract.ts
```

W2 在 Photon integration test 中导入 runner 并提供 Harness。

### 4.3 输入与输出

Outbound `send(message, options?)`：

- `recipientId`：Provider adapter 可识别的收件人引用。
- `text`：要发送的内容；不得写入普通日志。
- `correlationId`：Hush 请求/任务关联 ID，用于 provider-side idempotency。
- 成功返回 `void`；失败抛规范 `AppError`。

Inbound mapper 必须输出且只输出：

```text
eventId
providerMessageId
senderId
recipientId
text
receivedAt
```

- `receivedAt` 是带时区的 ISO 8601。
- Photon raw payload、签名 header、SDK object 不得越过 mapper。
- Webhook 签名验证发生在映射前。

### 4.4 错误映射

| Provider 情况 | AppError code | retryable | fallback |
|---|---|---:|---|
| 网络、5xx、超时、不可用 | `PHOTON_UNAVAILABLE` | true | `APP_ONLY` |
| webhook 签名错误 | `PHOTON_SIGNATURE_INVALID` | false | null |
| inbound payload 无法映射 | `INVALID_REQUEST` | false | null |

不得将 Photon SDK error、签名 secret、手机号或消息正文放进日志/错误 details。

### 4.5 超时与取消

- outbound `send` 接收可选 `ProviderCallOptions.signal`。
- 调用前已 abort 时不得触发外部发送。
- 调用中 abort 时尽快终止；若 Provider 已接受消息，必须依赖
  `correlationId` 防止重试造成重复发送。
- Provider 自身设置有限超时；超时映射为 `PHOTON_UNAVAILABLE`。
- 超时状态未知时不得盲目生成新 correlation ID 重试。
- Completion notification 只在核心 summary 已以 `succeeded` 落库后发送。
  发送失败或超时不得把核心 Job 改成 `failed`，也不得清空 summary。

### 4.6 幂等与去重

Outbound：

- 同一业务消息重试沿用 `correlationId`。
- Provider adapter 应在供应商支持时传递/保存幂等键。
- 状态未知时由上层决定人工重试，不得自动发送不同内容。

Inbound：

- 使用 Provider webhook `eventId` 作为去重键。
- 在 Intent Router 之前调用
  `InboundEventDeduplicator.claim(eventId, ttlSeconds)`。
- 首次返回 `true`；TTL 内重复返回 `false` 并停止处理。
- 不得使用消息正文 hash 替代稳定 event ID。

### 4.7 环境变量

使用已有环境变量：

```text
PHOTON_API_KEY
PHOTON_WEBHOOK_SECRET
PHOTON_LINE_ID
```

API key 与 webhook secret 只存在于服务器秘密存储，不进入 fixture、日志或
客户端。

### 4.8 运行 Contract Tests

```powershell
cd server
corepack pnpm test:providers
```

Photon Provider test 应在 `server/tests/integration/photon*.test.ts` 中：

1. 导入 `defineMessagingProviderContractTests`；
2. Harness 提供 outbound channel、raw inbound mapper、deduplicator；
3. 模拟 ready 与 unavailable；
4. 验证相同 event ID 只 claim 一次；
5. 不调用真实 Photon SDK 完成基础 Contract Test。

真实 Sandbox/line 测试另行标记为 integration，不得替代 Contract Test。

### 4.9 Mock / Console 联调

现有本地实现：

```text
RecordingMessagingChannel
ConsoleMessagingChannel
UnavailableMessagingChannel
NormalizedInboundMessageMapper
InMemoryInboundEventDeduplicator
```

位置：

```text
server/src/infra/provider-stubs.ts
server/src/infra/in-memory.ts
```

- `RecordingMessagingChannel` 保存完整消息供断言。
- `ConsoleMessagingChannel` 只输出 recipient/correlation/text length，不输出
  消息正文。
- `NormalizedInboundMessageMapper` 用于已经规范化的本地 fixture。
- 本地 Provider 响应必须标记 Mock/Sample，不得声称 Photon 已发送。

### 4.10 Composition Root

W2 输出 Provider factory、mapper 和 route registration function。完成并通过
Contract Tests 后，由 W1 在：

```text
server/src/composition.ts
```

接入真实 `MessagingChannel`、Inbound mapper 和 deduplicator；必要的 HTTP
route 由 W1 在 `server/src/api/` 评审接线。W2 不直接修改 Composition Root。

---

## 5. 完成定义

Provider PR 必须：

1. 只修改各自允许目录；
2. 不修改 Domain/Application/contracts/Composition Root；
3. 完整通过对应 Provider Contract Tests；
4. 说明真实与 Mock 路径；
5. 说明超时、取消、幂等/去重策略；
6. 证明日志不含 token、消息正文或邮件正文；
7. 给出环境变量和本地复现方式；
8. 列出尚未接线部分；
9. 请求 W1 进行最终 Composition Root 接线。
