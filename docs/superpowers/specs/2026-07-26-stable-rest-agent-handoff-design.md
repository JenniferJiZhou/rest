# Hush 稳定版 Rest Agent 端到端设计

日期：2026-07-26
状态：已确认，待实施计划
验收环境：线上 staging + HushMac + 真机 iPhone

## 1. 目标

完成以下真实链路：

```text
Mac 使用监测
→ 服务端判断是否该休息
→ LLM 从固定安全任务库中选择一个任务
→ Mac 将最终建议同步给 iPhone
→ iPhone 常亮模式展示自然开场和本地任务
```

稳定版必须满足：

1. LLM 只能选择固定内容库中的 `quest_id`，不得生成任务动作。
2. Mac、服务端和 iPhone 统一使用现有 `1.0` 契约。
3. iPhone 始终从本地内容库读取任务标题、时长、步骤和安全说明。
4. 服务端、模型或设备连接失败时，用户仍能获得本地安全任务。
5. 用户界面不显示 HTTP、LLM、契约或同步错误等技术信息。
6. staging、Mac App 和真机 iPhone 可以完成真实端到端验收。

## 2. 非目标

本次不包含：

- 让 LLM 自由生成新的 Rest Quest、现实动作或安全建议。
- 修改 Rest Quest 公共数据契约或升级到 `1.1`。
- 医疗判断、疲劳诊断或健康结论。
- 根据窗口正文、键盘输入、屏幕截图或页面内容做推荐。
- 自动开始休息、屏蔽应用或替用户执行外部操作。
- 重做当前波浪视觉、睡前交接或统一收件箱。
- 引入长期个性化、向量数据库或新的第三方依赖。

## 3. 核心决策

采用 **Mac 两阶段编排**：

1. Mac 调用 `POST /v1/rest/evaluate` 判断是否需要提醒。
2. 仅当 `should_offer_rest == true` 时，Mac 调用
   `POST /v1/rest/recommend`，让 Agent 从固定候选任务中选择
   `quest_id` 并返回简短 `intro`。
3. Mac 合并两次结果，通过现有 Companion Sync 同步给 iPhone。
4. iPhone 使用 `quest_id` 读取本地固定任务并展示。

不采用以下方案：

- 不把 LLM 选择逻辑塞进 `/rest/evaluate`。判断时机和选择任务保持分离。
- 不让 iPhone 收到提醒后再请求 `/rest/recommend`。Agent 链路不依赖真机当时的网络状态。
- 不保留客户端当前不兼容的 `generated_task` `1.1` 请求格式。

## 4. 组件职责

### 4.1 HushMac

Mac 是完整链路的编排者，负责：

- 收集最少必要的使用上下文。
- 执行本地冷却、去重和每日提醒限制。
- 调用 `/rest/evaluate`。
- 在需要休息时调用 `/rest/recommend`。
- 验证请求 ID、响应契约、内容版本和数据来源。
- 合成最终 `HushCompanionDecision`。
- 通过 Companion Sync 将快照同步给 iPhone。
- 接收 iPhone 的休息开始、完成、稍后和跳过命令。

Mac 可以上传：

- 连续屏幕使用时长。
- 当前 App 或网站的用户可见类别/标签。
- 最近切换次数。
- 当天累计使用时间。
- 当前小时、来源和用户主动提供的上下文标签。
- 冷却状态所需的非敏感时间信息。

Mac 不上传：

- 窗口正文。
- 网页正文或 URL 查询参数。
- 键盘输入。
- 截图、剪贴板或文件内容。

### 4.2 Hush Backend

服务端保留两个清晰职责：

#### `/v1/rest/evaluate`

- 根据使用摘要、冷却和阈值判断是否需要提醒。
- 返回 `should_offer_rest`、`reason_code`、基础 `message`、
  可选 `default_quest_id` 和允许动作。
- 不要求每次使用 LLM。

#### `/v1/rest/recommend`

- 校验 `content_version`。
- 根据时长、精力、地点、偏好、排除项过滤固定任务库。
- 只把符合条件的候选任务元数据交给 Agent。
- 要求 Agent 返回候选集中的一个 `quest_id`、`reason_code` 和
  可选 `intro`。
