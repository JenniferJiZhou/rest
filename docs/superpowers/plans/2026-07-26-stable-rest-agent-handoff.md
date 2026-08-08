# Stable Rest Agent Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect staging, HushMac, and a real iPhone so Mac usage evaluation is followed by a real LLM selection from the fixed Rest Quest library, then displayed on iPhone with safe local fallback.

**Architecture:** HushMac owns a two-stage pipeline: `POST /v1/rest/evaluate` decides whether to interrupt, then `POST /v1/rest/recommend` selects one fixed-library `quest_id` and a short intro. The server reports the actual provider origin per recommendation; Mac sends only the chosen ID and intro through Companion Sync; iPhone resolves all task content locally.

**Tech Stack:** Swift 6, SwiftUI, Foundation `URLSession`, MultipeerConnectivity, XCTest, TypeScript 5.9, Fastify 5, Zod 4, Vitest 3, Anthropic SDK.

## Global Constraints

- Public HTTP contract stays at `schema_version: "1.0"` and `X-Contract-Version: 1.0`.
- Do not modify `contracts/**`; any discovered contract gap requires a separate Contract Change.
- The LLM may return only a fixed-library `quest_id`, `reason_code`, and optional intro; it must never generate task steps, medical advice, or safety advice.
- iPhone task title, duration, steps, and safety note always come from the bundled content library.
- Do not add third-party dependencies or modify package lockfiles.
- Do not modify entitlements, signing, Bundle IDs, App Groups, or capabilities.
- `CLAUDE_API_KEY` and deployment secrets stay in staging environment variables and never appear in code, logs, fixtures, or test output.
- Do not upload window text, page content, full URLs, keyboard input, screenshots, clipboard contents, or file contents.
- Automatic `evaluate` and `recommend` POST requests are not retried.
- User-facing rest UI must not show HTTP, LLM, contract, or sync errors.
- Rest task UI must not display numbered steps.
- Existing uncommitted user changes must be checkpointed by the owner before implementation because this work overlaps the same Swift, server, and Xcode project files. Do not silently include unrelated dirty changes in task commits.

## Owner Task Card

**Owner:** M1 / P1 for Apple and Xcode work; W1 / P2 for server work.

**Allowed modifications:**

- `apps/HushApp/Hush.xcodeproj/project.pbxproj`
- `apps/HushApp/Hush.xcodeproj/xcshareddata/xcschemes/Hush.xcscheme`
- `apps/HushApp/Hush.xcodeproj/xcshareddata/xcschemes/HushMac.xcscheme`
- `apps/HushApp/Shared/Core/Networking/**`
- `apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift`
- `apps/HushApp/MacMenuBar/App/HushMacApp.swift`
- `apps/HushApp/MacMenuBar/Platform/**`
- `apps/HushApp/iOSApp/App/HushApp.swift`
- `apps/HushApp/iOSApp/Platform/HushCompanionRestAgentService.swift`
- `apps/HushApp/MacMenuBarTests/**`
- `apps/HushApp/iOSAppTests/**`
- `server/src/agent/**`
- `server/src/api/create-server.ts`
- `server/src/application/rest/**`
- `server/src/domain/ports.ts`
- `server/src/composition.ts`
- `server/tests/unit/**`
- `server/tests/integration/**`
- `docs/runbooks/**`

**Forbidden modifications:**

- `contracts/**`
- `content/**`
- `apps/HushApp/**/*.entitlements`
- signing, Bundle ID, App Group, capability, package, or lockfile settings
- Gmail and Photon provider directories

**Dependent contracts:**

- `contracts/schemas/usage-summary.schema.json`
- `contracts/schemas/rest-recommendation.schema.json`
- `contracts/openapi.yaml`
- bundled `content-manifest.json` and `rest-quests.json`

**Acceptance:** All server tests pass; Hush and HushMac schemes build and their new tests pass; staging returns `real` for successful Claude recommendations and `mock` for fallback; real iPhone shows the locally resolved quest once and respects cooldown.

---

## File Structure

### Create

- `apps/HushApp/Shared/Core/Networking/HushRestRecommendationClient.swift`: contract-1.0 recommendation DTOs, header validation, and HTTPS client shared by Apple targets.
- `apps/HushApp/MacMenuBar/Platform/MacRestAgentPipeline.swift`: pure two-stage merge and fallback policy, isolated from AppKit timers.
- `apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift`: deterministic pipeline and response validation tests.
- `apps/HushApp/iOSAppTests/HushCompanionRestResolutionTests.swift`: fixed-ID resolution, fallback, origin, and copy presentation tests.
- `server/tests/unit/rest-recommendation-origin.test.ts`: provider-origin and concurrency tests.
- `server/tests/unit/claude-quest-prompt.test.ts`: fixed-library and human-copy prompt constraints.
- `docs/runbooks/stable-rest-agent-staging.md`: deployment and real-device evidence checklist without secrets.

### Modify

