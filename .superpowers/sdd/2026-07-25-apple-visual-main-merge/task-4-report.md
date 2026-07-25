# Task 4 Report: Root, Inbox, and Sleep Visual Reconciliation

## Status

Complete.

## Implementation

- Added `HushDemoStoreDynamicRestTests` to characterize generated-task persistence across Inbox route changes.
- Reconciled `HushDemoRootView` with the shared tide timeline, live Inbox reveal, settled Inbox state, sleep-cover transition, Reduce Motion handling, and existing Breath overlays.
- Preserved the Dynamic Rest inputs and runtime paths for generated suggestions, companion messages, generation notifications/loading, `openAgentTask`, generated-task actions, and `HTTPManualRestTaskProvider` through the unchanged store.
- Applied the approved reveal-aware Unified Inbox and cinematic Sleep Handoff visuals.
- Preserved the required Sample labels: `演示摘要`, `重置演示草稿`, `模拟确认发送`, and the Fixture-only disclosure.
- Added a VoiceOver `打开消息` accessibility action to the existing door swipe surface without changing swipe thresholds or gesture behavior.

## Verification

Pre-merge characterization:

- `HushDemoStoreDynamicRestTests/testGeneratedTaskSurvivesVisualRouteChanges`: PASS (0.006s).

Post-merge required verification:

- All Hush tests on simulator `81BCDB5F-EA77-4398-ADA3-693501DF83BB`: PASS (4 tests, 0 failures).
- iOS simulator build using `/tmp/HushVisualBaselineIOS`: PASS.
- macOS arm64 build using `/tmp/HushVisualBaselineMac`: PASS.
- `git diff --check`: PASS.

## Concerns

No blocking concerns. Per the speed constraint, verification was limited to the required automated tests and platform builds; no optional manual screenshot pass was run.

## Fix Round 1

### Implementation

- Restored the frozen Inbox Sample wording: `演示摘要`, `重置演示草稿`, and `模拟确认发送`; retained the Fixture-only disclosure.
- Moved the Sleep exit gesture from the whole handoff view to the completed branch and added `HushSleepExitPolicy`, which rejects all questionnaire-state drags.
- Added a semantic `今晚先到这里` button on the final `晚安` treatment that calls `onFinish`.
- Added a 0.2-second Reduce Motion completion duration and removed exit translation under Reduce Motion while preserving the ordinary 1.35-second gesture animation.
- Added focused pure policy tests for questionnaire rejection, completed-state eligibility, and Reduce Motion duration.

### Commands And Results

- RED: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,id=81BCDB5F-EA77-4398-ADA3-693501DF83BB' -derivedDataPath /tmp/HushVisualTask1Tests -only-testing:HushTests/HushSleepExitPolicyTests test` -> expected FAIL because `HushSleepExitPolicy` did not exist.
- GREEN: the same focused command -> PASS, 3 tests and 0 failures.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,id=81BCDB5F-EA77-4398-ADA3-693501DF83BB' -derivedDataPath /tmp/HushVisualTask1Tests test` -> PASS, 7 tests and 0 failures.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/HushVisualBaselineIOS CODE_SIGNING_ALLOWED=NO build` -> PASS.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' -derivedDataPath /tmp/HushVisualBaselineMac CODE_SIGNING_ALLOWED=NO build` -> PASS.

### Concerns

No blocking concerns. No optional probes or manual visual checks were run.