- 拒绝未知 ID、错误版本和不符合 Schema 的输出。

### 4.3 Agent LLM

Agent 可以：

- 从服务端提供的候选 ID 中选择一个任务。
- 写一条不超过 200 字的具体中文开场。
- 返回解释选择依据的受限 `reason_code`。

Agent 不可以：

- 输出任务步骤或替换任务内容。
- 发明 `quest_id`。
- 输出医疗、诊断或危险动作。
- 决定跳过冷却或直接开始休息。

推荐提示词约束：

```text
Select exactly one quest from the provided fixed library.
Never invent a quest ID, task step, medical advice, or safety advice.
The intro must be short, concrete, ordinary Chinese.
Avoid abstract wellness language and an assistant-like tone.
Return JSON only and follow schema_version, request_id and content_version.
```

### 4.4 iPhone

iPhone 是执行和展示端，负责：

- 接收并按 `session_id + sequence + decision_id` 去重快照。
- 检查 `quest_id` 是否存在于本地内容库。
- 从本地读取任务标题、时长、步骤和安全说明。
- 展示开场和任务。
- 在本地管理开始、完成、稍后、跳过、冷却和触觉反馈。
- 将用户命令同步回 Mac。

iPhone 不接受服务端提供的自由任务步骤。

## 5. 详细数据流

### 5.1 正常工作态

1. HushMac 启动监测并按现有节流频率生成 Usage Summary。
2. Mac 将计时和连接状态持续同步给 iPhone。
3. iPhone 常亮页只显示轻量计时和波线，不持续展示陪伴式文案。

### 5.2 判断是否提醒

1. 本地冷却允许评估时，Mac 生成唯一 `request_id`。
2. Mac 以 `X-Contract-Version: 1.0` 调用 `/v1/rest/evaluate`。
3. Mac 验证 HTTP 状态、响应头、响应请求 ID 和响应 Schema。
4. 如果 `should_offer_rest == false`，本轮结束，不调用 LLM。
5. 如果 `should_offer_rest == true`，进入任务选择阶段。

### 5.3 Agent 选择任务

Mac 构造现有 `RestRecommendationRequest`：

```json
{
  "schema_version": "1.0",
  "request_id": "req_recommend_xxx",
  "session_id": "mac_session_xxx",
  "content_version": "<bundled version>",
  "fatigue_type": "unknown",
  "user_preference": "surprise",
  "available_minutes": 3,
  "source": "manual_macos",
  "location_tags": ["any"],
  "excluded_quest_ids": [],
  "allowed_quest_ids": ["wash_face_01", "look_far_01"]
}
```

字段取值规则：

- `fatigue_type`：没有用户自述时使用 `unknown`，不得推断诊断。
- `user_preference`：使用用户已明确选择的 `quiet`、`move` 或
  `surprise`；没有选择时使用 `surprise`。
- `available_minutes`：使用用户设置或当前默认值，限制在 1 到 10。
- `location_tags`：只使用显式环境标签；未知时使用 `any`。
- `excluded_quest_ids`：包含最近完成、冷却中或用户刚跳过的任务。
- `allowed_quest_ids`：来自 Mac 随 App 打包的固定内容库。

服务端返回现有 `RestQuestRecommendation`：

```json
{
  "schema_version": "1.0",
  "request_id": "req_recommend_xxx",
  "content_version": "<bundled version>",
  "quest_id": "wash_face_01",
  "reason_code": "long_continuous_use",
  "intro": "先离开屏幕一会。",
  "fallback_quest_id": "look_far_emergency"
}
```

### 5.4 合并并同步

Mac 合并结果时使用以下优先级：

- `quest_id`：Agent 推荐 ID → evaluate 的有效默认 ID → 本地安全 ID。
- `message`：包含真实使用上下文的 evaluate `message` → 非空 Agent `intro` →
  本地普通开场。`RestRecommendationRequest` 1.0 不包含连续使用分钟数，Agent
  不得自行写出时长。
- `reason_code`：保留 evaluate 的打断原因；推荐原因只用于调试信息。
- `data_origin`：推荐成功时使用 `/recommend` 本次实际来源；Mac 本地降级时使用
  Apple 私有 Companion 值 `local`。HTTP 公开来源仍只有 `real | mock | cached`。

