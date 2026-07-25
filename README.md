# Hush Development Protocol Pack v1

本仓库依据《Hush — An Ambient Rest Agent（最终整合版 v3.0）》拆解，服务于 **4 人 + Coding Agent、2.5 天黑客松并行开发**。当前已包含可执行的 W1 Fastify 后端、Contract v1、Provider Integration Kit、Mock Vertical Slice 与 Apple Mock Integration Release；其余平台模块仍按 Owner 任务卡推进。

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
- **W1 / P2（Windows）**：非 Unified Inbox 的后端 API、Rest Agent、Handoff Job 与既有后端能力维护；不负责 Unified Inbox 功能实现或接口。
- **W2 / P3（Windows）**：端到端负责 Unified Inbox 功能及对应接口，包括本机 Connector Host，飞书 `lark-cli`、钉钉 `dws`、Outlook Graph、QQ IMAP/SMTP 接入，认证与后台同步，Inbox API、存储和查询，AI 摘要与回复草稿编排，草稿编辑与用户确认，幂等发送，公共契约、测试及最终服务接线；App UI 由 M2/P4 按 W2/P3 提供的接口实现。

## 核心工程原则

- 每个外部依赖必须有 `Protocol/Interface + Real + Mock`。
- 客户端第一小时即可使用 fixtures 跑通，不等待后端。
- `main` 永远能够在 Sample Mode 下完成主流程。
- 公共契约、Xcode 工程文件、根依赖文件均有唯一 Owner。
- 业务代码只依赖协议，不直接依赖具体消息、邮件、AI Provider 或 DeviceActivity。
- AI 只生成摘要和可编辑回复草稿；用户在 Hush 内拥有最终修改权，且只有用户主动确认后才能通过 Provider Adapter 发送。
- Rest Quest 与 Blue Box 内容来自固定 JSON；LLM 只能选择和组织，不能自由生成危险动作。

## 当前包的性质

这是**协议、可执行后端和分阶段客户端工程并存的开发仓库**，不是已完成的生产系统。Unified Inbox 的 Fixture 端到端路径和四渠道 Real Adapter 已实现；飞书/钉钉租户审批、Outlook delegated token、QQ 邮箱授权码、Apple 真机最后一跳和 HTTPS staging 仍需真实环境验证。

HTTPS staging、Render、Docker 与 Apple 真机交接步骤见
`docs/18_HTTPS_STAGING_AND_CLOUD_DEPLOYMENT.md` 和
`docs/17_APPLE_REST_DECISION_HANDOFF.md`。仓库只提供可重复配置，不包含已创建的
云资源、证书或 Secret。

## Unified Inbox 真实账号 Demo

- macOS/iOS 飞书、钉钉真实账号安装、授权、preflight、read smoke、证据和清理步骤：
  `docs/feishu-dingtalk-real-validation/README.md`
- Apple 前端 Agent 对接真实 Unified Inbox API 的接口、安全边界和验收清单：
  `docs/unified-inbox-apple-frontend-handoff.md`

当前 SwiftUI Unified Inbox 仍使用 Fixture Sample Mode。后端真实读取可以独立
验证；真实 UI 确认、草稿编辑和发送必须等待 API-connected Apple build，不能用
Fixture 结果代替。
