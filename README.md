# Hush Development Protocol Pack v1

本仓库骨架依据《Hush — An Ambient Rest Agent（最终整合版 v3.0）》拆解，服务于 **4 人 + Coding Agent、2.5 天黑客松并行开发**。

## 先读顺序

1. `docs/00_PROTOCOL_INDEX.md`
2. `docs/01_SCOPE_AND_FEATURE_FLOWS.md`
3. `docs/04_TEAM_OWNERSHIP_AND_WORKSPACES.md`
4. `contracts/openapi.yaml`
5. `docs/03_RUNTIME_AND_FAILURE_PROTOCOL.md`
6. `AGENTS.md`

## 四个角色

- **M1 / P1（Mac）**：Apple 平台、Xcode、共享核心、Session、最终集成。
- **M2 / P4（Mac）**：SwiftUI 产品界面、Design System、Rest Quest 与内容、Demo。
- **W1 / P2（Windows）**：统一 Inbox API 与契约、存储和查询、AI 摘要与回复草稿编排、草稿版本和用户确认、幂等发送命令、服务组合根。
- **W2 / P3（Windows）**：本机 Unified Inbox Connector Host；负责飞书 `lark-cli`、钉钉 `dws`、Outlook Graph、QQ IMAP/SMTP 的认证、后台增量同步、规范化、去重、checkpoint 与发送 Adapter；不负责 Inbox 业务编排、AI 规则、公共契约或 App 页面。

## 核心工程原则

- 每个外部依赖必须有 `Protocol/Interface + Real + Mock`。
- 客户端第一小时即可使用 fixtures 跑通，不等待后端。
- `main` 永远能够在 Sample Mode 下完成主流程。
- 公共契约、Xcode 工程文件、根依赖文件均有唯一 Owner。
- 业务代码只依赖协议，不直接依赖具体消息、邮件、AI Provider 或 DeviceActivity。
- AI 只生成摘要和可编辑回复草稿；用户在 Hush 内拥有最终修改权，且只有用户主动确认后才能通过 Provider Adapter 发送。
- Rest Quest 与 Blue Box 内容来自固定 JSON；LLM 只能选择和组织，不能自由生成危险动作。

## 当前包的性质

这是**协议与目录骨架**，不是完整实现。空目录使用 `.gitkeep` 保留，后续由负责人或 Coding Agent 按任务卡填充。
