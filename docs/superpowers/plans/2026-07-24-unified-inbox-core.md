# Unified Inbox Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testable Unified Inbox backend vertical slice that ingests Feishu, DingTalk, Outlook, and QQ Mail events, generates AI summaries and editable reply drafts, and sends only after one-time user confirmation.

**Architecture:** W2/P3 owns a provider-neutral `InboxService` behind Fastify routes. Provider adapters normalize external messages into `InboxEvent`; in-memory repositories support the demo while ports keep persistence, intelligence, credentials, checkpoints, and delivery replaceable. Real adapters use official CLIs or protocols, while Fixture and Unavailable implementations make the complete flow deterministic without real credentials.

**Tech Stack:** Node.js 20, TypeScript 5.9, Fastify 5, Zod 4, Vitest 3, OpenAPI 3.1, Anthropic SDK, `imapflow`, and `nodemailer`.

## Global Constraints

- Keep `CONTRACT_VERSION` at `"1.0"`; the change is additive.
- Do not modify `apps/HushApp/Hush.xcodeproj/**`, entitlements, signing, targets, or SwiftUI.
- Never log or return OAuth tokens, refresh tokens, SMTP authorization codes, or unredacted real message bodies.
- AI receives message content only; it never receives credentials, a send tool, or a `confirmationToken`.
- No send operation may run without matching `expected_version`, one-time `confirmation_token`, and `Idempotency-Key`.
- A provider timeout produces `unknown`; it must not trigger an automatic retry.
- Deduplicate by `provider + account_id + provider_message_id`.
- Preserve existing Rest and Handoff API behavior and tests.
- Use Fixture/Unavailable providers when real credentials or CLIs are absent.

---

### Task 1: Freeze Unified Inbox Contracts

**Files:**
- Create: `contracts/schemas/inbox-event-batch.schema.json`
- Create: `contracts/schemas/inbox-item.schema.json`
- Create: `contracts/schemas/inbox-draft.schema.json`
- Create: `contracts/schemas/inbox-send.schema.json`
- Create: `contracts/schemas/inbox-sync-status.schema.json`
- Create: `contracts/fixtures/inbox-event-batch-demo.json`
- Create: `contracts/fixtures/inbox-item-enriched-demo.json`
- Create: `contracts/fixtures/inbox-draft-edited-demo.json`
- Modify: `contracts/openapi.yaml`
- Modify: `server/src/domain/contracts.ts`
- Modify: `server/src/domain/errors.ts`
- Modify: `server/tests/contracts/openapi.test.ts`
- Modify: `server/tests/contracts/fixtures.test.ts`

**Interfaces:**
- Produces: `InboxEventBatch`, `UnifiedInboxItem`, `InboxDraft`, `InboxSendResult`, `InboxSyncStatus`.
- Produces schemas: `inboxEventBatchSchema`, `inboxDraftPatchSchema`, `inboxSendRequestSchema`.

- [ ] **Step 1: Write failing contract tests**

Add these exact assertions to `server/tests/contracts/openapi.test.ts`:

```typescript
it("declares the Unified Inbox API surface", () => {
  const document = parse(readFileSync(openApiPath, "utf8")) as OpenApiDocument;
  const operations = [
    ["/v1/inbox/events:batch", "post"],
    ["/v1/inbox/items", "get"],
    ["/v1/inbox/items/{itemId}", "get"],
    ["/v1/inbox/items/{itemId}/summary", "post"],
    ["/v1/inbox/items/{itemId}/draft", "post"],
    ["/v1/inbox/drafts/{draftId}", "get"],
    ["/v1/inbox/drafts/{draftId}", "patch"],
    ["/v1/inbox/drafts/{draftId}/confirmation", "post"],
    ["/v1/inbox/drafts/{draftId}:send", "post"],
    ["/v1/inbox/sync-status", "get"]
  ] as const;

  for (const [path, method] of operations) {
    expect(document.paths[path]?.[method]).toBeDefined();
  }
});
```

