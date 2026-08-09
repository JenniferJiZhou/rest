# Agent 任务测试按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 iPhone 与 Mac 的设置页加入“测试 Agent”入口，把发送前可见的最小真实使用上下文交给现有 Contract 1.1 `/v1/rest/recommend`，并只在设置页展示带 `real`/`mock` 来源标记的返回任务，不开始休息、不写入个人学习。

**Architecture:** 保持现有 `/v1/rest/recommend` 路由，在 1.1 请求中增加可选且严格校验的 `decision_context`；服务端将其透传给手动休息 Agent Prompt。Apple 共享层扩展请求/响应 DTO，并新增可注入 transport 的测试状态模型；iOS 从 App Group 中最近一次 Device Activity 检查点构造快照，Mac 从现有实时监测状态构造快照。两个设置页只组合预览、按钮与结果视图，现有 UI 结构、自动阈值和休息流程不变。

**Tech Stack:** Swift 6、SwiftUI、XCTest、DeviceActivity/App Group UserDefaults、TypeScript 5.9、Zod 4、Fastify、Vitest、OpenAPI 3、Xcode/xcodebuild、Node.js 20.19、pnpm 9。

**Global Constraints:** 只修改列出的 Agent 请求、数据快照、设置页和测试文件；不改颜色、波浪、导航、手势或其他 UI 资源。不发送 Bundle ID、系统 App 名、完整 URL、页面标题、消息、文件或输入内容。缺失值为 `null`，不得伪造为 `0`。设置测试必须同时使用平台专属 source 和 `learning_eligible: false`。请求不自动开始任务，不写历史/通知/学习记录。每个任务严格遵循 Red → Green → Commit。

---

## File and responsibility map

- Modify: `server/src/domain/contracts.ts` — 定义可选 `decision_context` 及设置测试 source/学习资格的组合校验。
- Modify: `server/src/domain/ports.ts` — 给 `DynamicManualRestContext` 增加已验证的决策上下文类型。
- Modify: `server/src/application/rest/rest-service.ts` — 从 Contract DTO 映射到 Agent port，不做持久化副作用。
- Modify: `server/src/agent/rest-mode-router.ts` — 把最小真实上下文放入手动休息 Prompt，并声明只可用于本次推理。
- Modify: `contracts/openapi.yaml` — 记录向后兼容的 Contract 1.1 字段。
- Modify: `server/tests/contracts/fixtures.test.ts`、`server/tests/contracts/openapi.test.ts`、`server/tests/unit/rest-service.test.ts`、`server/tests/unit/rest-mode-router.test.ts` — 服务端契约、映射和 Prompt 覆盖。
- Modify: `server/tests/fixtures/rest-recommendation-dynamic-request.json` — 保持旧客户端无 `decision_context` fixture，用于兼容验证。
- Modify: `apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift` — Apple 共享 DTO、请求编码、响应来源头校验。
- Create: `apps/HushApp/Shared/Features/RestQuest/HushAgentTaskTestModel.swift` — 可注入 transport 的请求状态模型与隐私安全预览行。
- Modify: `apps/HushApp/iOSApp/Platform/DeviceActivityMonitoringModel.swift` — 只读解析最近的合法 Device Activity 快照。
- Modify: `apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift` — 暴露当前 Mac 真实快照，不改变自动检查点逻辑。
- Modify: `apps/HushApp/iOSApp/App/HushApp.swift`、`apps/HushApp/MacMenuBar/App/HushMacApp.swift` — 在现有 Agent 卡片中接入预览、按钮和结果。
- Create: `apps/HushApp/HushTests/HushAgentTaskTestModelTests.swift` — Apple transport、状态机、重复点击与隐私预览测试。
- Create: `apps/HushApp/HushTests/HushAgentDecisionContextTests.swift` — iOS 缺失值/估算值和请求编码测试。
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj` — 将新增共享实现和测试加入正确 target。

## Task 1: Extend Contract 1.1 with a privacy-bounded decision context

**Files:**

- Modify: `server/src/domain/contracts.ts`
- Modify: `server/tests/contracts/fixtures.test.ts`
- Modify: `server/tests/fixtures/rest-recommendation-dynamic-request.json`

- [ ] **Step 1: Add failing contract tests for the new context and old-client compatibility**

In `server/tests/contracts/fixtures.test.ts`, keep the current fixture unchanged and assert it still parses. Add an inline settings-test request containing:

```ts
decision_context: {
  measured_at: "2026-08-09T10:15:00+08:00",
  platform: "ios",
  user_provided_context_label: "阅读",
  daily_app_usage_minutes: 35,
  continuous_app_usage_minutes: 15,
  continuous_usage_is_estimated: true,
  app_switches_last_10_minutes: null,
  minutes_since_last_rest: 90,
  local_hour: 10,
  raw_app_names_included: false,
  full_url_included: false,
  page_title_included: false,
  learning_eligible: false
}
```

Assert it parses only with `source: "settings_agent_test_ios"`. Add rejection cases for `learning_eligible: true`, a settings source without `decision_context`, a non-settings source with `decision_context`, extra/private keys such as `bundle_id`, and out-of-range minutes/hour. Assert nullable unavailable metrics are accepted.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd server
corepack pnpm vitest run tests/contracts/fixtures.test.ts
```