最终 Companion Decision 至少包含：

```text
id
shouldOfferRest
reasonCode
message
defaultQuestID
dataOrigin
createdAt
```

该对象随现有 `HushCompanionSnapshot` 同步给 iPhone。

## 6. 数据来源标记

当前服务端用整个依赖图静态推导 `restOrigin`。由于正常图包含规则 Provider
和 Canned fallback，即使 Claude 实际成功，响应仍可能被标为 `mock`。稳定版不能沿用
这个结果判断 `/recommend` 的真实来源。

设计要求：

- `/recommend` 返回头必须反映本次选择实际使用的 Provider。
- Claude 成功：`X-Hush-Data-Origin: real`。
- Claude 失败并使用 Canned fallback：`X-Hush-Data-Origin: mock`。
- 未来命中缓存：`X-Hush-Data-Origin: cached`。

实现应增加仅服务端内部使用的推荐执行结果封装：

```typescript
type RestRecommendationExecution = {
  response: RestQuestRecommendation;
  dataOrigin: "real" | "mock" | "cached";
};
```

该封装不改变公开 JSON body。API 层在发送响应前根据 execution 设置响应头，避免共享
可变的 `lastOrigin`，保证并发请求不会串来源。

## 7. iPhone 展示设计

### 7.1 正常工作态

- 黑色背景与现有波线。
- 顶部只显示低对比度的连续使用计时。
- 不持续出现“我在这里陪你”等助手式文案。
- 点击仍可查看工作详情，长按仍可主动请求休息。

### 7.2 Agent 触发态

界面保持无卡片、无弹窗、无大图标：

```text
69 分钟了。
累了吧？

去洗把脸。
手机就留在这里。

大约 2 分钟 · 不用看屏幕

休息好了
```

展示规则：

- 开场优先来自 Mac/evaluate 的真实使用上下文，最多两行；只有它为空时才使用
  Agent `intro`。Agent 不得编造连续使用分钟数。
- 任务标题和动作来自本地固定内容库。
- 不显示编号步骤。
- 不显示“AI 推荐”“Agent 已连接”或模型名称。
- “休息好了”保持低权重，不与任务文本竞争。
- 真实任务与本地降级任务使用同一视觉结构，避免失败时跳版。

### 7.3 本地降级态

```text
先停一会。

看向房间里最远的地方，
让眼睛歇一分钟。

休息好了
```

主界面不展示技术错误。`data_origin == local` 时不增加来源标签。
`data_origin == mock` 表示服务端实际返回了演示结果，此时常亮页必须显示低权重但
持续可见的“演示模式”标识，设置页同时提供来源详情，不能伪装成真实模型结果。

### 7.4 完成态

用户选择“休息好了”后：

1. iPhone 清除当前展示任务。
2. iPhone 向 Mac 发送 `restCompleted`。
3. Mac 清除当前 Decision 并启动冷却。
4. iPhone 回到计时与波线，不追加总结性 AI 文案。

## 8. 失败与降级

| 失败点 | 行为 | 用户看到 |
|---|---|---|
| evaluate 网络失败 | 本轮不自动提醒；主动请求时使用本地任务 | 普通本地任务 |
| evaluate 返回不兼容契约 | 拒绝响应并记录调试错误 | 不显示技术错误 |
| recommend 超时或 5xx | 使用 evaluate 有效默认 ID 或本地安全 ID | 本地任务 |
| Agent 输出未知 ID | 服务端拒绝；Mac 使用 fallback | 本地任务 |
| content_version 不一致 | Mac 不使用服务端 ID | 本地任务 |
| recommend 返回 mock | 可以展示安全结果，但标记 Sample Mode | 主任务不跳版 |
| Companion Sync 断开 | Mac 保存最新 Decision；重连后按 ID 同步一次 | 重连后最多出现一次 |
| iPhone 缺少 quest_id | 使用内置 emergency fallback | 本地安全任务 |
| 用户稍后提醒 | 清除当前展示并进入冷却 | 回到工作态 |
| 用户跳过 | 记录排除 ID，避免立即推荐同一任务 | 回到工作态 |

