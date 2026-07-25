# Apple Visual Main Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the approved local tide, Breath Tide, Inbox, Hush Door, and Sleep Handoff visuals onto latest `main` without regressing Dynamic Rest.

**Architecture:** Treat `/Users/jenniferzhou/Documents/Adventure X/Hush-UnifiedInbox` as a read-only visual source. Reconcile visual state machines into latest-main files by responsibility; preserve all current generated-task parameters, notifications, networking, and store behavior.

**Tech Stack:** Swift 6, SwiftUI, Metal, XCTest, Xcode 16, iOS Simulator and macOS targets.

## Global Constraints

- Never overwrite whole App entry or root-view files from the older visual branch.
- Preserve `suggestedGeneratedTask`, `initialGeneratedRestTask`, `HushDynamicRestSuggestion`, generation notifications, and `HTTPManualRestTaskProvider`.
- Preserve explicit Sample Mode wording for fixture Inbox actions.
- Do not add dependencies or alter signing, bundle IDs, App Groups, or entitlements in this plan.
- Port only assets and behavior present in the approved local visual source.

---

### Task 1: Add an Executable Apple Unit-test Target

**Files:**
- Create: `apps/HushApp/HushTests/HushTestTargetSmokeTests.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`
- Modify: `apps/HushApp/Hush.xcodeproj/xcshareddata/xcschemes/Hush.xcscheme`

**Interfaces:**
- Consumes: shared Swift sources compiled into `Hush`.
- Produces: `HushTests` XCTest bundle with `@testable import Hush`.

- [ ] **Step 1: Add a test-target smoke test**

```swift
import XCTest
@testable import Hush

final class HushTestTargetSmokeTests: XCTestCase {
    func testTargetLoadsApplicationModule() {
        XCTAssertEqual(GeneratedRestTask(title: "停一下", durationSeconds: 60, steps: ["呼吸"]).durationSeconds, 60)
    }
}
```

- [ ] **Step 2: Register `HushTests` in the project and scheme**

Add a unit-test `PBXNativeTarget`, product reference, Sources phase, target dependency on `Hush`, Debug/Release configurations, and a `TestableReference` in `Hush.xcscheme`. Use product type `com.apple.product-type.bundle.unit-test`, `TEST_HOST = "$(BUILT_PRODUCTS_DIR)/Hush.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Hush"`, and `BUNDLE_LOADER = "$(TEST_HOST)"`.

- [ ] **Step 3: Verify the target is runnable**

Run: `xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test`

Expected: `HushTestTargetSmokeTests` PASS.

- [ ] **Step 4: Commit test infrastructure**

```bash
git add apps/HushApp/HushTests apps/HushApp/Hush.xcodeproj
git commit -m "test(apple): add shared UI test target"
```

---

### Task 2: Port the Tide Rendering Unit

**Files:**
- Modify: `apps/HushApp/Shared/DesignSystem/Wave/HushWaveBackground.swift`
- Modify: `apps/HushApp/Shared/DesignSystem/Wave/HushWaveShaders.metal`
- Add from visual source: `apps/HushApp/Shared/DesignSystem/Wave/Assets/hush-companion-idle.png`
- Add from visual source: `apps/HushApp/Shared/DesignSystem/Wave/Assets/hush-companion-ocean-a.png`
- Add from visual source: `apps/HushApp/Shared/DesignSystem/Wave/Assets/hush-companion-ocean-b.png`
- Add from visual source: `apps/HushApp/Shared/DesignSystem/Wave/Assets/hush-companion-ocean-c.png`
- Add from visual source: `apps/HushApp/Shared/DesignSystem/Wave/Assets/hush-sleep-tide.png`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`
- Create: `apps/HushApp/HushTests/HushTideTimelineTests.swift`

**Interfaces:**
- Produces: `HushTideTimeline.tideDuration`, `tideProgress(elapsed:)`, `HushTideReveal.settled`, `HushTidePageSurface`, and `View.hushTideReveal(...)`.

- [ ] **Step 1: Write the failing tide timeline test**

```swift
import XCTest
@testable import Hush

