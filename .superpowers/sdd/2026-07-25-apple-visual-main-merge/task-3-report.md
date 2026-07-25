# Task 3 Report: Breath Tide and Door Trigger

## RED

Command:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/HushApp/Hush.xcodeproj -scheme Hush -destination 'platform=iOS Simulator,id=81BCDB5F-EA77-4398-ADA3-693501DF83BB' -derivedDataPath /tmp/HushVisualTask1Tests -only-testing:HushTests/HushDoorTriggerTests test
```

Result: failed as expected with `cannot find 'HushDoorSwipeTrigger' in scope` for all four threshold assertions.

## GREEN

The same focused command passed on iPhone 17 Pro. `HushDoorTriggerTests.testSwipeTriggerUsesDistanceOrFlickThreshold()` passed in 0.001 seconds.

## Builds

- iOS Simulator: `xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme Hush -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/HushVisualBaselineIOS CODE_SIGNING_ALLOWED=NO build` exited 0.
- macOS arm64: `xcodebuild -quiet -project apps/HushApp/Hush.xcodeproj -scheme HushMac -destination 'platform=macOS,arch=arm64' -derivedDataPath /tmp/HushVisualBaselineMac CODE_SIGNING_ALLOWED=NO build` exited 0.

## Files

- Added `apps/HushApp/Shared/Features/BreathTide/HushBreathTideView.swift` exactly from the approved visual source.
- Added `apps/HushApp/Shared/Features/BreathTide/HushBreathShaders.metal` exactly from the approved visual source.
- Added the internal pure `HushDoorSwipeTrigger`, one-shot swipe handling, macOS trackpad handling, and breath long-press callback in `HushDoorView.swift`.
- Added the opt-in invitation/session overlays to `HushDemoRootView.swift`; long press only offers the session and explicit acceptance starts it.
- Added a compatible `revealProgress` input to the existing procedural `HushWaveBackground`; its default zero-progress rendering is mathematically unchanged.
- Registered both Breath sources for iOS and macOS and the new helper test for `HushTests` in `project.pbxproj`.
- Added `apps/HushApp/HushTests/HushDoorTriggerTests.swift` with the four required distance/flick cases.

## Self-Review

- `cmp` confirmed both Breath Tide source files are byte-identical to the approved visual source.
- Preserved the latest-main Door task width and position rather than importing unrelated visual geometry changes.
- Preserved Dynamic Rest state, notification handling, generated-task behavior, and initializer parameters; root-view edits are limited to callback wiring and opt-in Breath overlays.
- `project.pbxproj` changes contain only file references and build-phase membership. Signing, bundle identifiers, App Groups, entitlements, and dependencies are unchanged.
- `plutil -lint apps/HushApp/Hush.xcodeproj/project.pbxproj` passed.
- `git diff --check` passed.

## Concerns

No known functional or build concerns. Per the speed constraint, no optional visual probes were run.
