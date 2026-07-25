# 08｜Definition of Done 与测试协议

## 1. 全局 DoD

任何任务完成必须满足：

- 只修改任务允许目录。
- 对应成功和失败路径已测试。
- 不改契约，或已通过 Contract Change。
- Real/Mock 均可注入。
- 错误可被用户理解。
- 无密钥、隐私内容或未清理调试日志。
- PR 描述包含复现方法。
- main Sample Mode 主线未被破坏。

## 2. 功能验收

### Hush Door

- iOS App 和 Mac 菜单栏均可主动进入。
- 不需要网络。
- 可选择 check-in 或 Surprise Me。
- 所有入口最终使用同一 `RestEntryRouter`。

### Name the Tiredness

- 支持五类疲劳与 `unknown`。
- 最多一个 follow-up。
- 失败时可用本地快捷标签继续。
- 不出现诊断性语言。

### Rest Quest

- 返回的 `quest_id` 在本地库存在。
- Quest 1–6 分钟、无需持续看屏幕。

以上固定内容验收适用于 Contract 1.0。Contract 1.1 Mode A 按
`generated_task` 的结构与 true/false 关系验收，Mode B 按必有动态任务
验收；两者均不增加时长范围、关键词、allowlist 或语义内容 Guard；专用
测试矩阵见
`docs/22_DYNAMIC_REST_TASK_CONTRACT_1_1.md`。
- 支持换一个。
- 不生成危险动作或无边界家务。

### Day Reset

- start/pause/resume/end 工作。
- App 退出/锁屏后状态可合理恢复。
- Live Activity 若启用，不残留。
- 结束后双问反馈。

### Guided Drift

- 纯本地。
- 不保存答案。
- 一次只显示一个问题。
- Reduce Motion 正常。

### Sleep Handoff

- Demo Gmail 能读取。
- 至少创建一个真实草稿且不发送。
- 重试不创建重复草稿。
- `uncertain` 可见。
- Pause Receipt 展示覆盖与未覆盖来源。
- Gmail 失败仍能保存 open loops。

### Photon

- 非团队 iPhone 可入站。
- 两轮内给出 Quest 或进入 Handoff。
- Webhook 去重。
- 签名失败返回 401。
- ConsoleChannel 可替代真实 Photon 联调。

## 3. 契约测试

W1：

- 每个 fixture 通过 JSON Schema。
- OpenAPI 可解析。
- Zod schema 与 fixtures 相容。

M1：

- Swift Codable 能解码同一 fixture。
- 枚举和 null 处理一致。
- 错误 fixture 能映射为用户状态。

冻结契约后，CI 必须阻止不兼容 fixture 合并。

## 4. Demo Smoke Test

至少连续 5 次：

```text
1. iOS/Mac 主动入口
2. check-in
3. quest
4. session
5. feedback
6. iMessage 发“我准备睡了”
7. handoff job
8. Gmail 草稿
9. pause receipt
10. blue reset
```

额外测试：

- 拔网线。
- 开启 Sample Mode。
- Gmail 未连接。
- LLM 超时。
- Photon 不可用。
- DeviceActivity 不触发。
- App 后台再回来。
- Handoff 超过 60 秒。

## 5. 真实/模拟能力清单

提交前维护一张只读页面：

| 能力 | REAL | MOCK | 现场状态 |
|---|---:|---:|---|
| iOS 主动入口 | ✅ | — | |
| Mac 菜单栏 | ✅ | — | |
| DeviceActivity | | ✅ | |
| Claude | | ✅ | |
| Gmail 读取 | | ✅ | |
| Gmail 草稿 | | ✅ | |
| Photon iMessage | | ✅ | |
| Blue Box 内容 | | ✅ | |

不得把 MOCK 勾成 REAL。
