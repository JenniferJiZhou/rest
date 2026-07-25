# 01｜产品范围与功能流程协议

## 1. Must 主线

### A. Day Reset

```text
Hush Door / 自动触发
→ 用户选择“说说我怎么累”或“直接来一个”
→ Name the Tiredness（最多一个 follow-up）
→ Rest Quest（固定安全内容库）
→ Rest Session（1–6 分钟）
→ Guided Drift 或安静
→ 双问反馈
```

自动行为检查点另有一个受控分支：

```text
Usage checkpoint
→ Contract 1.1 Mode A
→ false：仅更新常亮陪伴文案
→ true：返回一次性的 generated_task
→ Apple 决定是否通知并展示 Rest Session
```

主动进入的 manual rest 按版本协商：Contract 1.0 仍从固定 Quest 库选择；
Contract 1.1 由 Mode B 返回一次性的 `generated_task`。

### B. Sleep Handoff

```text
App / iMessage 发起“我准备睡了”
→ 用户主动交接未尽事项
→ 创建 Handoff Job
→ Gmail 拉取未读
→ LLM 分类与草稿建议
→ Gmail 创建草稿，永不自动发送
→ Pause Receipt：已接住、未覆盖、明天第一步
→ Blue Reset 枕上引导
```

### C. Hush Phone

```text
Photon 入站消息
→ Intent Router
→ check-in / recommend / handoff
→ 最多两轮消息
→ 给出具体 Rest Quest 或交班结果
```

## 2. 功能接口映射

| 功能 | 是否需要后端 | 工程入口 |
|---|---:|---|
| Hush Door | 否 | `RestEntryRouting` |
| Name the Tiredness | 是；失败可本地标签降级 | `POST /v1/rest/check-in` |
| Manual Rest Quest | 1.0 选固定 ID；1.1 返回动态任务 | `POST /v1/rest/recommend` |
| 自动 Rest Decision 1.1 | 后端返回一次性 `generated_task`；Apple 决定呈现 | `POST /v1/rest/evaluate` |
| Day Reset | Session 本地运行 | `RestSessionControlling` |
| Guided Drift | 否，纯本地 | `RestContentProvider` |
| AI Wait Reset | 使用 Handoff Job 预计等待 | `POST/GET /v1/handoff/...` |
| Sleep Handoff | 是 | Handoff Job + Gmail |
| Hush Phone | 是 | Photon webhook + 内部 Intent Router |
| Blue Reset | 否，纯本地内容 | `RestContentProvider` |
| Rest Memory | 优先本地；反馈可匿名提交 | `POST /v1/rest/feedback` |

## 3. Must / Should / Could / Won't

### Must

- iOS 主动入口。
- macOS 菜单栏主动入口。
- Name the Tiredness 最多两轮。
- Contract 1.0 Manual Rest Quest 固定库。
- Contract 1.1 Mode A / Mode B 的受控结构化动态任务。
- Day Reset 会话与反馈。
- Guided Drift 本地题库。
- Photon 可收发的 Hush 消息身份。
- Gmail Demo 账号真实读取和创建草稿。
- Sleep Handoff 与 Pause Receipt。
- Blue Reset 实体体验。
- 全链路 Sample Mode。

### Should

- DeviceActivity 真实阈值。
- Live Activity。
- AI Wait Reset。
- Rest Anchors。
- 次日晨间摘要。
- macOS NSWorkspace 自动监测。
- 语音识别。
- 轻量 Rest Memory。

### Could

- NFC 快捷指令。
- Widget / App Intent / Action Button。
- Photon 群聊。
- Live Activity 交互按钮。
- 非 Demo Gmail 用户 OAuth。

### Won't

- 医疗诊断。
- 读取用户既有 iMessage、微信或第三方 App 内手势。
- 自动发送邮件。
- Windows/Android 客户端。
- Apple Watch 生理数据。
- 系统级悬浮球。
- 永久后台录音。
- 复杂长期个性化模型。
- 除 Contract 1.1 Mode A / Mode B 的受控办公休息任务外，让 LLM 自由生成任意现实动作。

## 4. 安全与产品语言

- “fatigue type”是推荐分类，不是诊断。
- Handoff 结论必须写明覆盖范围。
- 无法判断的邮件放入 `uncertain`。
- “今晚没有必须处理的事”只能表述为：
  “在已授权 Gmail 和你主动交接的事项中，没有发现必须今晚处理的内容。”
- Photon 是联系人，不是读取用户数据的后门。