Expected: FAIL because `restRecommendationRequestV1_1Schema` is strict and rejects `decision_context`.

- [ ] **Step 3: Add the minimal strict Zod schema**

In `server/src/domain/contracts.ts`, add and export `manualRestDecisionContextSchema` with the exact snake-case fields above. Numerical usage fields and `minutes_since_last_rest` are required nullable fields so unavailable values serialize explicitly as `null`; `local_hour` remains required because the client always knows it. Use literals for the four privacy flags:

```ts
raw_app_names_included: z.literal(false),
full_url_included: z.literal(false),
page_title_included: z.literal(false),
learning_eligible: z.literal(false)
```

Add `decision_context: manualRestDecisionContextSchema.optional()` to `restRecommendationRequestV1_1Schema`, then add `superRefine` rules:

- `settings_agent_test_ios` requires `platform: "ios"` or `"ipados"` plus `decision_context`.
- `settings_agent_test_macos` requires `platform: "macos"` plus `decision_context`.
- Any other source must not include `decision_context` in this release.

Do not alter the unchanged legacy fixture; that is the backward-compatibility proof.

- [ ] **Step 4: Run focused contracts and verify GREEN**

Run the Step 2 command. Expected: all assertions PASS.

- [ ] **Step 5: Commit the contract boundary**

```bash
git add server/src/domain/contracts.ts server/tests/contracts/fixtures.test.ts server/tests/fixtures/rest-recommendation-dynamic-request.json
git commit -m "feat: validate agent test decision context"
```

## Task 2: Document the additive contract in OpenAPI

**Files:**

- Modify: `contracts/openapi.yaml`
- Modify: `server/tests/contracts/openapi.test.ts`

- [ ] **Step 1: Add failing OpenAPI structure assertions**

In `server/tests/contracts/openapi.test.ts`, assert the Contract 1.1 recommendation request references an optional `ManualRestDecisionContext`, that the component has `additionalProperties: false`, the four privacy fields are `enum: [false]`, nullable metrics are represented as integer-or-null, and source documents both platform test values.

- [ ] **Step 2: Run and verify RED**

```bash
cd server
corepack pnpm vitest run tests/contracts/openapi.test.ts
```

Expected: FAIL because the component/reference does not exist.

- [ ] **Step 3: Update OpenAPI without making the field required**

Add `ManualRestDecisionContext` under `components.schemas` and add `decision_context` to the Contract 1.1 request properties only. Document that it is accepted exclusively for settings test sources, is excluded from learning, and that unavailable numeric values serialize as `null`. Do not change response schemas or `X-Hush-Data-Origin`.

- [ ] **Step 4: Run OpenAPI and all contract tests**

```bash
cd server
corepack pnpm test:contracts
```

Expected: PASS.

- [ ] **Step 5: Commit the API documentation**

```bash
git add contracts/openapi.yaml server/tests/contracts/openapi.test.ts
git commit -m "docs: describe agent test decision context"
```

## Task 3: Pass validated context to the manual-rest Agent

**Files:**

- Modify: `server/src/domain/ports.ts`
- Modify: `server/src/application/rest/rest-service.ts`
- Modify: `server/src/agent/rest-mode-router.ts`
- Modify: `server/tests/unit/rest-service.test.ts`
- Modify: `server/tests/unit/rest-mode-router.test.ts`

- [ ] **Step 1: Add failing service mapping tests**

In `server/tests/unit/rest-service.test.ts`, call Contract 1.1 `recommend` with the valid iOS sample from Task 1. Capture the argument passed to `DynamicManualRestProvider.generate` and assert every field maps to camelCase, including explicit `null` values and `learningEligible: false`. Keep/add a case proving an old request maps `decisionContext: null` and still generates a task.

- [ ] **Step 2: Add failing router tests**

In `server/tests/unit/rest-mode-router.test.ts`, route `manual_rest_quest` with the validated context. Parse `route.input` and assert it contains the context, the system prompt says it is for the current decision only, and the serialized input contains no `bundleId`, `fullUrl`, `pageTitle`, message/file/input content, or learning permission.

