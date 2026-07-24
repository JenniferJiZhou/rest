# 00｜协议总览与优先级

## 目的

将产品功能文档转换为四人和 Coding Agent 可以直接执行的工程协议，避免以下问题：

- 前后端字段、枚举和错误处理不一致；
- Windows 后端等待 Apple UI，Apple UI 等待真实 API；
- 多人同时修改 Xcode 工程、共享模型或服务启动文件；
- Demo 因 Photon、Gmail、LLM、DeviceActivity 任一失败而中断；
- Coding Agent 自行修改契约或跨目录重构。

## 文档清单

| 文件 | 解决的问题 | Owner |
|---|---|---|
| `01_SCOPE_AND_FEATURE_FLOWS.md` | 做什么、不做什么、功能流程 | 全员确认，P4维护 |
| `02_SYSTEM_BOUNDARIES_AND_INTERFACES.md` | 客户端/后端/平台职责与功能接口映射 | P1+P2 |
| `03_RUNTIME_AND_FAILURE_PROTOCOL.md` | 超时、重试、幂等、降级、Demo Mode | P2 |
| `04_TEAM_OWNERSHIP_AND_WORKSPACES.md` | 四人分工、目录所有权、冲突规避 | 全员，P1维护 |
| `05_GIT_AND_INTEGRATION_PROTOCOL.md` | 分支、PR、合并、集成时点 | P3维护 |
| `06_ENVIRONMENT_SECRETS_AND_DEPLOYMENT.md` | 环境、密钥、部署、OAuth | P2+P3 |
| `07_PROJECT_STRUCTURE.md` | 基础目录与每层职责 | P1+P2 |
| `08_DEFINITION_OF_DONE_AND_TESTING.md` | 验收、测试和主线稳定性 | 全员 |
| `09_AGENT_TASK_PROTOCOL.md` | 如何给 Coding Agent 派活 | 各 Owner |
| `10_DECISION_LOG_TEMPLATE.md` | 重大改变如何记录 | P4 |
| `11_FIRST_3_HOURS_CHECKLIST.md` | 开工前 3 小时具体行动 | 全员 |
| `12_W1_BACKEND_FOUNDATION.md` | W1 后端基础设施、边界与运行方式 | P2 |
| `13_PROVIDER_INTEGRATION_KIT.md` | Gmail/Photon Provider 接入边界 | P2 |
| `14_APPLE_CLIENT_INTEGRATION_KIT.md` | Contract v1 的 Apple HTTP 联调 | P1+P2 |
| `15_APPLE_MOCK_INTEGRATION_RELEASE.md` | Windows Mock Server 的可信 LAN 发布与撤销 | P1+P2 |
| `contracts/openapi.yaml` | HTTP 接口唯一事实源 | P2，P1审 |
| `contracts/schemas/` | 双端共享数据结构 | P2，P1审 |
| `contracts/fixtures/` | Mock 与契约测试唯一样例 | P2，P1/P4审 |

## 冲突时的优先级

1. `contracts/openapi.yaml` 与 `contracts/schemas/`
2. 本协议包中的工程协议
3. 产品 v3.0 功能文档
4. 临时口头约定
5. Coding Agent 的自行判断

若产品文档与已冻结契约冲突，不可静默修改；提交 Contract Change PR。