- `server/src/domain/ports.ts`: add `AgentExecution<T>` and make `chooseQuest` return its per-call origin.
- `server/src/agent/canned-llm.ts`: wrap recommendation with origin `mock`.
- `server/src/agent/claude-llm.ts`: wrap recommendation with origin `real` and tighten Chinese intro prompt.
- `server/src/agent/rest-decision-providers.ts`: produce a concise factual evaluate message from normalized usage without assistant-like wellness language.
- `server/src/agent/resilient-llm.ts`: preserve the origin of whichever provider actually returned.
- `server/src/application/rest/rest-service.ts`: return an internal recommendation execution envelope while validating the fixed ID.
- `server/src/api/create-server.ts`: override `/rest/recommend` response origin using the execution envelope.
- `server/tests/unit/rest-service.test.ts`: assert response value and origin.
- `server/tests/unit/canned-llm.test.ts`: assert mock origin and fixed-library selection.
- `server/tests/unit/composition.test.ts`: retain graph isolation while no longer treating graph origin as per-call recommendation origin.
- `server/tests/integration/http-contract.test.ts`: verify real/mock response headers without changing the JSON body contract.
- `apps/HushApp/Shared/Core/Networking/HushCompanionPeerSync.swift`: remove generated task payload, add `dataOrigin`, and increment the private peer protocol version.
- `apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift`: remove `GeneratedRestTask` and expose a bundled content version/ID lookup used by both Apple targets.
- `apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift`: use contract 1.0, run evaluate then recommend, publish final fixed-ID decision.
- `apps/HushApp/MacMenuBar/Platform/MacWebsiteMonitoringModel.swift`: use the same pipeline and publish its decision to the companion decision bus.
- `apps/HushApp/MacMenuBar/App/HushMacApp.swift`: persist and notify using `questID` only; remove generated task serialization.
- `apps/HushApp/iOSApp/Platform/HushCompanionRestAgentService.swift`: reuse the contract-1.0 recommendation client for manual rest.
- `apps/HushApp/iOSApp/App/HushApp.swift`: resolve local quest IDs, show low-weight Sample Mode for mock, remove numbered steps and AI-like fallback copy.
- `apps/HushApp/Hush.xcodeproj/project.pbxproj`: add the two new test targets and new production files only.
- shared Hush/HushMac schemes: attach the correct test target to each TestAction.

---

### Task 1: Track Recommendation Origin Per Server Call

**Files:**

- Modify: `server/src/domain/ports.ts:98-115`
- Modify: `server/src/agent/canned-llm.ts:124-155`
- Modify: `server/src/agent/claude-llm.ts:79-105`
- Modify: `server/src/agent/resilient-llm.ts:46-56`
- Create: `server/tests/unit/rest-recommendation-origin.test.ts`

**Interfaces:**

- Produces: `AgentExecution<T> = { value: T; dataOrigin: DataOrigin }`.
- Changes: `AgentLLM.chooseQuest(...) -> Promise<AgentExecution<RestQuestRecommendation>>`.
- Preserves: `reflectFatigue` and `summarizeHandoff` signatures.

- [ ] **Step 1: Write failing origin tests**

```typescript
it("marks a successful primary recommendation as real", async () => {
  const agent = new ResilientAgentLLM(
    new QuestAgent("real", "look_far_01"),
    new QuestAgent("mock", "wash_face_01")
  );
  const result = await agent.chooseQuest(request, quests);
  expect(result.dataOrigin).toBe("real");
  expect(result.value.quest_id).toBe("look_far_01");
});

it("marks a fallback recommendation as mock", async () => {
  const agent = new ResilientAgentLLM(
    new ThrowingQuestAgent("real"),
    new QuestAgent("mock", "wash_face_01")
  );
  const result = await agent.chooseQuest(request, quests);
  expect(result.dataOrigin).toBe("mock");
  expect(result.value.quest_id).toBe("wash_face_01");
});
```

Define the test agents in the same test file so the test is self-contained:

```typescript
class QuestAgent extends CannedAgentLLM {
  constructor(
    readonly dataOrigin: DataOrigin,
    private readonly questId: string
  ) {
    super();
  }

  override async chooseQuest(
    input: RestRecommendationRequest,
    allowed: RestQuest[]
  ): Promise<AgentExecution<RestQuestRecommendation>> {
    const execution = await super.chooseQuest(input, allowed);
    return {
      value: { ...execution.value, quest_id: this.questId },
      dataOrigin: this.dataOrigin
    };
  }
}

class ThrowingQuestAgent extends QuestAgent {
  constructor(origin: DataOrigin) {
    super(origin, "unused");
  }

  override async chooseQuest(
    _input: RestRecommendationRequest,
    _allowed: RestQuest[],
    _options?: ProviderCallOptions
  ): Promise<AgentExecution<RestQuestRecommendation>> {
    throw new Error("primary unavailable");
  }
}
```

- [ ] **Step 2: Run the focused test and confirm the type failure**

Run: `pnpm --dir server test -- tests/unit/rest-recommendation-origin.test.ts`

Expected: FAIL because `chooseQuest` returns `RestQuestRecommendation` without `value` or `dataOrigin`.

- [ ] **Step 3: Add the execution envelope and wrap provider results**

```typescript
export interface AgentExecution<T> {
  value: T;
  dataOrigin: DataOrigin;
}

chooseQuest(
  input: RestRecommendationRequest,
  allowedQuests: RestQuest[],
  options?: ProviderCallOptions
): Promise<AgentExecution<RestQuestRecommendation>>;
```

In each concrete provider, return the provider's actual origin:

```typescript
return {
  value: restQuestRecommendationSchema.parse(candidate),
  dataOrigin: this.dataOrigin ?? "mock"
};
```

`ResilientAgentLLM.chooseQuest` must call primary first and return its envelope unchanged; on non-abort failure it must return the fallback envelope unchanged. Do not infer origin from both provider types and do not store mutable `lastOrigin`.

- [ ] **Step 4: Run origin and Agent unit tests**