- [ ] **Step 3: Run and verify RED**

```bash
cd server
corepack pnpm vitest run tests/unit/rest-service.test.ts tests/unit/rest-mode-router.test.ts
```

Expected: FAIL because `DynamicManualRestContext` has no `decisionContext`.

- [ ] **Step 4: Implement the typed mapping and Prompt input**

Add `ManualRestDecisionContext` in `server/src/domain/ports.ts` with camel-case equivalents, and add `decisionContext: ManualRestDecisionContext | null` to `DynamicManualRestContext`. Map only schema-approved fields in `RestService.dynamicManualRestContext`; never spread the raw request. In `rest-mode-router.ts`, include `decisionContext` in the JSON input and add these constraints to the system prompt:

```text
Use decisionContext only to tailor this response.
learningEligible is false: do not infer or claim that this request trains,
updates, remembers, or personalizes future behavior.
Nullable values are unknown; never interpret null as zero.
```

- [ ] **Step 5: Run focused tests and server typecheck**

```bash
cd server
corepack pnpm vitest run tests/unit/rest-service.test.ts tests/unit/rest-mode-router.test.ts
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the Agent handoff**

```bash
git add server/src/domain/ports.ts server/src/application/rest/rest-service.ts server/src/agent/rest-mode-router.ts server/tests/unit/rest-service.test.ts server/tests/unit/rest-mode-router.test.ts
git commit -m "feat: give manual rest agent current context"
```

## Task 4: Extend the Apple transport and verify the origin header

**Files:**

- Modify: `apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift`
- Create: `apps/HushApp/HushTests/HushAgentDecisionContextTests.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`

- [ ] **Step 1: Add transport tests with an injected URLSession**

Add an internal `init(baseURLString:session:)` overload to the planned API and use a test `URLProtocol` in `HushAgentDecisionContextTests.swift`. First write tests that assert:

- the encoded request uses `source = settings_agent_test_ios` and contains the exact real context;
- optional missing measurements encode as JSON `null`, not zero;
- all four privacy/learning flags encode as `false`;
- a 2xx response with `X-Hush-Data-Origin: real` returns `.real`;
- `mock` returns `.mock`;
- missing, `cached`, or unknown origin throws `invalidResponse`;
- existing contract-version and request-ID checks still apply.

- [ ] **Step 2: Register the test file and verify RED**

Add only the test file to the `HushTests` group/source phase in `project.pbxproj`, then run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' -only-testing:HushTests/HushAgentDecisionContextTests test
```

Expected: compile/test FAIL because the DTO and origin result are missing.

- [ ] **Step 3: Implement the shared DTOs and response result**

In `HushRestContent.swift`, add:

```swift
enum HushAgentDataOrigin: String, Equatable, Sendable {
    case real
    case mock
}

struct HushAgentDecisionContext: Codable, Equatable, Sendable {
    let measuredAt: String
    let platform: String
    let userProvidedContextLabel: String?
    let dailyAppUsageMinutes: Int?
    let continuousAppUsageMinutes: Int?
    let continuousUsageIsEstimated: Bool?
    let appSwitchesLast10Minutes: Int?
    let minutesSinceLastRest: Int?
    let localHour: Int
    let rawAppNamesIncluded: Bool
    let fullURLIncluded: Bool
    let pageTitleIncluded: Bool
    let learningEligible: Bool
}
```

Give it explicit snake-case `CodingKeys`. Extend `HushManualRestContext` with optional `decisionContext`, extend the request body with `decision_context`, and add `dataOrigin` to `HushDynamicRestSuggestion`. Validate the header before decoding the response. Preserve existing callers with a default `decisionContext: nil` initializer argument and do not weaken HTTPS validation.

- [ ] **Step 4: Run the focused transport tests and full HushTests**

Run the Step 2 command, then:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' test
```

Expected: PASS.

- [ ] **Step 5: Commit the Apple contract client**

```bash
git add apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift apps/HushApp/HushTests/HushAgentDecisionContextTests.swift apps/HushApp/Hush.xcodeproj/project.pbxproj
git commit -m "feat: send agent test context from Apple clients"
```

## Task 5: Build the reusable Agent test state model

**Files:**

- Create: `apps/HushApp/Shared/Features/RestQuest/HushAgentTaskTestModel.swift`
- Create: `apps/HushApp/HushTests/HushAgentTaskTestModelTests.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`

- [ ] **Step 1: Write failing state-machine and privacy-preview tests**

Use an injected async closure instead of live networking. Cover:

- invalid/non-HTTPS URL never invokes the closure and yields a readable failure;
- one call transitions `idle → loading → success` and exposes message/title/duration/ordered steps/origin;
- while loading, a second `test` call does not invoke transport again;
- network failure transitions to `.failure("无法连接 Agent，请检查地址或稍后重试")`;
- malformed-response error transitions to `.failure("Agent 返回了无法识别的任务")`;
- a retry replaces the previous result;
- preview rows show unavailable values as `未知`, estimated values as `估算`, and never expose prohibited field names or values.

- [ ] **Step 2: Register files and verify RED**

Register the shared file in both `Hush` and `HushMac` source phases and the test file in `HushTests`. Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' -only-testing:HushTests/HushAgentTaskTestModelTests test
```