final class HushTideTimelineTests: XCTestCase {
    func testTideProgressIsBoundedAndMonotonic() {
        let samples = stride(from: 0.0, through: 5.0, by: 0.05)
            .map { HushTideTimeline.tideProgress(elapsed: $0) }
        XCTAssertEqual(samples.first!, 0, accuracy: 0.0001)
        XCTAssertEqual(samples.last!, 1, accuracy: 0.0001)
        XCTAssertTrue(zip(samples, samples.dropFirst()).allSatisfy { $0 <= $1 })
    }
}
```

- [ ] **Step 2: Verify the tide test fails**

Run: `xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test`

Expected: FAIL because `HushTideTimeline` is not yet present on latest main.

- [ ] **Step 3: Port the exact visual-source wave implementation and binary assets**

Use the visual source file as the patch reference, retaining latest-main APIs used outside it. Register Metal and PNG resources for both iOS and macOS targets; do not register build products or `design-references/`.

- [ ] **Step 4: Run the tide unit test**

Run the Task 1 `xcodebuild ... test` command.

Expected: `HushTideTimelineTests` PASS.

- [ ] **Step 5: Build both apps**

Run:

```bash
xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' CODE_SIGNING_ALLOWED=NO build
```

Expected: both builds PASS and Metal compiles for both targets.

- [ ] **Step 6: Commit the rendering unit**

```bash
git add apps/HushApp/Shared/DesignSystem/Wave apps/HushApp/Hush.xcodeproj/project.pbxproj apps/HushApp/HushTests/HushTideTimelineTests.swift
git commit -m "feat(apple): port shared tide rendering"
```

---

### Task 3: Port Breath Tide and Door Trigger

**Files:**
- Create from visual source: `apps/HushApp/Shared/Features/BreathTide/HushBreathTideView.swift`
- Create from visual source: `apps/HushApp/Shared/Features/BreathTide/HushBreathShaders.metal`
- Modify: `apps/HushApp/Shared/Features/HushDoor/HushDoorView.swift`
- Modify: `apps/HushApp/Hush.xcodeproj/project.pbxproj`
- Create: `apps/HushApp/HushTests/HushDoorTriggerTests.swift`

**Interfaces:**
- Produces: one-shot `onInboxSwipeTriggered`, explicit `onBreathLongPress`, and an opt-in Breath Tide overlay.

- [ ] **Step 1: Extract and test the trigger decision**

Expose an internal pure helper and test it:

```swift
XCTAssertFalse(HushDoorSwipeTrigger.shouldTrigger(translationY: -43, velocityY: 0))
XCTAssertTrue(HushDoorSwipeTrigger.shouldTrigger(translationY: -44, velocityY: 0))
XCTAssertTrue(HushDoorSwipeTrigger.shouldTrigger(translationY: -12, velocityY: -700))
XCTAssertFalse(HushDoorSwipeTrigger.shouldTrigger(translationY: 20, velocityY: -50))
```

- [ ] **Step 2: Verify the helper test fails**

Run: `xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,name=iPhone 16 Pro' test`

Expected: FAIL with missing `HushDoorSwipeTrigger`.

- [ ] **Step 3: Port the helper, callbacks, and Breath Tide views**

Use a 44-point upward threshold and the visual source's flick threshold. Keep gesture recognition one-shot; Breath Tide starts only after the separate confirmation action.

- [ ] **Step 4: Run tests and both builds**

Expected: tests and iOS/macOS builds PASS.

- [ ] **Step 5: Commit the interaction unit**

```bash
git add apps/HushApp/Shared/Features/BreathTide apps/HushApp/Shared/Features/HushDoor apps/HushApp/Hush.xcodeproj apps/HushApp/HushTests/HushDoorTriggerTests.swift
git commit -m "feat(apple): add tide-triggered rest interactions"
```

---

### Task 4: Reconcile Root, Inbox, and Sleep Visuals with Dynamic Rest