Run: `pnpm --dir server test -- tests/unit/rest-recommendation-origin.test.ts tests/unit/canned-llm.test.ts tests/unit/agent-error-classification.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the server provider boundary**

```bash
git add server/src/domain/ports.ts server/src/agent/canned-llm.ts server/src/agent/claude-llm.ts server/src/agent/resilient-llm.ts server/tests/unit/rest-recommendation-origin.test.ts server/tests/unit/canned-llm.test.ts
git commit -m "feat(agent): track quest recommendation origin"
```

### Task 2: Return Actual Origin From `/rest/recommend`

**Files:**

- Modify: `server/src/application/rest/rest-service.ts:114-164`
- Modify: `server/src/api/create-server.ts:206-217`
- Modify: `server/src/agent/rest-decision-providers.ts`
- Modify: `server/tests/unit/rest-service.test.ts`
- Modify: `server/tests/integration/http-contract.test.ts`
- Modify: `server/tests/unit/composition.test.ts`
- Modify: `server/tests/provider-contracts/rest-decision-provider.test.ts`
- Create: `server/tests/unit/claude-quest-prompt.test.ts`

**Interfaces:**

- Consumes: `AgentExecution<RestQuestRecommendation>` from Task 1.
- Produces: `RestRecommendationExecution = { response, dataOrigin }` from `RestService.recommend`.
- Public HTTP JSON remains exactly `RestQuestRecommendation`; only `X-Hush-Data-Origin` becomes per-call.

- [ ] **Step 1: Add failing service and HTTP tests**

```typescript
it("returns the validated recommendation with its provider origin", async () => {
  const result = await createService(new OriginAgent("real")).recommend(
    recommendInput("req_origin_service")
  );
  expect(result).toMatchObject({
    dataOrigin: "real",
    response: { quest_id: "look_far_01" }
  });
});

it("sets recommend origin from the actual execution", async () => {
  const response = await realAgentServer.inject({
    method: "POST",
    url: "/v1/rest/recommend",
    headers: baseHeaders("req_real_recommend"),
    payload: recommendPayload("req_real_recommend")
  });
  expect(response.headers["x-hush-data-origin"]).toBe("real");
  expect(response.json()).toMatchObject({ quest_id: "look_far_01" });
  expect(response.json()).not.toHaveProperty("dataOrigin");
});
```

Define `OriginAgent` locally in `rest-service.test.ts`:

```typescript
class OriginAgent extends CannedAgentLLM {
  constructor(readonly dataOrigin: DataOrigin) {
    super();
  }

  override async chooseQuest(
    input: RestRecommendationRequest,
    allowed: RestQuest[],
    options?: ProviderCallOptions
  ): Promise<AgentExecution<RestQuestRecommendation>> {
    const result = await super.chooseQuest(input, allowed, options);
    return { ...result, dataOrigin: this.dataOrigin };
  }
}
```

Also add a concurrency test that runs one real and one mock recommendation through `Promise.all` and verifies each response header independently.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --dir server test -- tests/unit/rest-service.test.ts tests/integration/http-contract.test.ts`

Expected: FAIL because `RestService.recommend` returns the body directly and the route uses static graph origin.

- [ ] **Step 3: Add the internal execution result**

```typescript
export interface RestRecommendationExecution {
  response: RestQuestRecommendation;
  dataOrigin: DataOrigin;
}

async recommend(
  input: RestRecommendationRequest
): Promise<RestRecommendationExecution> {
  // existing request/content/eligible validation stays here
  const execution = await withProviderTimeout({
    timeoutMs: this.options.llmTimeoutMs ?? 15_000,
    timeoutError: () => this.llmTimeoutError("choose_quest"),
    operation: (signal) =>
      this.agent.chooseQuest(request, eligible, { signal })
  });
  const response = restQuestRecommendationSchema.parse(execution.value);
  if (!eligible.some((quest) => quest.id === response.quest_id)) {
    throw new AppError({
      code: "LLM_INVALID_OUTPUT",
      message: "模型选择了固定内容库之外的任务。",
      statusCode: 503,
      retryable: true,
      fallback: eligible[0]?.id ?? "LOCAL_QUEST"
    });
  }
  return { response, dataOrigin: execution.dataOrigin };
}
```

In the Fastify route, override headers after the service returns:

```typescript
const execution = await context.rest.recommend(input);
setResponseHeaders(reply, context.requestId, execution.dataOrigin);
return execution.response;
```

Keep error responses on the existing safe graph-origin path because no successful provider result exists.

- [ ] **Step 4: Tighten the Claude intro prompt**

Add these exact constraints inside `ClaudeAgentLLM.chooseQuest`:

```text
The optional intro must be concise, concrete, ordinary Simplified Chinese.
Use only fields present in RestRecommendationRequest. It does not contain elapsed usage minutes, so never invent or mention elapsed time.
Do not say 陪你, 疗愈, 能量, 状态, 节奏, 温柔地, 正合适, or 允许自己.
Do not invent task steps or describe an action not represented by the selected quest.
```

Add a prompt-builder unit assertion so these prohibitions cannot be removed accidentally. Export a package-internal `buildQuestSelectionPrompt` instead of inspecting private SDK calls.

For non-estimated Mac evaluation, make the rule provider's factual message human and deterministic:

```typescript
const minutes = context.usage.continuousMinutes;
const message = context.usage.continuousIsEstimated
  ? "已经看屏幕一阵子了。累了吧？"
  : `${minutes} 分钟了。累了吧？`;
```

Add provider-contract assertions for both exact Mac usage and estimated iOS usage. The LLM is not the source of the minute count.

- [ ] **Step 5: Run the full server check**

Run: `pnpm --dir server check`

Expected: typecheck, all Vitest suites, and build PASS.

- [ ] **Step 6: Commit the server HTTP behavior**

```bash
git add server/src/application/rest/rest-service.ts server/src/api/create-server.ts server/src/agent/claude-llm.ts server/src/agent/rest-decision-providers.ts server/tests/unit/rest-service.test.ts server/tests/unit/claude-quest-prompt.test.ts server/tests/integration/http-contract.test.ts server/tests/unit/composition.test.ts server/tests/provider-contracts/rest-decision-provider.test.ts
git commit -m "feat(rest): expose actual recommendation origin"
```

### Task 3: Add Apple Contract Types and Test Targets

**Files:**

- Create: `apps/HushApp/Shared/Core/Networking/HushRestRecommendationClient.swift`
- Create: `apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift`
- Create: `apps/HushApp/iOSAppTests/HushCompanionRestResolutionTests.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`
- Modify: `apps/HushApp/Hush.xcodeproj/xcshareddata/xcschemes/Hush.xcscheme`
- Modify: `apps/HushApp/Hush.xcodeproj/xcshareddata/xcschemes/HushMac.xcscheme`

