# 02｜系统边界、职责与接口映射

## 1. 总体边界

```text
Apple Clients
  ├─ iOS/iPadOS App
  ├─ macOS MenuBar App
  ├─ DeviceActivity Extension
  └─ Live Activity Extension
          │ HTTPS / JSON
          ▼
Hush Backend
  ├─ REST API
  ├─ Rest Orchestrator
  ├─ Handoff Job
  ├─ Agent LLM Adapter
  ├─ Gmail Adapter
  ├─ Photon Adapter
  └─ Fixed Content Loader
```

## 2. Apple 客户端拥有最终控制权

客户端负责：

- 权限申请与本地隐私说明。
- Hush Door 与所有入口路由。
- 本地 Rest Quest / Guided Drift / Blue Box 内容。
- Rest Session 状态机与计时。
- Live Activity、通知、菜单栏。
- Sample Mode 明确标识。
- 冷却期、每日提醒上限、用户拒绝。
- 是否执行后端建议。
- 本地反馈和偏好。
- 网络失败降级。

后端不得直接：

- 开始或结束用户休息。
- 屏蔽应用。
- 打断用户。
- 修改 DeviceActivity。
- 自动发送 Gmail。
- 诊断用户。
- 保存 Guided Drift 答案。

## 3. 后端职责

后端负责：

- 将自然语言疲惫描述映射为可解释分类。
- 最多生成一个能改变推荐结果的 follow-up。
- 为 Contract 1.0 和 manual rest 从固定 Rest Quest 库中选择 `quest_id`。
- 为 Contract 1.1 Mode A 校验 StepFun 的结构化 `generated_task`，不查询
  Quest Repository。
- Gmail OAuth、读取未读、创建草稿。
- 创建与运行 Handoff Job。
- 整理用户主动交接的 open loops。
- 生成覆盖范围明确的 Handoff Summary / Pause Receipt。
- Photon 入站路由与主动消息。
- LLM 输出的 Schema 校验。
- Real/Mock/Cached 来源标记。

Contract 1.1 的模型只决定是否建议休息、陪伴/引导文案和一次性任务内容。
服务端仍拥有 request ID、Contract 版本、actions、HTTP 状态与幂等；Apple
仍拥有通知、Shield、Lockdown、页面跳转和 checkpoint。

## 4. 核心 Swift 协议

```swift
protocol RestEntryRouting {
    func open(_ context: RestEntryContext)
}

protocol UsageMonitoring {
    func requestAuthorization() async throws
    func startMonitoring(config: MonitorConfig) async throws
    var events: AsyncStream<UsageEvent> { get }
    func currentSummary() async -> UsageSummary
}

protocol RestAgentService {
    func evaluate(_ summary: UsageSummary) async throws -> RestSuggestion
    func checkIn(_ input: FatigueCheckIn) async throws -> FatigueReflection
    func recommend(_ input: RestRecommendationRequest) async throws -> RestQuestRecommendation
    func sendFeedback(_ feedback: RestFeedback) async throws
    func startHandoff(_ input: HandoffStartRequest) async throws -> HandoffJob
    func handoffStatus(_ id: String) async throws -> HandoffJobState
    func cancelHandoff(_ id: String) async throws
}

protocol RestContentProvider {
    var contentVersion: String { get }
    func quest(id: String) -> RestQuest?
    func quests(matching filter: RestQuestFilter) -> [RestQuest]
    func randomSafeQuest(_ filter: RestQuestFilter) -> RestQuest
    func driftPrompt(category: DriftCategory?) -> DriftPrompt
    func blueBoxCard(for context: SleepContext) -> BlueBoxCard
}

protocol RestSessionControlling {
    var state: AsyncStream<RestSessionState> { get }
    func start(quest: RestQuest) async throws
    func pause() async
    func resume() async
    func end(reason: RestEndReason) async
}

protocol RestPreferenceStoring {
    func load() async throws -> RestPreferences
    func save(_ preferences: RestPreferences) async throws
    func record(_ feedback: RestFeedback) async throws
}
```