Add fixture parsing cases to `server/tests/contracts/fixtures.test.ts` for the three new fixtures using the exported Zod schemas.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/contracts/openapi.test.ts tests/contracts/fixtures.test.ts
```

Expected: FAIL because Inbox paths, schemas, and fixtures do not exist.

- [ ] **Step 3: Add provider-neutral Zod contracts**

Add these foundations to `server/src/domain/contracts.ts`:

```typescript
export const inboxProviderSchema = z.enum([
  "feishu",
  "dingtalk",
  "outlook",
  "qq_mail"
]);

export const inboxPrioritySchema = z.enum([
  "urgent",
  "normal",
  "low",
  "uncertain"
]);

export const inboxDraftStatusSchema = z.enum([
  "generating",
  "ready",
  "edited",
  "sending",
  "sent",
  "failed",
  "unknown"
]);

export const inboxEventSchema = z.object({
  provider: inboxProviderSchema,
  account_id: z.string().min(1),
  conversation_id: z.string().min(1).nullable(),
  provider_message_id: z.string().min(1),
  sender: z.string().min(1),
  recipients: z.array(z.string().min(1)),
  subject: z.string().nullable(),
  content: z.string().min(1),
  received_at: z.iso.datetime({ offset: true }),
  coverage: z.object({
    source: z.enum(["official_api", "imap", "browser_fallback"]),
    complete: z.boolean(),
    note: z.string().nullable()
  }).strict()
}).strict();

export const inboxEventBatchSchema = z.object({
  schema_version: schemaVersion,
  request_id: requestId,
  checkpoint: z.string().min(1),
  events: z.array(inboxEventSchema).max(100)
}).strict();

export const inboxDraftPatchSchema = z.object({
  schema_version: schemaVersion,
  request_id: requestId,
  content: z.string().min(1).max(20_000),
  content_type: z.enum(["text", "html"]),
  expected_version: z.number().int().min(1)
}).strict();

export const inboxSendRequestSchema = z.object({
  schema_version: schemaVersion,
  request_id: requestId,
  expected_version: z.number().int().min(1),
  confirmation_token: z.string().min(16)
}).strict();
```

Export inferred types and add these error codes:

```typescript
"INBOX_ITEM_NOT_FOUND",
"INBOX_DRAFT_NOT_FOUND",
"INBOX_VERSION_CONFLICT",
"INBOX_CONFIRMATION_REQUIRED",
"INBOX_AI_UNAVAILABLE",
"INBOX_PROVIDER_UNAVAILABLE",
"INBOX_SEND_UNKNOWN"
```

- [ ] **Step 4: Add JSON Schemas, fixtures, and OpenAPI paths**

Each JSON Schema must be strict (`additionalProperties: false`), use
`schema_version: "1.0"`, and mirror the Zod fields. Add `Inbox` to OpenAPI
tags and reference only local schema files. Every App-facing operation must
use Contract headers; mutating send operations must also use
`Idempotency-Key`.

- [ ] **Step 5: Run contract tests and verify GREEN**

Run:

```bash
cd server
pnpm vitest run tests/contracts/openapi.test.ts tests/contracts/fixtures.test.ts
pnpm typecheck
```

Expected: all selected tests PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit**

```bash
git add contracts server/src/domain server/tests/contracts
git commit -m "feat(inbox): freeze unified inbox contracts"
```

---

### Task 2: Implement Inbox Ports, Repositories, and Intelligence Providers

**Files:**
- Create: `server/src/inbox/ports.ts`
- Create: `server/src/inbox/in-memory.ts`
- Create: `server/src/inbox/intelligence.ts`
- Create: `server/src/inbox/confirmation.ts`
- Create: `server/tests/unit/inbox-repositories.test.ts`
- Create: `server/tests/unit/inbox-intelligence.test.ts`
- Create: `server/tests/unit/inbox-confirmation.test.ts`

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `InboxRepository`, `InboxDraftRepository`, `InboxSender`, `InboxIntelligenceProvider`, `CheckpointStore`, `ConfirmationTokenStore`.
- Produces: `InMemoryInboxRepository`, `InMemoryInboxDraftRepository`, `FixtureInboxIntelligenceProvider`, `UnavailableInboxIntelligenceProvider`, `InMemoryConfirmationTokenStore`.

- [ ] **Step 1: Write failing repository tests**

Create `server/tests/unit/inbox-repositories.test.ts` with these behaviors:

```typescript
it("deduplicates the same provider account and message", async () => {
  const repository = new InMemoryInboxRepository();
  const first = await repository.upsert(event("message-1"));
  const second = await repository.upsert(event("message-1"));

  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect((await repository.list({ limit: 20 })).items).toHaveLength(1);
});

