# 06｜环境、密钥、OAuth 与部署协议

## 1. 固定版本

- Node.js `>=20.19 <21`（仓库固定 `20.19.5`）
- pnpm `>=9 <10`（`packageManager` 固定 `9.15.9`）
- TypeScript 5.x
- Swift 5.10+
- Xcode 16
- iOS Deployment Target：由 M1 开工前冻结
- Contract Version：`1.0`

## 2. 后端环境变量

见根 `.env.example`。

规则：

- `.env`、OAuth token、refresh token 不提交。
- Photon API key 不进入 Apple 客户端。
- Claude API key 不进入 Apple 客户端。
- Gmail client secret 不进入 Apple 客户端。
- Demo Gmail 账号密码不进仓库和群聊明文。
- 生产/演示 token 使用托管平台 Secret。
- 服务器日志不得打印邮件正文、OAuth token、Guided Drift 内容。

Provider 调用的部署参数：

```text
LLM_TIMEOUT_MS=15000
MAIL_FETCH_TIMEOUT_MS=10000
DRAFT_CREATE_TIMEOUT_MS=10000
COMPLETION_SEND_TIMEOUT_MS=5000
```

四项均只接受 `100..120000` 毫秒内的整数；`0`、负数、`NaN` 和超大值会令
启动配置校验失败。`.env.example` 只保存安全示例，不保存真实 Secret。

`PUBLIC_BASE_URL` 当前仅被校验并预留给未来 OAuth/外部 callback URL；
现有 W1 listener、路由和响应不会读取它来改变行为。

## 3. Gmail

黑客松默认：

- 预先准备 Demo Gmail 账号。
- 现场前完成 OAuth 授权和 refresh token 保存。
- Scopes 以实际实现为准；代码路径只创建草稿，不调用发送。
- Seed script 必须可清理并重建演示邮件。
- 草稿标题加固定 Demo 前缀，便于去重和清理。
- 用户设备现场不依赖访问 Google OAuth 页面。

## 4. Photon

Day 1 冻结：

- 实际 line 类型。
- Webhook URL。
- 签名验证方式。
- 事件 ID 和重试行为。
- 中国区 iPhone 实测结论。
- 主动外发限制。
- 备用 ConsoleChannel / Telegram 结论。

供应商原始 payload 只能存在 adapter 与 fixture 中，业务层统一使用内部模型。

## 5. 部署

建议环境：

```text
demo
```

单独于本地开发。

部署要求：

- HTTPS。
- `/v1/health` 可外部访问。
- Photon webhook 可达。
- Sample Mode 需要 Secret。
- 每次部署保留上一可用版本。
- Demo 前冻结部署；Photon line 与 webhook 路由不再修改。
- 保存一份本地 ConsoleChannel 启动方式。
- 使用 `.github/workflows/server-ci.yml` 的 Node 20.19.5 / pnpm 9.15.9
  frozen-lockfile 检查作为合并门槛。

## 6. 日志

允许：

- request_id
- endpoint
- duration_ms
- status
- data_origin
- job stage
- provider error code

禁止：

- 邮件正文
- Gmail token
- Photon 私人消息全文（除临时调试且必须删除）
- Guided Drift 答案
- API key
- 用户健康推断

## 7. 本地端口

建议：

```text
Backend: 127.0.0.1:3000（安全默认）
Contract docs: 3001（可选）
Apple Client: 连接配置中的 base URL
```

只有在可信局域网进行跨机器 Apple 联调时，才显式设置
`HOST=0.0.0.0`；结束后恢复 `127.0.0.1` 并撤销临时防火墙规则。详细流程见
`15_APPLE_MOCK_INTEGRATION_RELEASE.md`。

实际端口在开工时冻结。