所有自动评估和推荐 POST 请求均不自动重试。新的评估周期可以生成新的请求 ID，但同一
Decision 不得重复展示。

## 9. staging 配置与部署

staging 必须配置：

- `CLAUDE_API_KEY`
- `CLAUDE_MODEL`
- 与客户端一致的固定内容版本
- 正常 Rest Agent 图启用
- Demo Token 与公开正常请求严格隔离

密钥只能存在于部署平台环境变量中，不写入仓库、Xcode 设置、App Group 或日志。

部署后验证：

1. `/v1/health` 可访问，staging 运行配置包含真实 Agent Provider。
2. 正常 `/rest/recommend` 返回契约 `1.0`。
3. Claude 成功时响应头为 `real`。
4. 强制 fallback 时响应头为 `mock`。
5. 返回的 `quest_id` 一定属于请求允许集合。

## 10. 测试策略

### 10.1 服务端单元与契约测试

- Agent 只能返回允许集合中的 ID。
- 未知 ID 被拒绝并触发安全 fallback。
- `content_version` 不一致返回既有错误。
- Claude、Canned 和缓存路径分别返回正确 data origin。
- 并发请求的数据来源不会相互污染。
- Prompt 和 Zod Schema 不接受任务步骤字段。

### 10.2 Mac 单元测试

- evaluate 为 false 时不调用 recommend。
- evaluate 为 true 时只调用一次 recommend。
- Agent ID、evaluate 默认 ID、本地 fallback 的优先级正确。
- evaluate 事实开场、Agent intro、本地开场的优先级正确。
- 请求头、请求 ID 和契约版本正确。
- 超时、错误 Schema、未知 ID 和版本不一致均降级。
- 同一 Decision 不重复同步。

### 10.3 iPhone 单元与 UI 测试

- 收到有效 `quest_id` 时使用本地内容。
- 收到未知 ID 时使用 emergency fallback。
- 任务不显示编号步骤。
- 长文不会与波线、状态栏或操作重叠。
- Dynamic Type 和 Reduce Motion 下内容可用。
- 完成、稍后和跳过会发出正确命令。

### 10.4 真机端到端验收

使用 staging、HushMac 和真机 iPhone：

1. 两端配置同一 staging 地址并建立 Companion 连接。
2. 使用调试阈值制造一次连续使用触发。
3. Mac 成功完成 evaluate 和 recommend。
4. staging 日志确认 Claude 路径成功，且不记录密钥或敏感正文。
5. iPhone 在 Decision 同步后数秒内展示与返回 `quest_id` 对应的本地任务。
6. iPhone 展示最终合成开场，但不展示 AI 技术信息或编号步骤。
7. 点击“休息好了”后两端清除同一 Decision 并启动冷却。
8. 冷却期间不会重复提醒。
9. 关闭 Agent 或断网重复测试，iPhone 仍展示本地安全任务。
10. 断开并恢复 Companion 连接，同一 Decision 最多展示一次。

## 11. 实施边界

预计涉及：

- `apps/HushApp/MacMenuBar/Platform/`
- `apps/HushApp/Shared/Core/Networking/`
- `apps/HushApp/Shared/Features/RestQuest/`
- `apps/HushApp/iOSApp/App/`
- `apps/HushApp/iOSApp/Platform/`
- `server/src/agent/`
- `server/src/application/rest/`
- `server/src/api/`
- 对应 `server/tests/` 与 Apple 测试目标

现有公开 `contracts/` 保持 `1.0`，除非实施时发现代码与已提交 Schema 不一致；任何
契约修改必须另行提出 Contract Change，不得在本任务中静默完成。

## 12. 完成定义

只有同时满足以下条件才算完成：

- staging 的真实 Claude 路径可验证。
- Mac 自动监测触发 evaluate → recommend。
- Agent 只能选择固定任务库 ID。
- 真机 iPhone 展示正确本地任务和自然开场。
- real/mock 来源准确。
- 所有失败路径安全降级且不重复打扰。
- 服务端、Mac 和 iPhone 的相关自动测试通过。
- 真机端到端验收步骤留有可复现记录。