it("rejects a stale draft version", async () => {
  const repository = new InMemoryInboxDraftRepository();
  const draft = await repository.create(draftInput());
  await repository.update(draft.id, {
    content: "用户第一次修改",
    contentType: "text",
    expectedVersion: draft.version
  });

  await expect(repository.update(draft.id, {
    content: "过期页面修改",
    contentType: "text",
    expectedVersion: draft.version
  })).rejects.toMatchObject({ code: "INBOX_VERSION_CONFLICT" });
});
```

- [ ] **Step 2: Run repository tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-repositories.test.ts
```

Expected: FAIL because Inbox repositories do not exist.

- [ ] **Step 3: Define exact ports**

Create `server/src/inbox/ports.ts` with:

```typescript
export interface InboxRepository {
  upsert(event: InboxEvent): Promise<{ item: UnifiedInboxItem; created: boolean }>;
  get(id: string): Promise<UnifiedInboxItem | null>;
  list(input: { cursor?: string; limit: number }): Promise<{
    items: UnifiedInboxItem[];
    nextCursor: string | null;
  }>;
  saveEnrichment(id: string, enrichment: InboxSummaryResult): Promise<UnifiedInboxItem>;
  setDraftId(id: string, draftId: string): Promise<UnifiedInboxItem>;
}

export interface InboxDraftRepository {
  create(input: CreateInboxDraft): Promise<InboxDraft>;
  get(id: string): Promise<InboxDraft | null>;
  update(id: string, input: UpdateInboxDraft): Promise<InboxDraft>;
  transition(id: string, input: TransitionInboxDraft): Promise<InboxDraft>;
}

export interface InboxIntelligenceProvider {
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  summarize(input: InboxSummaryInput, options?: ProviderCallOptions): Promise<InboxSummaryResult>;
  draftReply(input: ReplyDraftInput, options?: ProviderCallOptions): Promise<ReplyDraftResult>;
}

export interface InboxSender {
  readonly provider: InboxProvider;
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  send(input: InboxSendInput, options?: ProviderCallOptions): Promise<InboxSendResult>;
}

export interface InboxSource {
  readonly provider: InboxProvider;
  readonly dataOrigin?: DataOrigin;
  health(): Promise<ProviderHealth>;
  pull(input: {
    accountId: string;
    checkpoint: string | null;
    limit: number;
  }, options?: ProviderCallOptions): Promise<{
    items: InboxEvent[];
    checkpoint: string;
  }>;
}

export interface CheckpointStore {
  get(provider: InboxProvider, accountId: string): Promise<string | null>;
  put(provider: InboxProvider, accountId: string, checkpoint: string): Promise<void>;
  statuses(): Promise<InboxSyncStatus[]>;
  recordFailure(provider: InboxProvider, accountId: string, reason: string): Promise<void>;
}

export interface ConfirmationTokenStore {
  issue(draftId: string, version: number): Promise<{
    token: string;
    expiresAt: string;
  }>;
  consume(token: string, draftId: string, version: number): Promise<boolean>;
}
```

- [ ] **Step 4: Implement in-memory repositories**

Use `Map`, `structuredClone`, stable dedupe keys, version increments, and
`AppError`. Repository methods must never expose internal mutable objects.

- [ ] **Step 5: Write and verify RED for intelligence isolation**

Test that Fixture intelligence returns deterministic summary/draft from
message content, Unavailable throws `INBOX_AI_UNAVAILABLE`, and neither input
type contains credentials or confirmation fields.

- [ ] **Step 6: Implement Fixture and Unavailable intelligence**

`FixtureInboxIntelligenceProvider` returns `dataOrigin = "mock"` and a
deterministic Chinese summary. `UnavailableInboxIntelligenceProvider` returns
`health() === "unavailable"` and throws sanitized `AppError`.

- [ ] **Step 7: Implement one-time confirmation tokens**

