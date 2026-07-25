# AGENTS.md — Hush Coding Agent Rules

本文件对本仓库内所有 Coding Agent 生效，并继承上级 `../AGENTS.md` 的工程与
Superpowers Style 工作流。若旧文档仍
保留 Gmail/Photon 分工，以本文件、`README.md` 和已批准的 `plan.md` 对
Unified Inbox 的规定为准。

## 1. 项目目标

Hush 是一个环境式休息 Agent，Must 主线为：

`Hush Door → Name the Tiredness → Rest Quest → Rest Session → Feedback`

本阶段新增 Unified Inbox：

```text
飞书 / 钉钉 / Outlook / QQ 邮箱授权接收
→ 后台增量同步
→ AI 生成摘要、待办和回复草稿
→ 用户在 Hush 内查看并编辑
→ 用户主动确认
→ Hush 通过对应 Provider Adapter 发送
```

Photon 已退出本阶段范围。AI 只能生成摘要和可编辑草稿，不得持有渠道凭据、
调用发送接口或代替用户确认。

## 2. 必读文件

开始 Unified Inbox 工作前必须完整阅读：

1. 上级 `../AGENTS.md`
2. `README.md`
3. `plan.md`
4. `docs/01_SCOPE_AND_FEATURE_FLOWS.md`
5. `docs/02_SYSTEM_BOUNDARIES_AND_INTERFACES.md`
6. `docs/04_TEAM_OWNERSHIP_AND_WORKSPACES.md`
7. `docs/05_GIT_AND_INTEGRATION_PROTOCOL.md`
8. `contracts/openapi.yaml`
9. 对应的 `contracts/schemas/*.schema.json` 与 fixtures

旧范围文档中的 Gmail/Photon 规则尚未全部迁移时，不得据此缩小或改写
`plan.md` 已批准的 Unified Inbox 范围；应在实现计划中安排兼容性更新。

## 3. 绝对禁区

即使 W2/P3 端到端负责 Unified Inbox，也不得：

- 修改 `apps/HushApp/Hush.xcodeproj/**`。
- 修改任何 `.entitlements`、Signing、Bundle ID、App Group 或 Target。
- 未经计划明确说明而新增第三方依赖或修改根依赖/锁文件。
- 读取、打印或提交 `.env`、OAuth token、refresh token、SMTP 授权码、API key
  或其他真实凭据。
- 将真实消息正文、邮件正文、收件人或凭据写入日志、错误详情、fixtures 或
  测试快照。
- 在没有用户一次性确认的情况下发送邮件、聊天消息或其他外部承诺性内容。
- 向 AI Provider 暴露发送工具、渠道 token、SMTP 授权码或
  `confirmationToken`。
- 因网络超时或结果未知而无条件重发。
- 绕过企业管理员、应用 scope、租户策略或会话可见性。
- 将 Browser/DOM 自动化伪装成官方 API，或默认启用该降级方式。
- 将 Mock/Fixture 数据展示为真实 Provider 结果。
- 让 LLM 自由生成 Rest Quest 动作（下述 Contract 1.1 局部例外除外）。
- 保存 Guided Drift 的用户答案。
- 声称诊断疲劳、焦虑、失眠或其他医学状态。
- 修改当前任务范围之外的 Apple UI、Rest、Session 或 DeviceActivity 代码。

### 3.1 Contract 1.1 动态任务局部例外

经 Product Owner 批准，Contract 1.1 的
`work_state_or_rest_decision`（Mode A）和
`POST /v1/rest/recommend` 的 `manual_rest_quest`（Mode B）可由 StepFun
在版本化受控 Prompt 和严格结构 Schema 下生成一次性的办公休息任务。
该例外只允许返回
`title`、`duration_seconds`、`steps`；不得让模型控制通知、Shield、Lockdown、
设备、下一 checkpoint、邮件或消息。

以下流程继续使用固定内容，不在例外范围内：

- Contract 1.0 Rest Decision；
- Contract 1.0 manual rest / `POST /v1/rest/recommend`；
- fatigue reflection；
- Guided Drift、Blue Reset 和其他本地内容流程。

## 4. 所有外部能力必须可替换

外部能力必须通过供应商无关接口访问：

- `InboxSource`
- `InboxSender`
- `InboxIntelligenceProvider`
- `CredentialReferenceStore`
- `CheckpointStore`
- `UsageMonitoring`
- `AgentService`
- `RestContentProvider`
- `SessionController`

每个 Unified Inbox 外部能力至少提供：

- `Real...`
- `Fixture...`、`Unavailable...` 或等价测试实现
- 明确的失败、超时与权限撤销路径

供应商 payload、CLI 输出、SDK 类型和错误不得越过 Adapter 边界。

## 5. Unified Inbox 所有权边界

### W2 / P3

W2/P3 是 Unified Inbox 功能及对应接口的端到端唯一 Owner，负责：

- 本机 Unified Inbox Connector Host。
- 飞书 `lark-cli`、钉钉 `dws`、Outlook Graph、QQ IMAP/SMTP 的认证、连接状态、
  后台增量同步、重连、退避、checkpoint、规范化和去重。
- Unified Inbox API、存储、查询、分页和来源覆盖状态。
- AI 摘要、待办提取和回复草稿编排。
- 草稿编辑、版本控制、用户确认和幂等发送命令。
- 渠道发送 Adapter 与统一发送结果。
- Unified Inbox 的 OpenAPI、Schema、fixtures、provider contract tests 和集成
  测试。
- Unified Inbox 在 Composition Root 与 bootstrap 中的最终服务接线。
- 凭据引用、日志脱敏、审计边界和失败降级。