**Interfaces:**

- Produces: `HushDataOrigin`, `HushRestRecommendationRequest`, `HushRestRecommendation`, `HushRestRecommendationServing`.
- Test targets: `HushMacTests` depends on `HushMac`; `HushTests` depends on `Hush`.

- [ ] **Step 1: Add the owner-approved test targets without changing capabilities**

Create unit-test bundle targets with these product settings only:

```text
HushMacTests: com.apple.product-type.bundle.unit-test, macOS, TEST_HOST=$(BUILT_PRODUCTS_DIR)/HushMac.app/Contents/MacOS/HushMac
HushTests:    com.apple.product-type.bundle.unit-test, iOS Simulator, TEST_HOST=$(BUILT_PRODUCTS_DIR)/Hush.app/Hush
```

Attach each test target to the corresponding shared scheme TestAction. Do not touch signing, entitlements, App Groups, application target capabilities, deployment targets, or package references.

- [ ] **Step 2: Add failing DTO decoding tests**

```swift
func testRecommendationDecodesContractOneBodyAndOrigin() throws {
    let body = Data(#"{
      "schema_version":"1.0",
      "request_id":"req_1",
      "content_version":"1.0.0",
      "quest_id":"wash_face_01",
      "reason_code":"long_continuous_use",
      "intro":"先离开屏幕一会。",
      "fallback_quest_id":"look_far_emergency"
    }"#.utf8)
    let value = try JSONDecoder().decode(
        HushRestRecommendation.self,
        from: body
    )
    XCTAssertEqual(value.questID, "wash_face_01")
    XCTAssertEqual(value.schemaVersion, "1.0")
}
```

- [ ] **Step 3: Run each test scheme and verify missing-type failure**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' test
```

Expected: FAIL because contract types are not defined.

- [ ] **Step 4: Implement contract-1.0 DTOs and protocol**

```swift
enum HushDataOrigin: String, Codable, Equatable, Sendable {
    case real, mock, cached, local
}

struct HushRestRecommendation: Decodable, Equatable, Sendable {
    let schemaVersion: String
    let requestID: String
    let contentVersion: String
    let questID: String
    let reasonCode: String
    let intro: String?
    let fallbackQuestID: String?

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case requestID = "request_id"
        case contentVersion = "content_version"
        case questID = "quest_id"
        case reasonCode = "reason_code"
        case intro
        case fallbackQuestID = "fallback_quest_id"
    }
}

struct HushRestRecommendationRequest: Encodable, Equatable {
    let schemaVersion = "1.0"
    let requestID: String
    let sessionID: String
    let contentVersion: String
    let fatigueType: String
    let userPreference: String?
    let availableMinutes: Int
    let source: String
    let locationTags: [String]
    let excludedQuestIDs: [String]
    let allowedQuestIDs: [String]
}

struct HushRestRecommendationResult: Equatable {
    let recommendation: HushRestRecommendation
    let dataOrigin: HushDataOrigin
}

protocol HushRestRecommendationServing {
    func recommend(
        baseURL: URL,
        request: HushRestRecommendationRequest
    ) async throws -> HushRestRecommendationResult
}