Use `randomBytes(32).toString("base64url")`. Bind each token to
`draftId + version`, store only its SHA-256 digest, expire after 5 minutes,
and delete it on the first consume attempt.

- [ ] **Step 8: Run unit tests and verify GREEN**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-intelligence.test.ts tests/unit/inbox-confirmation.test.ts
pnpm typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 9: Commit**

```bash
git add server/src/inbox server/tests/unit/inbox-*.test.ts
git commit -m "feat(inbox): add repositories and intelligence ports"
```

---

### Task 3: Implement the Inbox Application Service

**Files:**
- Create: `server/src/application/inbox/inbox-service.ts`
- Create: `server/tests/unit/inbox-service.test.ts`

**Interfaces:**
- Consumes: Task 2 ports and existing `Clock`, `IdGenerator`, `IdempotencyStore`.
- Produces: `InboxService.ingest`, `listItems`, `getItem`, `summarize`, `createDraft`, `getDraft`, `updateDraft`, `issueConfirmation`, `sendDraft`, `syncStatus`.

- [ ] **Step 1: Write failing service tests**

Cover these independent behaviors:

```typescript
it("ingests once and enriches a new item", async () => {
  const service = fixtureService();
  const result = await service.ingest(batch("provider-message-1"));
  const item = await service.getItem(result.itemIds[0]!);

  expect(result).toMatchObject({ accepted: 1, duplicates: 0 });
  expect(item.summary).toBeTruthy();
  expect(item.draft_id).toBeTruthy();
});

it("does not overwrite a user-edited draft when AI reruns", async () => {
  const service = fixtureService();
  const { itemIds } = await service.ingest(batch("provider-message-2"));
  const item = await service.getItem(itemIds[0]!);
  const draft = await service.getDraft(item.draft_id!);
  const edited = await service.updateDraft(draft.id, {
    content: "用户最终文本",
    contentType: "text",
    expectedVersion: draft.version
  });

  await service.createDraft(item.id);
  expect((await service.getDraft(edited.id)).content).toBe("用户最终文本");
});

it("requires confirmation before sending", async () => {
  const service = fixtureService();
  const draft = await seededDraft(service);

  await expect(service.sendDraft(draft.id, {
    expectedVersion: draft.version,
    confirmationToken: "not-issued",
    idempotencyKey: "send-key-0001"
  })).rejects.toMatchObject({ code: "INBOX_CONFIRMATION_REQUIRED" });
});
```

Also test version conflict, idempotent duplicate send, different-request
idempotency conflict, provider `unknown`, missing item/draft, and sync status.

- [ ] **Step 2: Run service tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-service.test.ts
```

Expected: FAIL because `InboxService` does not exist.

- [ ] **Step 3: Implement minimal service**

Constructor:

```typescript
export class InboxService {
  constructor(
    private readonly items: InboxRepository,
    private readonly drafts: InboxDraftRepository,
    private readonly intelligence: InboxIntelligenceProvider,
    private readonly senders: ReadonlyMap<InboxProvider, InboxSender>,
    private readonly confirmations: ConfirmationTokenStore,
    private readonly sendIdempotency: IdempotencyStore<InboxSendResult>,
    private readonly checkpoints: CheckpointStore,
    private readonly clock: Clock,
    private readonly ids: IdGenerator
  ) {}
}
```

`ingest` must upsert, persist checkpoint, and enrich only newly created items.
`createDraft` returns an existing `edited`, `sending`, or terminal draft
without regenerating it. `sendDraft` consumes confirmation before invoking a
sender, transitions to `sending`, and records `sent`, `failed`, or `unknown`.
Hash the draft ID, version, provider, target, and content for idempotency.

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-service.test.ts
pnpm typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/application/inbox server/tests/unit/inbox-service.test.ts
git commit -m "feat(inbox): implement summary draft and confirmed send flow"
```

---

### Task 4: Expose Unified Inbox HTTP APIs

**Files:**
- Create: `server/src/api/inbox-routes.ts`
- Modify: `server/src/api/create-server.ts`
- Create: `server/tests/integration/inbox-http.test.ts`
- Modify: `server/tests/integration/http-contract.test.ts`

**Interfaces:**
- Consumes: `InboxService` and Task 1 schemas.
- Produces: all `/v1/inbox/**` endpoints defined in OpenAPI.