为完成上述职责，W2/P3 可对以下区域做与 Unified Inbox 直接相关的最小修改：

```text
contracts/openapi.yaml
contracts/schemas/**
contracts/fixtures/**
server/src/domain/**
server/src/application/inbox/**
server/src/api/**
server/src/inbox/**
server/src/messaging/**
server/src/mail/**
server/src/agent/**
server/src/infra/**
server/src/composition.ts
server/src/bootstrap.ts
server/tests/contracts/**
server/tests/provider-contracts/**
server/tests/integration/**
server/tests/unit/**
docs/**
scripts/**
```

共享文件只允许做 Unified Inbox 所需的增量修改，不得重构或改变无关 Rest、
Handoff、Apple 集成行为。新增依赖必须在实现计划中写明理由、替代方案和验证
方式，并同步更新相应 package/lock 文件。

W2/P3 不负责 App UI、Apple 平台权限、Xcode 工程或 SwiftUI 页面。M2/P4 根据
W2/P3 维护的接口实现页面；M1/P1 负责 Apple 客户端模型与最终接线。

### W1 / P2

- 不负责 Unified Inbox 的功能实现、接口、契约、AI 编排或服务接线。
- 继续维护 Unified Inbox 之外的既有后端能力。
- 当共享后端基础设施受影响时参与兼容性评审，但不与 W2/P3 共同拥有本功能。

## 6. API 与数据契约规则

- `contracts/` 是跨端接口的唯一事实来源；实现前先更新并验证契约。
- 字段名、枚举、空值和时间格式必须与 OpenAPI/Schema/TS 模型一致。
- 时间统一为带时区的 ISO 8601。
- 未知或无法安全判断的优先级使用 `uncertain`。
- 原始消息、AI 摘要和用户草稿必须分开保存。
- 迟到的 AI 结果不得覆盖用户已编辑草稿。
- 草稿修改与发送必须校验 `expectedVersion`。
- 发送必须同时校验一次性 `confirmationToken` 与 `idempotencyKey`。
- 发送超时使用 `unknown`；确认 Provider 状态前不得自动重试。
- 同一 `provider + account_id + provider_message_id` 只生成一个 Inbox item。
- 每个 API 变更必须同步更新 OpenAPI、Schema、TS 类型、fixtures、contract
  tests 和受影响消费者说明。
- 所有客户端入口只生成 `RestEntryContext`，不得复制业务流程。
- Contract 1.0 和其他固定内容流程返回 Quest 时优先返回 `quest_id`，
  步骤以固定内容库为准。
- Contract 1.1 的 Mode A / Mode B 返回结构化 `generated_task`；
  `default_quest_id` 必须为 `null`。
- Contract 1.1 Mode A / Mode B 的 `generated_task` 是一次性结构化任务，
  `default_quest_id` 必须为 `null`，不得查询固定 Quest Repository。

## 7. Superpowers Style 工作流

非 trivial 工作必须遵循上级 AGENTS 的流程，并使用适用的 Superpowers skill：

1. **Exploration**：检查最新远端、仓库结构、相关契约、实现和测试。
2. **Design**：先使用 brainstorming；Unified Inbox 总体设计已在 `plan.md`
   获得用户批准，范围改变时重新走设计确认。
3. **Planning**：实现前使用 writing-plans，把工作拆成可独立验证的任务并保存
   到 `docs/superpowers/plans/`。
4. **Isolation**：执行计划前使用 using-git-worktrees；不得覆盖其他成员工作。
5. **Implementation**：使用 test-driven-development，严格执行
   RED → GREEN → REFACTOR。
6. **Debugging**：遇到失败或异常先使用 systematic-debugging，不随机打补丁。
7. **Verification**：完成前使用 verification-before-completion，运行完整验证
   命令并检查真实输出。
8. **Review**：重大任务完成后使用 requesting-code-review，再决定合并或推送。

不得在测试尚未出现预期失败前编写对应生产代码。每个实现任务保持小提交，
提交中不得混入无关格式化或重构。

## 8. 当前任务卡

`plan.md` 是当前 Unified Inbox 工作的已批准任务卡，Owner 为 W2/P3。它明确
授权 W2/P3 实现功能及对应接口，并定义：

- 允许范围与不在本阶段的功能。
- Unified Inbox 数据模型和 API。
- AI 权限隔离、用户草稿修改权和唯一发送确认权。
- 四个 Provider 的实现边界。
- 失败处理、安全要求、测试重点和完成标准。

若 `plan.md` 与更早的 Gmail/Photon 文档冲突，Unified Inbox 工作以本文件、
`README.md` 和 `plan.md` 为准；无关功能仍遵循原有 Owner 与契约。

## 9. 完成前自检

提交前必须：

1. 只修改 Unified Inbox 所需文件，并能说明每处改动与任务的关系。
2. 对每项新行为保留 RED 与 GREEN 的测试证据。
3. 运行 typecheck、相关测试、contract tests、integration tests 和 build。
4. 使用 fixtures 验证成功、空数据、权限不足、超时、失败和 `unknown`。
5. 验证重启 checkpoint、事件去重、草稿版本冲突和发送幂等。
6. 验证没有未经用户确认的发送路径。
7. 验证 AI 无渠道凭据、发送工具或确认令牌。
8. 验证日志、错误、fixtures 和 git diff 不含密钥或真实个人数据。
9. 在交付说明中列出 Real、Fixture、Unavailable 能力及未完成的真实授权验证。
10. 给出复现命令和准确测试结果，不把未验证能力描述为已完成。