enum HushRestRecommendationClientError: Error, Equatable {
    case invalidBaseURL
    case invalidResponse
    case requestFailed(statusCode: Int)
    case requestIDMismatch
    case contractVersionMismatch
    case contentVersionMismatch
    case invalidDataOrigin
}
```

Use explicit snake-case CodingKeys matching the frozen schema. Do not add `generated_task`.

- [ ] **Step 5: Run DTO tests and both application builds**

Run the two test commands above, then:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -configuration Debug -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS.

- [ ] **Step 6: Commit the Apple test foundation**

```bash
git add apps/HushApp/Hush.xcodeproj apps/HushApp/Shared/Core/Networking/HushRestRecommendationClient.swift apps/HushApp/MacMenuBarTests apps/HushApp/iOSAppTests
git commit -m "test(apple): add rest agent contract coverage"
```

### Task 4: Implement the Shared HTTPS Recommendation Client

**Files:**

- Modify: `apps/HushApp/Shared/Core/Networking/HushRestRecommendationClient.swift`
- Modify: `apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift`

**Interfaces:**

- Consumes: DTOs and protocol from Task 3.
- Produces: `HTTPHushRestRecommendationClient(session: URLSession)`.
- Enforces: HTTPS base URL, 8-second timeout, response request ID, contract version, content version, and origin header.
- HTTP responses may decode only `real`, `mock`, or `cached`; a remote `local` header is invalid.

- [ ] **Step 1: Add failing URLProtocol-backed client tests**

```swift
func testRecommendValidatesHeadersAndReturnsOrigin() async throws {
    StubURLProtocol.handler = { request in
        XCTAssertEqual(request.value(forHTTPHeaderField: "X-Contract-Version"), "1.0")
        XCTAssertEqual(request.url?.path, "/v1/rest/recommend")
        return stubResponse(
            requestID: "req_client",
            origin: "real",
            questID: "wash_face_01"
        )
    }
    let result = try await client.recommend(
        baseURL: URL(string: "https://staging.example")!,
        request: request(id: "req_client")
    )
    XCTAssertEqual(result.dataOrigin, .real)
    XCTAssertEqual(result.recommendation.questID, "wash_face_01")
}
```

Use this test-only URL loader in the same test target:

```swift
final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    static var responses: [(HTTPURLResponse, Data)] = []
    static var paths: [String] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        do {
            Self.paths.append(request.url?.path ?? "")
            let (response, data): (HTTPURLResponse, Data)
            if let handler = Self.handler {
                (response, data) = try handler(request)
            } else {
                (response, data) = Self.responses.removeFirst()
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
```

Add separate tests for mismatched request ID, missing/unsupported contract header, mismatched content version, invalid origin, HTTP 409, HTTP 503, and non-HTTPS base URL.

- [ ] **Step 2: Run HushMacTests and verify client failures**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' test`

Expected: FAIL because the HTTP implementation is not present.

- [ ] **Step 3: Implement the minimal HTTPS client**

```swift
struct HTTPHushRestRecommendationClient: HushRestRecommendationServing {
    let session: URLSession

    func recommend(
        baseURL: URL,
        request input: HushRestRecommendationRequest
    ) async throws -> HushRestRecommendationResult {
        guard baseURL.scheme?.lowercased() == "https" else {
            throw HushRestRecommendationClientError.invalidBaseURL
        }
        var request = URLRequest(
            url: baseURL
                .appendingPathComponent("v1")
                .appendingPathComponent("rest")
                .appendingPathComponent("recommend")
        )
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.httpBody = try JSONEncoder().encode(input)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(input.requestID, forHTTPHeaderField: "X-Request-ID")
        request.setValue("1.0.0", forHTTPHeaderField: "X-Client-Version")
        request.setValue("1.0", forHTTPHeaderField: "X-Contract-Version")
        // Decode and validate status and all echoed headers before returning.
    }
}
```

Do not retry. Do not print body data or secrets in errors.

- [ ] **Step 4: Run the full HushMac test target**

Run the test command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit the shared client**

```bash
git add apps/HushApp/Shared/Core/Networking/HushRestRecommendationClient.swift apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift
git commit -m "feat(apple): add contract one recommendation client"
```

### Task 5: Add the Mac Two-Stage Pipeline

**Files:**

- Create: `apps/HushApp/MacMenuBar/Platform/MacRestAgentPipeline.swift`
- Modify: `apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift`
- Modify: `apps/HushApp/Shared/Core/Networking/HushCompanionPeerSync.swift:4-29`
- Modify: `apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift:3-30,417-460`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`

**Interfaces:**

- Produces: `MacRestEvaluation`, `MacRestRecommendationContext`, and `MacRestAgentPipeline.resolve(...)`.
- Changes: `HushCompanionDecision` removes `generatedTask`, adds `dataOrigin: HushDataOrigin`.
- Changes: private peer `protocolVersion` increments from 2 to 3 because the Codable payload changes.

Define the pipeline inputs exactly as follows:

```swift
struct MacRestEvaluation: Equatable {
    let requestID: String
    let shouldOfferRest: Bool
    let reasonCode: String
    let message: String
    let defaultQuestID: String?

    static func off(requestID: String) -> Self {
        Self(
            requestID: requestID,
            shouldOfferRest: false,
            reasonCode: "insufficient_signal",
            message: "",
            defaultQuestID: nil
        )
    }
}

struct MacRestRecommendationContext {
    let baseURL: URL
    let request: HushRestRecommendationRequest
    let allowedQuestIDs: Set<String>
    let emergencyQuestID: String
}
```

Test helpers have these exact contracts:

```swift
final class SpyRecommendationService: HushRestRecommendationServing {
    private(set) var callCount = 0
    var result: Result<HushRestRecommendationResult, Error>

    init(
        result: Result<HushRestRecommendationResult, Error> =
            .failure(HushRestRecommendationClientError.invalidResponse)
    ) {
        self.result = result
    }

    func recommend(
        baseURL: URL,
        request: HushRestRecommendationRequest
    ) async throws -> HushRestRecommendationResult {
        callCount += 1
        return try result.get()
    }
}

final class StubRecommendationService: HushRestRecommendationServing {
    let result: HushRestRecommendationResult

    init(questID: String, intro: String?, origin: HushDataOrigin) {
        result = HushRestRecommendationResult(
            recommendation: HushRestRecommendation(
                schemaVersion: "1.0",
                requestID: "req_recommend",
                contentVersion: "1.0.0",
                questID: questID,
                reasonCode: "long_continuous_use",
                intro: intro,
                fallbackQuestID: "look_far_emergency"
            ),
            dataOrigin: origin
        )
    }

    func recommend(
        baseURL: URL,
        request: HushRestRecommendationRequest
    ) async throws -> HushRestRecommendationResult {
        result
    }
}
```

- [ ] **Step 1: Add failing merge and fallback tests**

```swift
func testOffEvaluationDoesNotCallRecommend() async throws {
    let recommender = SpyRecommendationService()
    let result = await pipeline(recommender).resolve(
        evaluation: .off(requestID: "req_eval"),
        context: context
    )
    XCTAssertNil(result)
    XCTAssertEqual(recommender.callCount, 0)
}

func testRecommendationOverridesEvaluateFallback() async throws {
    let result = await pipeline(
        StubRecommendationService(
            questID: "wash_face_01",
            intro: "先离开屏幕一会。",
            origin: .real
        )
    ).resolve(evaluation: offeredEvaluation, context: context)
    XCTAssertEqual(result?.defaultQuestID, "wash_face_01")
    XCTAssertEqual(result?.message, offeredEvaluation.message)
    XCTAssertEqual(result?.dataOrigin, .real)
}
```

Add tests for recommendation failure, unknown quest ID, empty intro, content-version mismatch, evaluate default ID, emergency fallback, and excluded recently completed ID.

- [ ] **Step 2: Run HushMacTests and verify missing-pipeline failure**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' test`

Expected: FAIL because `MacRestAgentPipeline` is undefined.

- [ ] **Step 3: Implement pure merge policy**

```swift
struct MacRestAgentPipeline {
    let recommender: any HushRestRecommendationServing

    func resolve(
        evaluation: MacRestEvaluation,
        context: MacRestRecommendationContext
    ) async -> HushCompanionDecision? {
        guard evaluation.shouldOfferRest else { return nil }
        do {
            let result = try await recommender.recommend(
                baseURL: context.baseURL,
                request: context.request
            )
            guard
                result.recommendation.requestID == context.request.requestID,
                result.recommendation.contentVersion
                    == context.request.contentVersion,
                context.allowedQuestIDs.contains(
                    result.recommendation.questID
                )
            else {
                return fallback(evaluation: evaluation, context: context)
            }
            return decision(
                evaluation: evaluation,
                questID: result.recommendation.questID,
                intro: result.recommendation.intro,
                origin: result.dataOrigin
            )
        } catch {
            return fallback(evaluation: evaluation, context: context)
        }
    }
}
```

The implementation must include these private methods; later tasks rely on their policy, not their visibility:

```swift
private func fallback(
    evaluation: MacRestEvaluation,
    context: MacRestRecommendationContext
) -> HushCompanionDecision

private func decision(
    evaluation: MacRestEvaluation,
    questID: String,
    intro: String?,
    origin: HushDataOrigin
) -> HushCompanionDecision
```

Fallback order must be: valid evaluate `default_quest_id`, then bundled `look_far_emergency`. Every Mac-side fallback Decision uses `dataOrigin: .local`. Intro order must be: non-empty factual evaluate message, recommendation intro, then `先停一会。`. The recommendation intro must never be treated as a source of elapsed usage time.

- [ ] **Step 4: Remove generated task transport**

Delete `GeneratedRestTask`, `generatedTask` fields, and their Codable keys. Update `HushCompanionDecision`:

```swift
struct HushCompanionDecision: Codable, Equatable {
    let id: String
    let decidedAt: Date
    let shouldOfferRest: Bool
    let reasonCode: String
    let message: String
    let defaultQuestID: String?
    let dataOrigin: HushDataOrigin
}
```

Increment `HushCompanionSnapshot.protocolVersion` to `3`; old peers must reject incompatible snapshots through the existing version guard.

- [ ] **Step 5: Run Mac tests and both Apple builds**

Run HushMacTests plus both build commands from Task 3.

Expected: PASS.

- [ ] **Step 6: Commit the pipeline and peer contract**

```bash
git add apps/HushApp/MacMenuBar/Platform/MacRestAgentPipeline.swift apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift apps/HushApp/Shared/Core/Networking/HushCompanionPeerSync.swift apps/HushApp/Shared/Features/RestQuest/HushRestContent.swift apps/HushApp/Hush.xcodeproj/project.pbxproj
git commit -m "feat(mac): resolve fixed rest quests through agent"
```

### Task 6: Wire Mac App and Website Monitoring Into the Pipeline

**Files:**

- Modify: `apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift:44-102,740-845`
- Modify: `apps/HushApp/MacMenuBar/Platform/MacWebsiteMonitoringModel.swift:40-100,430-519`
- Modify: `apps/HushApp/MacMenuBar/Platform/MacRestAgentPipeline.swift`
- Modify: `apps/HushApp/MacMenuBar/App/HushMacApp.swift:5-205`
- Modify: `apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift`

**Interfaces:**

- Consumes: `MacRestAgentPipeline` and shared recommendation client.
- Produces: one final fixed-ID `HushCompanionDecision` for App or website checkpoints.
- Publishes website decisions through `Notification.Name.hushMacCompanionDecisionUpdated`; `MacUsageMonitoringModel` owns the latest synchronized decision.

Add dependency-injection seams rather than networking globals:

```swift
@MainActor
final class MacCompanionDecisionCenter: ObservableObject {
    static let shared = MacCompanionDecisionCenter()
    @Published private(set) var current: HushCompanionDecision?

    func publish(_ decision: HushCompanionDecision) {
        guard current?.id != decision.id else { return }
        current = decision
    }

    func clear(decisionID: String?) {
        guard decisionID == nil || current?.id == decisionID else { return }
        current = nil
    }
}

@MainActor
init(
    session: URLSession = .shared,
    recommender: any HushRestRecommendationServing =
        HTTPHushRestRecommendationClient(session: .shared),
    decisionPublisher: @escaping (HushCompanionDecision) -> Void =
        MacCompanionDecisionCenter.shared.publish
)

// Internal test seam; production timers call the same operation.
func sendCheckpointForTesting(now: Date) async
var latestDecisionForTesting: HushCompanionDecision? { get }
```

Both monitoring models publish into the same center. `MacUsageMonitoringModel.publishCompanionSnapshot`
reads `center.current`, and companion commands clear that same center. The test target defines
`MacCheckpointHarness` as a thin wrapper around this initializer and these two internal test
members; it contains no duplicate decision logic.

- [ ] **Step 1: Add integration-style model tests with stub sessions**

```swift
func testAutomaticCheckpointUsesContractOneThenRecommend() async throws {
    StubURLProtocol.responses = [
        evaluateResponse(shouldOffer: true, defaultQuestID: "look_far_01"),
        recommendResponse(questID: "wash_face_01", intro: "先离开屏幕一会。")
    ]
    await harness.sendCheckpoint()
    XCTAssertEqual(StubURLProtocol.paths, [
        "/v1/rest/evaluate",
        "/v1/rest/recommend"
    ])
    XCTAssertEqual(harness.latestDecision?.defaultQuestID, "wash_face_01")
}
```

Add tests for `should_offer_rest=false`, 409, 503, timeout, website decision publication, duplicate decision IDs, five-item exclusion history, and remind-later/completion cooldown.

- [ ] **Step 2: Run HushMacTests and confirm current 1.1/generated-task behavior fails**

Run the HushMac test command.

Expected: FAIL because current clients send `X-Contract-Version: 1.1` and require `generated_task`.

- [ ] **Step 3: Replace direct generated-task decoding with the pipeline**

For both monitoring models:

1. Send evaluate with `X-Contract-Version: 1.0` and 5-second timeout, as required by `docs/17_APPLE_REST_DECISION_HANDOFF.md`.
2. Validate response status, `X-Request-ID`, `X-Contract-Version`, and `X-Hush-Data-Origin`.
3. If false, publish no Decision and do not call recommend.
4. If true, build the recommendation request from bundled manifest version and IDs.
5. Call `MacRestAgentPipeline.resolve` once.
6. Publish the returned Decision to Companion Sync and the existing Mac notification controller.
7. Maintain a bounded list of the five most recently completed or skipped quest IDs and send it as `excluded_quest_ids`.
8. Set `nextAutomaticEvaluationAt` after remind-later, dismissal, and completion so the next timer checkpoint cannot immediately redisplay a new Decision.

Do not expose error text in the companion task UI. Keep technical status only in the existing Mac settings/dashboard diagnostics.

- [ ] **Step 4: Simplify Mac notification persistence**

`HushMacRestSuggestion` becomes:

```swift
struct HushMacRestSuggestion: Codable, Equatable, Sendable {
    let requestID: String
    let message: String
    let questID: String
    let dataOrigin: HushDataOrigin
}
```

Remove `generated_task_title`, `generated_task_duration_seconds`, and `generated_task_steps` notification keys and overloads. Persist only request ID, message, quest ID, and origin.

- [ ] **Step 5: Run Mac tests and build**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -configuration Debug -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
```

Expected: PASS.

- [ ] **Step 6: Commit Mac integration**

```bash
git add apps/HushApp/MacMenuBar/Platform/MacUsageMonitoringModel.swift apps/HushApp/MacMenuBar/Platform/MacWebsiteMonitoringModel.swift apps/HushApp/MacMenuBar/Platform/MacRestAgentPipeline.swift apps/HushApp/MacMenuBar/App/HushMacApp.swift apps/HushApp/MacMenuBarTests/MacRestAgentPipelineTests.swift
git commit -m "feat(mac): run evaluate then recommend"
```

### Task 7: Resolve and Present Fixed Tasks on iPhone

**Files:**

- Modify: `apps/HushApp/iOSApp/Platform/HushCompanionRestAgentService.swift`
- Modify: `apps/HushApp/iOSApp/App/HushApp.swift:300-645,659-870`
- Modify: `apps/HushApp/iOSAppTests/HushCompanionRestResolutionTests.swift`

**Interfaces:**

- Consumes: `HushCompanionDecision.defaultQuestID` and `.dataOrigin`.
- Produces: internal `HushResolvedCompanionRest { quest, intro, dataOrigin }`.
- Manual long-press uses the same contract-1.0 recommendation client and fixed-ID resolution.

Define the presentation types before changing the view:

```swift
struct HushResolvedCompanionRest: Equatable {
    let quest: HushQuestContent
    let intro: String
    let dataOrigin: HushDataOrigin
}

struct HushCompanionRestPresentation {
    func lines(for quest: HushQuestContent) -> [String] {
        quest.steps
    }

    func sampleModeLabel(for origin: HushDataOrigin?) -> String? {
        origin == .mock ? "演示模式" : nil
    }
}
```

- [ ] **Step 1: Add failing resolution and copy tests**

```swift
func testKnownQuestResolvesFromBundledContent() {
    let resolved = resolver.resolve(
        decision: decision(questID: "wash_face_01", origin: .real),
        content: content
    )
    XCTAssertEqual(resolved.quest.id, "wash_face_01")
    XCTAssertEqual(resolved.intro, "69 分钟了。累了吧？")
}

func testUnknownQuestUsesEmergencyFallback() {
    let resolved = resolver.resolve(
        decision: decision(questID: "invented", origin: .real),
        content: content
    )
    XCTAssertEqual(resolved.quest.id, "look_far_emergency")
}

func testTaskLinesAreNotNumbered() {
    XCTAssertEqual(
        presentation.lines(for: quest),
        quest.steps
    )
    XCTAssertFalse(presentation.lines(for: quest).joined().contains("1."))
}
```

Add tests that mock origin shows `演示模式`, real/cached/local fallback does not, duplicate decisions are ignored, and manual request failure retains a local quest.

- [ ] **Step 2: Run HushTests and verify current generated-task/numbering failures**

Run: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' test`

Expected: FAIL because the resolver/presentation types are missing and current UI prefixes step numbers.

- [ ] **Step 3: Implement fixed-ID resolution**

```swift
struct HushCompanionRestResolver {
    func resolve(
        decision: HushCompanionDecision,
        content: HushDemoContentSnapshot
    ) -> HushResolvedCompanionRest {
        let quest = decision.defaultQuestID.flatMap { id in
            content.quests.first { $0.id == id }
        } ?? .emergencyFallback
        let intro = decision.message.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        return HushResolvedCompanionRest(
            quest: quest,
            intro: intro.isEmpty ? "先停一会。" : intro,
            dataOrigin: decision.dataOrigin
        )
    }
}
```

Unknown IDs never reach UI as arbitrary content.

- [ ] **Step 4: Update the companion UI without changing the wave composition**

Replace numbered `ForEach` text with plain lines:

```swift
VStack(alignment: .leading, spacing: 9) {
    ForEach(Array(quest.steps.enumerated()), id: \.offset) { _, step in
        Text(step)
    }
}
```

When `dataOrigin == .mock`, add one low-contrast `Text("演示模式")` near the existing timer/status region. Do not add a card, alert, model name, Agent label, or technical error. Replace AI-like fallback lines with concrete defaults:

```swift
working: ""
rest fallback: "先停一会。"
```

- [ ] **Step 5: Reuse the 1.0 client for manual long-press**

`HTTPHushCompanionRestAgentService` must call the shared recommendation client, resolve the returned `quest_id` from `HushDemoContentSnapshot`, and preserve the local quest selected before the network request. Delete all `generated_task`, `schema_version: 1.1`, and `dynamic-rest-decision-v1.1` code paths.

- [ ] **Step 6: Run iPhone tests, build, and inspect two screenshots**

Run HushTests and the Hush simulator build from Task 3. Launch the App with one real-origin fixture and one mock-origin fixture. Capture screenshots and verify:

- no numbered steps;
- no text overlap at iPhone 17e size;
- mock badge is visible but secondary;
- real task has no AI/Agent badge;
- wave framing is unchanged.

Expected: PASS and visually consistent screenshots.

- [ ] **Step 7: Commit iPhone integration**

```bash
git add apps/HushApp/iOSApp/Platform/HushCompanionRestAgentService.swift apps/HushApp/iOSApp/App/HushApp.swift apps/HushApp/iOSAppTests/HushCompanionRestResolutionTests.swift
git commit -m "feat(ios): present agent-selected local rest quests"
```

### Task 8: Verify Staging and Real-Device Handoff

**Files:**

- Create: `docs/runbooks/stable-rest-agent-staging.md`
- Modify only if deployment validation exposes an implementation defect: files already authorized above.

**Interfaces:**

- Consumes: staging `CLAUDE_API_KEY`, `CLAUDE_MODEL`, public base URL, HushMac, and signed Hush iPhone app.
- Produces: reproducible evidence for real, mock fallback, cooldown, reconnect, and privacy behavior.

- [ ] **Step 1: Write the runbook before deployment**

Include these exact checks without secret values:

```markdown
- [ ] GET /v1/health returns 200 and contract 1.0
- [ ] real /v1/rest/recommend returns an allowed quest_id and origin real
- [ ] forced fallback returns an allowed quest_id and origin mock
- [ ] Mac evaluate false does not call recommend
- [ ] Mac evaluate true calls recommend once
- [ ] iPhone resolves the same quest_id locally
- [ ] completing rest clears the decision and starts cooldown
- [ ] reconnect does not redisplay the same decision
- [ ] logs contain request IDs, not user labels, prompts, secrets, or response bodies
```

- [ ] **Step 2: Run full pre-deploy verification**

Run:

```bash
pnpm --dir server check
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 17e' test
```

Expected: all PASS.

- [ ] **Step 3: Deploy through the repository's existing staging path**

Confirm the deployment platform has `CLAUDE_API_KEY` and `CLAUDE_MODEL` configured without reading or printing their values. Deploy the reviewed server commit through the existing staging integration; do not introduce a new deployment mechanism.

- [ ] **Step 4: Smoke the real recommendation endpoint**

Send a contract-1.0 request whose `allowed_quest_ids` contains two known bundled IDs. Verify:

```text
HTTP 200
X-Contract-Version: 1.0
X-Request-ID: exact request ID
X-Hush-Data-Origin: real
body.quest_id is one of allowed_quest_ids
body has no generated_task or steps
```

Do not paste API keys or private deployment tokens into the command or runbook.

- [ ] **Step 5: Install signed builds and run the real-device scenario**

1. Launch HushMac with the staging base URL.
2. Install and launch the signed Hush build on the connected iPhone.
3. Confirm Companion Sync reports connected.
4. Use the existing debug checkpoint to produce `should_offer_rest=true`.
5. Confirm staging receives evaluate then recommend once.
6. Confirm iPhone shows the final factual intro and local quest within several seconds.
7. Tap `我休息好了`; confirm the same Decision clears on Mac and iPhone.
8. Confirm no second reminder during cooldown.

- [ ] **Step 6: Run fallback and reconnect scenarios**

Temporarily use the staging failure-injection path or a reviewed mock override, never an invalid production secret. Verify mock is labeled `演示模式`, local network failure has no technical alert, and reconnect does not redisplay the same Decision.

- [ ] **Step 7: Record evidence and commit the runbook**

Record commit SHA, app build number, device OS, timestamps, request IDs, quest IDs, origins, and pass/fail only. Do not record prompts, secrets, raw labels, or response bodies.

```bash
git add docs/runbooks/stable-rest-agent-staging.md
git commit -m "docs: record stable rest agent staging verification"
```

### Task 9: Final Regression and Scope Audit

**Files:**

- No new files expected.
- Inspect all files changed by Tasks 1-8.

**Interfaces:**

- Verifies the complete design contract and repository ownership boundaries.

- [ ] **Step 1: Run all automated checks again from a clean build state**

Run server check and both Apple test/build commands from previous tasks. Expected: PASS with no skipped relevant tests.

- [ ] **Step 2: Scan for forbidden generated-task and 1.1 paths**

Run:

```bash
rg -n 'generated_task|GeneratedRestTask|dynamic-rest-decision-v1\.1|X-Contract-Version.*1\.1' apps/HushApp server/src
```

Expected: no matches in the Rest Agent handoff path. Any unrelated historical documentation match must be reviewed and explicitly excluded, not deleted casually.

- [ ] **Step 3: Audit the final diff**

Confirm:

- `contracts/**`, entitlements, package manifests, and lockfiles are unchanged;
- only authorized Xcode target/scheme lines changed;
- no secret, staging credential, or full URL data was added;
- existing unrelated user changes were not reformatted or reverted;
- every changed line maps to the approved design.

- [ ] **Step 4: Record final verification**

Update the runbook with final automated command results and the real-device outcome, then commit only that update if needed.

- [ ] **Step 5: Request code review before integration**

Use `superpowers:requesting-code-review` against the implementation commits, with special attention to fixed-library enforcement, per-call origin concurrency, duplicate Decision handling, and Xcode project scope.

---

## Execution Notes

- Tasks 1-2 are W1/P2-owned and can be reviewed independently before Apple work.
- Task 3 is M1/P1-owned and requires explicit approval for the listed Xcode project and scheme changes.
- Tasks 4-7 are M1/P1-owned; Task 7 also touches one M2/P4-owned shared content file already authorized in the task card and therefore needs M2 review.
- Task 8 requires staging deployment authority and access to the physical iPhone but never requires disclosure of secret values.
- Do not execute Task 1 until the owner has checkpointed the current dirty worktree, because several target files already contain uncommitted work that this plan must preserve.