- [ ] **Step 1: Write failing HTTP integration tests**

Test the complete Fixture path:

```typescript
it("ingests, summarizes, edits, confirms, and sends a draft", async () => {
  const ingest = await server.inject({
    method: "POST",
    url: "/v1/inbox/events:batch",
    headers: baseHeaders("req_inbox_ingest"),
    payload: eventBatch("req_inbox_ingest")
  });
  expect(ingest.statusCode).toBe(202);

  const itemId = ingest.json().item_ids[0];
  const item = await server.inject({
    method: "GET",
    url: `/v1/inbox/items/${itemId}`,
    headers: baseHeaders("req_inbox_get")
  });
  const draftId = item.json().draft_id;
  const draft = await server.inject({
    method: "GET",
    url: `/v1/inbox/drafts/${draftId}`,
    headers: baseHeaders("req_inbox_draft")
  });

  const edited = await server.inject({
    method: "PATCH",
    url: `/v1/inbox/drafts/${draftId}`,
    headers: baseHeaders("req_inbox_edit"),
    payload: draftPatch("req_inbox_edit", draft.json().version)
  });
  expect(edited.statusCode).toBe(200);

  const confirmation = await server.inject({
    method: "POST",
    url: `/v1/inbox/drafts/${draftId}/confirmation`,
    headers: baseHeaders("req_inbox_confirm")
  });
  const sent = await server.inject({
    method: "POST",
    url: `/v1/inbox/drafts/${draftId}:send`,
    headers: {
      ...baseHeaders("req_inbox_send"),
      "idempotency-key": "inbox-send-key-0001"
    },
    payload: sendPayload(
      "req_inbox_send",
      edited.json().version,
      confirmation.json().confirmation_token
    )
  });

  expect(sent.statusCode).toBe(200);
  expect(sent.json().status).toBe("sent");
});
```

Add explicit 409 stale version, 403 missing/used confirmation, 404 item/draft,
and 503 unavailable provider cases.

- [ ] **Step 2: Run HTTP tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/integration/inbox-http.test.ts
```

Expected: FAIL with route-not-found responses.

- [ ] **Step 3: Register isolated Inbox routes**

`registerInboxRoutes(server, dependencies)` owns route parsing and delegates
to `InboxService`. Reuse exported Contract header and request-context helpers
from `create-server.ts`; do not duplicate token or version validation.
Extend `GraphKind` with `"inbox"` and add `inboxOrigin`,
`demoInboxOrigin`, `inbox`, and `demoInbox` to `ServerDependencies`.

- [ ] **Step 4: Run HTTP and existing integration tests**

Run:

```bash
cd server
pnpm vitest run tests/integration/inbox-http.test.ts tests/integration/http-contract.test.ts tests/integration/server.test.ts
pnpm typecheck
```

Expected: all selected tests PASS; existing Rest/Handoff behavior remains
unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/src/api server/tests/integration
git commit -m "feat(inbox): expose unified inbox APIs"
```

---

### Task 5: Implement Connector Host and Real Provider Adapters