**Files:**
- Modify: `apps/HushApp/Shared/Features/Demo/HushDemoRootView.swift`
- Modify: `apps/HushApp/Shared/Features/UnifiedInbox/UnifiedInboxView.swift`
- Modify: `apps/HushApp/Shared/Features/SleepHandoff/SleepHandoffView.swift`
- Create: `apps/HushApp/HushTests/HushDemoStoreDynamicRestTests.swift`

**Interfaces:**
- Consumes: Task 2 tide types and Task 3 callbacks.
- Preserves: `HushDemoRootView(... suggestedGeneratedTask:initialCompanionMessage:...)` and `HushDemoStore.presentRestSuggestion(task:)`.

- [ ] **Step 1: Add Dynamic Rest regression tests**

```swift
@MainActor
func testGeneratedTaskSurvivesVisualRouteChanges() {
    let task = GeneratedRestTask(title: "望向远处", durationSeconds: 60, steps: ["看向窗外"])
    let store = HushDemoStore(provider: StubContentProvider(), manualRestProvider: nil)
    store.presentRestSuggestion(task: task)
    XCTAssertEqual(store.generatedRestTask, task)
    store.openInbox()
    store.closeInbox()
    XCTAssertEqual(store.generatedRestTask, task)
}
```

Provide `StubContentProvider` in the test file with one valid quest, drift prompt, and blue-box card matching `HushRestContent` initializers.
Implement it without fixture files by throwing from all four protocol methods so
`HushDemoContentSnapshot` exercises its existing emergency fallback:

```swift
private struct StubContentProvider: HushRestContentProviding {
    enum StubError: Error { case unavailable }
    func loadManifest() throws -> HushContentManifest { throw StubError.unavailable }
    func loadQuests() throws -> [HushQuestContent] { throw StubError.unavailable }
    func loadDriftPrompts() throws -> [HushDriftPrompt] { throw StubError.unavailable }
    func loadBlueBoxCards() throws -> [HushBlueBoxCard] { throw StubError.unavailable }
}
```

- [ ] **Step 2: Run the regression test before the visual merge**

Expected: PASS, establishing the main behavior that must remain green.

- [ ] **Step 3: Reconcile root and feature views**

Add the visual source's shared `TimelineView`, `isRevealingInbox`, `tideStartedAt`, sleep-cover state, and Breath overlays. Keep main's generation loading view, generated-task inputs, notifications, companion messages, and `openAgentTask`. Pass `.settled` to an ordinarily presented Inbox and a live `HushTideReveal` during the transition.

Keep these Sample labels until Real Mode exists:

```text
演示摘要
重置演示草稿
模拟确认发送
当前为 Fixture 演示，只会更新本地状态，不会连接真实渠道。
```

- [ ] **Step 4: Run tests and builds**

Expected: all Hush tests, iOS build, and macOS build PASS.

- [ ] **Step 5: Commit the reconciled UI**

```bash
git add apps/HushApp/Shared/Features apps/HushApp/HushTests
git commit -m "feat(apple): merge tide experience onto dynamic rest"
```

---

### Task 5: Visual Verification

**Files:**
- Verify only; do not commit screenshots or build output.

- [ ] **Step 1: Launch iOS and macOS builds**

Exercise Door to Inbox, long-press Breath Tide, Dynamic Rest generated task, Inbox Sample edit/simulated send, and Sleep Handoff.

- [ ] **Step 2: Capture clean screenshots**

Capture iPhone portrait and macOS window states for Door, settled Inbox, detail/draft, Breath Tide, and Sleep Handoff. Inspect for blank assets, clipped text, overlap, unintended cards, and wrong Sample wording.

- [ ] **Step 3: Verify reduced motion**

Enable Reduce Motion and confirm the transition completes quickly without leaving invisible hit targets or a partially mounted Inbox.

- [ ] **Step 4: Record results in the final handoff**

List tested devices/destinations and any visual residual risk; do not add screenshot artifacts to Git.
