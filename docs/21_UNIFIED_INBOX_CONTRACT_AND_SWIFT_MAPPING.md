# Unified Inbox Contract Compatibility Notice

The PR #18 W1 mock wire format is retired. It is not a supported runtime or
frontend integration target.

Use these sources instead:

- Runtime contract: `contracts/openapi.yaml`
- Apple integration guide: `docs/unified-inbox-apple-frontend-handoff.md`
- Real Feishu/DingTalk validation:
  `docs/feishu-dingtalk-real-validation/README.md`

The current SwiftUI Unified Inbox remains Fixture-only. A later Apple-owned
change will connect Real Mode to the W2 API; it must not reintroduce the W1
DTO field mappings or treat Fixture output as real provider data.