**Files:**
- Create: `server/src/inbox/connector-host.ts`
- Create: `server/src/inbox/providers/command-runner.ts`
- Create: `server/src/inbox/providers/lark-cli-adapter.ts`
- Create: `server/src/inbox/providers/dingtalk-dws-adapter.ts`
- Create: `server/src/inbox/providers/outlook-graph-adapter.ts`
- Create: `server/src/inbox/providers/qq-mail-adapter.ts`
- Create: `server/src/inbox/providers/provider-fixtures.ts`
- Create: `server/tests/provider-contracts/inbox-provider.contract.ts`
- Create: `server/tests/provider-contracts/inbox-provider-kit.test.ts`
- Create: `server/tests/unit/connector-host.test.ts`
- Create: `server/tests/unit/inbox-cli-adapters.test.ts`
- Create: `server/tests/unit/outlook-graph-adapter.test.ts`
- Create: `server/tests/unit/qq-mail-adapter.test.ts`
- Modify: `server/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `InboxSource`, `InboxSender`, `CheckpointStore`, `InboxService`.
- Produces: `ConnectorHost`, `LarkCliAdapter`, `DingTalkDwsAdapter`, `OutlookGraphAdapter`, `QqMailAdapter`, Fixture and Unavailable adapters.

- [ ] **Step 1: Add dependencies with an explicit reason**

Run:

```bash
pnpm --dir server add imapflow nodemailer
pnpm --dir server add -D @types/nodemailer
```

`imapflow` is required for QQ IMAP incremental reads and UID checkpoints;
`nodemailer` is required for authenticated SMTP/MIME reply delivery. No new
dependency is needed for CLIs or Graph because Node provides `execFile` and
`fetch`.

- [ ] **Step 2: Write the provider contract tests**

The reusable contract must verify:

```typescript
export function defineInboxProviderContract(
  name: string,
  harness: InboxProviderHarness
): void {
  describe(name, () => {
    it("returns normalized events without credentials", async () => {
      const events = await harness.source.pull({
        accountId: harness.accountId,
        checkpoint: null,
        limit: 20
      });
      expect(events.items.every(isNormalizedInboxEvent)).toBe(true);
      expect(JSON.stringify(events)).not.toMatch(/token|secret|auth_code/i);
    });

    it("returns a unified send result", async () => {
      const result = await harness.sender.send(harness.sendInput);
      expect(["sent", "failed", "unknown"]).toContain(result.status);
    });
  });
}
```

- [ ] **Step 3: Run provider tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/provider-contracts/inbox-provider-kit.test.ts
```

Expected: FAIL because adapters and provider contracts do not exist.

- [ ] **Step 4: Implement a safe command runner and CLI adapters**

Use `execFile`, never `exec` or a shell. Accept executable path and argument
arrays separately. Parse only JSON/NDJSON from stdout and sanitize stderr to
provider/error category without message bodies.

The Lark adapter invokes `lark-cli` under an already authenticated user
profile and sends with `im +messages-send --as user`. The DingTalk adapter
uses `dws chat message list-all` for pull and `dws chat message send` for
confirmed delivery. Command construction is covered by unit tests and no
real command runs in CI.

- [ ] **Step 5: Implement Outlook Graph adapter**

Inject `fetch` and an access-token resolver. Pull with a stored delta link or
`/me/mailFolders/inbox/messages/delta`; send replies with
`POST /me/messages/{id}/reply`. Map Graph throttling to `degraded`, network
timeouts to `unknown`, and never include the bearer token in errors.

- [ ] **Step 6: Implement QQ IMAP/SMTP adapter**

Use `ImapFlow` with TLS and UID checkpoints; use `nodemailer` with
`smtp.qq.com`, TLS, and the authorization code supplied by a credential
resolver. Replies must set `inReplyTo`, `references`, and `Re:` subject.
SMTP timeout returns `unknown` and the adapter does not retry.

- [ ] **Step 7: Implement Connector Host**

`ConnectorHost.runOnce()` iterates enabled sources independently, loads each
checkpoint, pulls at most 100 events, calls `InboxService.ingest`, and saves
the returned checkpoint only after successful ingestion. One provider
failure updates only that provider's sync status. `start()` uses an
unref'ed interval and rejects double start; `stop()` clears it.

- [ ] **Step 8: Run provider and connector tests**

Run:

```bash
cd server
pnpm vitest run tests/provider-contracts/inbox-provider-kit.test.ts tests/unit/connector-host.test.ts tests/unit/inbox-cli-adapters.test.ts tests/unit/outlook-graph-adapter.test.ts tests/unit/qq-mail-adapter.test.ts
pnpm typecheck
```

Expected: all selected tests PASS without network or installed CLIs.

- [ ] **Step 9: Commit**

```bash
git add server/package.json pnpm-lock.yaml server/src/inbox server/tests/provider-contracts server/tests/unit
git commit -m "feat(inbox): add connector host and provider adapters"
```

---

### Task 6: Wire Demo and Real Graphs Without Credential Leakage