Expected: FAIL because the model does not exist.

- [ ] **Step 3: Implement the smallest main-thread model**

Define an `@MainActor ObservableObject` with one published enum state, a computed `isRequesting`, a typed preview-row array, and a single `test(baseURL:context:source:) async` method. The injected closure signature is:

```swift
typealias Request = @Sendable (
    String,
    HushManualRestContext
) async throws -> HushDynamicRestSuggestion
```

The production closure constructs `HTTPManualRestTaskProvider` and calls `generateTask`. Guard `!isRequesting`, generate a new session UUID for every accepted click, set fatigue to `unknown`, preference to `surprise`, available minutes to `3`, location tags to `[]`, and never call any session/history/notification API.

- [ ] **Step 4: Run focused and full Apple unit tests**

Run the Step 2 command and the full HushTests command from Task 4. Expected: PASS.

- [ ] **Step 5: Commit the shared state model**

```bash
git add apps/HushApp/Shared/Features/RestQuest/HushAgentTaskTestModel.swift apps/HushApp/HushTests/HushAgentTaskTestModelTests.swift apps/HushApp/Hush.xcodeproj/project.pbxproj
git commit -m "feat: add reusable agent task test state"
```

## Task 6: Produce truthful iOS and Mac snapshots

**Files:**

- Modify: `apps/HushApp/iOSApp/Platform/DeviceActivityMonitoringModel.swift`
- Modify: `apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift`
- Modify: `apps/HushApp/HushTests/HushAgentDecisionContextTests.swift`

- [ ] **Step 1: Add failing iOS snapshot tests**

Make `DeviceActivityMonitoringModel` accept an internal test `UserDefaults`. Seed a plist-encoded `deviceActivity.appUsageStates` dictionary using the same keys as the extension. Assert `agentTestDecisionContext(applicationContexts:now:)` chooses the most recent configured context and returns:

- the user-provided label, checkpoint daily minutes and estimated continuous minutes;
- `continuousUsageIsEstimated == true`;
- real minutes since `restSession.lastCompletedDate` when present;
- `nil` for switch count and unavailable rest time;
- current local hour and all privacy/learning flags false.

Add cases for no checkpoint and a state whose UUID is no longer configured. Both must return null measurement fields rather than zeros or another App's label.

- [ ] **Step 2: Verify RED**

Run the focused `HushAgentDecisionContextTests` command from Task 4. Expected: FAIL because the snapshot method is missing.

- [ ] **Step 3: Implement the iOS read-only snapshot**

Mirror only the extension's three stored plist keys in a private decoding struct. Do not expose ApplicationToken or decode the event-token dictionary. Select by configured context UUID and latest `lastThresholdDate`; use an ISO-8601 timestamp. If there is no valid state, build a context with the current measurement time, no label, and nullable measurements. Never mutate App Group defaults in this method.

- [ ] **Step 4: Expose the Mac snapshot from existing counters**

Add `agentTestDecisionContext(now:)` to `MacUsageMonitoringModel`. Before building it, prune the ten-minute switch history. Read `currentMonitoredApplication?.trimmedUserProvidedName`, `currentDailyMinutes`, `currentContinuousMinutes`, `switchDates.count`, and the real last-rest date. Use `nil` instead of `0` when no monitored application exists; mark continuous time as exact (`false`) only when a monitored application exists. This method must not call `sendAgentCheckpoint`, update `lastRequestJSON`, or mutate learning/history state.

- [ ] **Step 5: Run Apple tests and both compile gates**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -configuration Debug -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS.

- [ ] **Step 6: Commit snapshot adapters**

```bash
git add apps/HushApp/iOSApp/Platform/DeviceActivityMonitoringModel.swift apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift apps/HushApp/HushTests/HushAgentDecisionContextTests.swift
git commit -m "feat: expose private agent test snapshots"
```

## Task 7: Add the button and inline result without changing visual language

**Files:**

