# AGENTS.md — Hush Coding Agent Rules

本文件对仓库内所有 Coding Agent 生效。除非任务卡明确授权，否则不得违反。

## 1. 项目目标

Hush 是一个环境式休息 Agent，Must 主线为：

`Hush Door → Name the Tiredness → Rest Quest → Rest Session → Feedback`

并包含：

`Sleep Handoff → Gmail 摘要/草稿 → Pause Receipt → Blue Reset`

Photon 只提供 Hush 自己的消息身份，不读取用户既有 iMessage、微信或邮箱。

## 2. 必读文件

- `docs/01_SCOPE_AND_FEATURE_FLOWS.md`
- `docs/02_SYSTEM_BOUNDARIES_AND_INTERFACES.md`
- `docs/04_TEAM_OWNERSHIP_AND_WORKSPACES.md`
- `docs/05_GIT_AND_INTEGRATION_PROTOCOL.md`
- `contracts/openapi.yaml`
- 对应的 `contracts/schemas/*.schema.json`
- 任务卡指定的 fixture

## 3. 绝对禁区

未经任务卡与 Owner 明确授权，不得：

- 修改 `apps/HushApp/Hush.xcodeproj/**`
- 修改任何 `.entitlements`、Signing、Bundle ID、App Group、Target
- 修改 `contracts/**`
- 修改根 `package.json`、`pnpm-lock.yaml`、Swift Package 依赖
- 新增第三方依赖
- 读取或提交 `.env`、OAuth token、refresh token、API key
- 调用 Gmail 发送接口
- 自动发送邮件或外部承诺性消息
- 让 LLM 自由生成 Rest Quest 动作（下述 Contract 1.1 局部例外除外）
- 保存 Guided Drift 的用户答案
- 声称诊断疲劳、焦虑、失眠或其他医学状态
- 将 Mock 数据展示为真实数据
- 修改任务卡允许目录之外的文件

### 3.1 Contract 1.1 动态任务局部例外

经 Product Owner 批准，`POST /v1/rest/evaluate` 的 Contract 1.1
`work_state_or_rest_decision` 模式可由 StepFun 在版本化受控 Prompt 和严格
结构 Schema 下生成一次性的办公休息任务。该例外只允许返回
`title`、`duration_seconds`、`steps`；不得让模型控制通知、Shield、Lockdown、
设备、下一 checkpoint、邮件或消息。

以下流程继续使用固定内容，不在例外范围内：

- Contract 1.0 Rest Decision；
- manual rest / `POST /v1/rest/recommend`；
- fatigue reflection；
- Guided Drift、Blue Reset 和其他本地内容流程。

## 4. 所有外部能力必须可替换

必须通过协议访问：

- Usage Monitoring
- Agent Service
- Mail Provider
- Messaging Channel
- LLM Provider
- Rest Content Provider
- Session Controller

每个外部能力至少有：

- `Real...`
- `Mock...` 或 `Console...`
- 明确的失败路径

## 4.1 Provider 所有权边界

W1 / P2 维护供应商无关端口和最终接线：

- `server/src/domain/ports.ts`
- `server/tests/provider-contracts/**`
- `server/src/composition.ts`
- `server/src/bootstrap.ts`

W1 定义 `MailProvider` 与 `MessagingChannel`，但不实现 Gmail Provider、
Gmail OAuth、Photon Provider、Photon SDK 或 Photon Webhook Adapter。

Gmail Owner 只允许修改：

- `server/src/mail/**`
- `server/tests/integration/gmail*`
- `scripts/seed-gmail.*`
- `scripts/clear-demo-drafts.*`
- `docs/gmail/**`

W2 / P3 只允许修改：

- `server/src/messaging/**`
- `server/tests/integration/photon*`
- `scripts/gen-qr.*`
- `docs/photon/**`

所有 Provider Owner 均不得修改：

- `server/src/domain/ports.ts`
- `server/src/application/**`
- `contracts/**`
- `server/src/composition.ts`
- `server/src/bootstrap.ts`

如现有端口无法实现，必须先发起 Contract Change PR，列出兼容性、调用方和
fixture 影响；不得在 Provider PR 中静默修改契约。Provider 实现完成后由 W1
在 Composition Root 接线。

## 5. 数据契约规则

- 字段名、枚举、空值、时间格式以 `contracts/` 为准。
- 时间统一为 ISO 8601 且带时区。
- 未知或无法安全判断的优先级必须使用 `uncertain`，不得强制归类。
- 所有客户端入口只生成 `RestEntryContext`，不得复制业务流程。
- Contract 1.0、manual rest 和其他固定内容流程返回 Quest 时优先返回
  `quest_id`，步骤以固定内容库为准。
- Contract 1.1 Mode A 的 `generated_task` 是一次性结构化任务，
  `default_quest_id` 必须为 `null`，不得查询固定 Quest Repository。

## 6. 完成前自检

提交前必须：

1. 只修改允许目录。
2. 编译/测试通过。
3. 使用指定 fixture 验证成功、空数据、超时和失败。
4. 不泄露密钥和个人数据。
5. 不改变既有契约。
6. 在 PR 中列出真实能力与 Mock 能力。
7. 给出复现命令。
8. 说明未完成或不确定之处。

## 7. Agent 任务卡最小格式

```markdown
## 任务
<一句话>

## Owner
P1/P2/P3/P4

## 允许修改目录
- ...

## 依赖契约
- contracts/...

## 输入 fixture
- contracts/fixtures/...

## 验收标准
1. ...
2. ...

## 禁止事项
- ...
```

没有完整任务卡时，不开始跨模块开发。