**Files:**
- Modify: `.env.example`
- Modify: `server/src/config.ts`
- Modify: `server/src/composition.ts`
- Modify: `server/src/bootstrap.ts`
- Modify: `server/src/api/create-server.ts`
- Modify: `server/tests/unit/config.test.ts`
- Modify: `server/tests/unit/composition.test.ts`
- Modify: `server/tests/integration/server.test.ts`
- Create: `server/tests/vertical-slice/unified-inbox-vertical-slice.test.ts`
- Modify: `server/README.md`
- Modify: `README.md`
- Modify: `plan.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: a Fixture demo graph, an Unavailable default graph, optional real provider graphs, and managed Connector Host lifecycle.

- [ ] **Step 1: Write failing composition and vertical-slice tests**

Verify:

```typescript
it("keeps the default real inbox graph unavailable and the demo graph mock", () => {
  const dependencies = buildServerDependencies(config());
  expect(dependencies.inboxOrigin).toBe("mock");
  expect(dependencies.demoInboxOrigin).toBe("mock");
});

it("runs the complete demo inbox flow without external credentials", async () => {
  const server = createServer(buildServerDependencies(demoConfig()));
  await server.ready();
  const result = await runFixtureInboxFlow(server);
  expect(result).toMatchObject({
    summaryAvailable: true,
    userEditPreserved: true,
    sentAfterConfirmation: true
  });
  await server.close();
});
```

- [ ] **Step 2: Run composition tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/config.test.ts tests/unit/composition.test.ts tests/vertical-slice/unified-inbox-vertical-slice.test.ts
```

Expected: FAIL because Inbox dependencies and configuration are not wired.

- [ ] **Step 3: Add safe configuration**

Add non-secret selectors and optional credential environment variables:

```text
INBOX_POLL_INTERVAL_MS=30000
LARK_CLI_PATH=
DWS_CLI_PATH=
OUTLOOK_ACCOUNT_ID=
OUTLOOK_ACCESS_TOKEN=
QQ_EMAIL_ADDRESS=
QQ_EMAIL_AUTH_CODE=
```

`.env.example` contains only empty placeholders. Config validation never
echoes provided secret values.

- [ ] **Step 4: Compose separate normal and demo graphs**

The normal graph uses configured Real adapters and Unavailable adapters for
missing configuration. The demo graph always uses Fixture sources, Fixture
intelligence, an in-memory sender, and separate repositories/stores. Never
share confirmation or idempotency stores between normal and demo graphs.
Expose provider health keys: `inbox_intelligence`, `feishu`, `dingtalk`,
`outlook`, `qq_mail`, and `inbox_connector`.

- [ ] **Step 5: Manage Connector Host lifecycle**

Start the Connector Host after Fastify begins listening. Stop it before
closing Fastify on SIGINT/SIGTERM. Tests use `runOnce()` and do not leave
timers or child processes alive.

- [ ] **Step 6: Update documentation truthfully**

Document Fixture/Unavailable versus Real capability. Mark real account smoke
tests as requiring user-provided credentials and tenant/admin approval.
Change `plan.md` status to implemented for the verified Fixture vertical
slice while keeping each real provider verification item explicit.

- [ ] **Step 7: Run targeted and full verification**

Run:

```bash
cd server
pnpm typecheck
pnpm test
pnpm build
```

Expected: all tests PASS, TypeScript reports no errors, and build exits 0.

- [ ] **Step 8: Scan for secrets and forbidden changes**

Run:

```bash
git diff --check
git diff --name-only
rg -n "(access[_-]?token|refresh[_-]?token|auth[_-]?code|api[_-]?key).*[=:].*[A-Za-z0-9]{16}" --glob '!pnpm-lock.yaml' .
```

Expected: no whitespace errors, no Apple/Xcode changes from this feature,
and no committed secret values.

- [ ] **Step 9: Commit**

```bash
git add .env.example README.md plan.md server
git commit -m "feat(inbox): wire unified inbox demo vertical slice"
```

---

## Deferred Credential-Gated Verification

These checks require external state and cannot be represented as passing CI:

- Feishu tenant app approval, user OAuth scopes, event subscription, chat
  history visibility, and user-identity send.
- DingTalk DWS co-creation access, enterprise admin approval, current-user
  message list, and current-user send.
- Outlook delegated `Mail.Read`/delta and `Mail.Send`.
- QQ Mail IMAP/SMTP enablement and authorization code.

Until each check is performed, health must remain `unavailable` or
`degraded`; documentation and UI must not claim that provider is connected.