建议实现：

```text
UsageMonitoring
├─ DeviceActivityUsageMonitor
├─ MacWorkspaceUsageMonitor
└─ MockUsageMonitor

RestAgentService
├─ HTTPRestAgentService
└─ MockRestAgentService

RestContentProvider
└─ BundledRestContentProvider

RestSessionControlling
└─ DefaultRestSessionController
```

## 5. 核心 TypeScript 接口

```typescript
interface MailProvider {
  fetchUnread(ctx: MailFetchContext): Promise<MailItem[]>;
  createDraft(input: DraftRequest): Promise<{ draftId: string }>;
}

interface MessagingChannel {
  send(input: OutboundMessage): Promise<void>;
  register(handler: InboundMessageHandler): void;
}

interface AgentLLM {
  reflectFatigue(input: FatigueCheckIn): Promise<FatigueReflection>;
  chooseQuest(
    input: RestRecommendationRequest,
    allowedQuests: RestQuest[]
  ): Promise<RestQuestRecommendation>;
  summarizeHandoff(input: HandoffAgentInput): Promise<HandoffSummaryDraft>;
}

interface RestContentRepository {
  contentVersion(): string;
  quests(): RestQuest[];
  questById(id: string): RestQuest | undefined;
  blueBoxCards(): BlueBoxCard[];
  safetyRules(): SafetyRule[];
}

interface HandoffJobRepository {
  create(input: HandoffStartRequest): Promise<HandoffJob>;
  get(id: string): Promise<HandoffJobState | null>;
  update(id: string, patch: HandoffJobPatch): Promise<void>;
}

interface IdempotencyStore {
  get(key: string): Promise<StoredResponse | null>;
  put(key: string, response: StoredResponse, ttlSeconds: number): Promise<void>;
}
```

实现：

```text
MailProvider
├─ GmailMailProvider
└─ MockMailProvider

MessagingChannel
├─ PhotonChannel
└─ ConsoleChannel

AgentLLM
├─ ClaudeLLM
└─ CannedLLM

HandoffJobRepository
├─ InMemoryHandoffJobRepository（黑客松默认）
└─ 可选持久化实现
```

## 6. 功能级接口说明

### Hush Door

- 不调用网络即可打开。
- 构造 `RestEntryContext`。
- “直接来一个”必须从本地安全 Quest 库选择。
- “说说我怎么累”调用 `/v1/rest/check-in`。

### Name the Tiredness

- 第一次请求可返回 `needs_follow_up=true`。
- 最多一个 follow-up。
- 第二次必须进入 Quest 推荐或 `unknown` 降级。
- 不输出医学术语和诊断结论。

### Rest Quest

- Canonical steps 位于 `content/rest-quests.json`。
- 后端只选择 `quest_id`，不替换步骤。
- 内容版本不匹配时，客户端使用本地 fallback Quest。

### Day Reset

- Rest Session 在客户端运行。
- 后端无权强制开始、暂停或结束。
- Feedback 可以本地先写，再异步提交。

### Guided Drift

- 全程本地。
- 不记录答案。
- 不调用 LLM。
- 只记录“选择了 Drift”及结束反馈，且默认匿名。

### Sleep Handoff

- `/handoff/start` 必须幂等。
- Gmail 草稿创建必须防重复。
- `uncertain` 必须保留。
- Pause Receipt 必须展示 `included_sources` 和 `excluded_sources`。
- Gmail 不可用时仍处理用户主动交接事项。

### Photon

- Webhook 必须校验签名；未验证前不得部署为公开生产路径。
- Photon payload 由 Adapter 转为内部 `InboundMessage`，业务层不依赖供应商结构。
- 消息对话最多两轮。
- 未知意图使用安全简短 fallback。
