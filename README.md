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
- **W1 / P2（Windows）**：后端 API、Agent、Handoff Job、契约实现、服务组合根。
- **Gmail Owner（Windows）**：仅 Gmail Provider、OAuth Adapter 与 Gmail 联调。
- **W2 / P3（Windows）**：仅 Photon/iMessage Provider、Webhook Adapter 与 Photon 联调。

## 核心工程原则

- 每个外部依赖必须有 `Protocol/Interface + Real + Mock`。
- 客户端第一小时即可使用 fixtures 跑通，不等待后端。
- `main` 永远能够在 Sample Mode 下完成主流程。
- 公共契约、Xcode 工程文件、根依赖文件均有唯一 Owner。
- 业务代码只依赖协议，不直接依赖 Gmail、Photon、Claude 或 DeviceActivity。
- Rest Quest 与 Blue Box 内容来自固定 JSON；LLM 只能选择和组织，不能自由生成危险动作。

## 当前包的性质

这是**协议、可执行后端和分阶段客户端工程并存的开发仓库**，不是已完成的生产系统。真实 Gmail/Photon Adapter、Apple 真机最后一跳和 HTTPS staging 仍需各 Owner 完成；空目录继续使用 `.gitkeep` 保留。

HTTPS staging、ClawCloud Run、GHCR 镜像与 Apple 真机交接步骤见
`docs/18_CLAWCLOUD_RUN_STAGING_DEPLOYMENT.md` 和
`docs/17_APPLE_REST_DECISION_HANDOFF.md`。仓库只提供可重复配置，不包含已创建的
云资源、证书或 Secret。

Real Rest Decision Provider 已实现，并通过独立的 Normal/Demo 组合图隔离；
Prompt、严格结构化输出、失败行为和凭据化 HTTPS staging 交接见
`docs/19_REAL_REST_DECISION_AGENT.md`。模型不能控制 Shield、通知、actions
或下一 checkpoint。