- Modify: `apps/HushApp/iOSApp/App/HushApp.swift`
- Modify: `apps/HushApp/MacMenuBar/App/HushMacApp.swift`

- [ ] **Step 1: Add state ownership and iOS composition**

Add `@StateObject private var agentTaskTest = HushAgentTaskTestModel()` to `HushSettingsView`. Inside the existing `Section("设备活动监测")`, after the URL/status and before monitoring controls, render:

- a compact `DisclosureGroup("本次将发送的数据")` from the model's preview rows;
- a button labeled `测试 Agent 并返回任务`;
- `ProgressView` plus `正在请求…` while loading;
- the result's origin label (`真实 Agent` or `测试数据`), message, title, formatted duration and numbered steps;
- the mapped inline error.

The button action takes a fresh snapshot from `monitoring`, uses source `settings_agent_test_ios`, and awaits the state model. Disable only for invalid URL or loading. Do not call `dismiss`, `HushDemoStore`, rest-session methods, notifications, or learning stores.

- [ ] **Step 2: Add the equivalent Mac composition**

Own the same model in the Mac settings/root view containing `agentCard`. Add the same disclosure/button/result inside `agentCard`, using existing `HushMacPrimaryButtonStyle`/caption typography and source `settings_agent_test_macos`. Take `model.agentTestDecisionContext(now: Date())` at click time. Keep “发送测试通知” and “发送当前数据” unchanged because they test different existing paths.

- [ ] **Step 3: Compile both platforms**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -configuration Debug -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS with no new warnings caused by these files.

- [ ] **Step 4: Inspect the surgical diff**

```bash
git diff --stat
git diff -- apps/HushApp/iOSApp/App/HushApp.swift apps/HushApp/MacMenuBar/App/HushMacApp.swift
```

Expected: only the existing Agent areas changed; no design-system, wave, asset, navigation, gesture, sleep or inbox files appear.

- [ ] **Step 5: Commit both settings integrations**

```bash
git add apps/HushApp/iOSApp/App/HushApp.swift apps/HushApp/MacMenuBar/App/HushMacApp.swift
git commit -m "feat: add agent task test to settings"
```

## Task 8: End-to-end verification and live-origin check

**Files:**

- Modify only if a failing test identifies an in-scope defect in files already listed above.

- [ ] **Step 1: Run the full server gate**

```bash
cd server
corepack pnpm check
```

Expected: typecheck, all Vitest suites, and build PASS.

- [ ] **Step 2: Run the full Apple gates**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -configuration Debug -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
```

Expected: all PASS.

- [ ] **Step 3: Perform a privacy and scope scan**

```bash
rg -n "learning_eligible|bundle_id|full_url|page_title|raw_app_names|settings_agent_test" server/src apps/HushApp contracts/openapi.yaml
git diff origin/main --name-only
```

Verify every settings-test request has `learning_eligible: false`; prohibited fields are only fixed false declarations or explicit rejection assertions; no logging statement prints `decision_context`; no UI/design files outside the two settings files changed.

- [ ] **Step 4: Run a local real/mock header integration check**

Start the server with its existing test environment, set the app's Agent HTTPS URL to the intended deployed endpoint, and click once on each platform. Verify:

- the preview exactly matches the outgoing context;
- one returned task renders message/title/duration/steps;
- the displayed origin exactly follows `X-Hush-Data-Origin`;
- no navigation, task start, notification, rest-history write, or learning write occurs;
- a second click uses a new request ID and replaces the prior result.

If the deployed server has not yet received this additive contract, expect a clear inline contract/network error; deploy the verified server before judging the client button broken.

- [ ] **Step 5: Self-review against the approved spec**

Read `docs/superpowers/specs/2026-08-09-agent-task-test-button-design.md` line by line and map every in-scope bullet to code or a test. Confirm every out-of-scope bullet remains untouched.

- [ ] **Step 6: Scan for unfinished implementation markers**

```bash
rg -n "TODO|FIXME|placeholder|fatalError\(|preconditionFailure\(" server/src apps/HushApp/Shared/Features/RestQuest apps/HushApp/iOSApp/Platform/DeviceActivityMonitoringModel.swift apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift apps/HushApp/iOSApp/App/HushApp.swift apps/HushApp/MacMenuBar/App/HushMacApp.swift
```

Expected: no new unfinished marker attributable to this work.

- [ ] **Step 7: Verify repository state and make the final verification commit only if needed**

```bash
git status --short
git log --oneline -10
```

Expected: clean worktree and the task commits in order. If verification required an in-scope fix, commit only that fix with `git commit -m "fix: complete agent task test verification"`; otherwise do not create an empty commit.
