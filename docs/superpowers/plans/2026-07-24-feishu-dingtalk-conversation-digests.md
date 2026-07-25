# Feishu and DingTalk Conversation Digests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the W2/P3 Unified Inbox backend for real Feishu and DingTalk messages: aggregate each group conversation's unviewed messages into one evolving card, summarize and draft with StepFun `step-3.7-flash`, preserve source-session metadata, allow user editing, and send only after explicit confirmation.

**Architecture:** The local Connector Host reads official CLI output and normalizes it into safe Inbox events plus private participant bindings. The Inbox repository deduplicates raw messages, keeps one open group digest per provider/account/conversation, seals it on an exact-revision acknowledgement or at the 24-hour/1000-message boundary, and exposes only public digest fields. StepFun sees synthetic participant references rather than provider user IDs. `InboxService` validates StepFun targets, resolves them through the private participant directory, and invokes a provider sender only after the existing version, confirmation-token, and idempotency checks succeed.

**Tech Stack:** Node.js 20, TypeScript 5.9, Fastify 5, Zod 4, Vitest 3, OpenAPI 3.1, native `fetch`, official `lark-cli`, official DingTalk `dws`, pnpm 9.

## Global Constraints

- Work only in the W2/P3 backend, contracts, tests, and runbook. Do not modify SwiftUI, Xcode project files, signing, entitlements, or the unmerged frontend branch.
- Implement Feishu and DingTalk only. Keep Outlook and QQ Mail adapters compiling, but do not extend or externally test them in this milestone.
- Keep the existing Anthropic dependency and `server/src/agent/claude-llm.ts` for other Hush features. Unified Inbox code must not import or instantiate Anthropic.
- Use `INBOX_STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1`, `INBOX_STEPFUN_MODEL=step-3.7-flash`, and `INBOX_STEPFUN_API_KEY`. Never commit the real key.
- Send real message text to StepFun only for summary/draft generation. Never send CLI output envelopes, credentials, access tokens, account IDs, conversation IDs, provider message IDs, or provider participant IDs.
- Use synthetic `participant_ref` values in StepFun inputs and public `reply_targets`. Validate every returned target against the participants included in that request.
- Group cards do not expose a specific sender. `sender` is `null`; `conversation_name` identifies the source session. Display a person's name only inside a validated `reply_target`.
- Aggregate messages received since the last acknowledged digest revision. Seal an open group digest when the exact revision is acknowledged, when it reaches 1000 source messages, or when its window reaches 24 hours. The next message creates a new digest.
- The 1000-message rule is a storage boundary, not a single-model-call size. StepFun input must be chunked and reduced.
- Keep provider participant IDs only in the private participant directory and resolved send input. Do not serialize them in app responses, fixtures, logs, or StepFun prompts.
- Do not print real message bodies, real account identifiers, real conversation identifiers, authorization material, or StepFun response bodies in logs or smoke-test output.
- Preserve the existing send safety gate: exact draft version, one-time confirmation token, `Idempotency-Key`, and no automatic retry after an ambiguous send timeout.
- Do not push until real Feishu and DingTalk read/summary/draft/acknowledge/send checks have passed on their designated external computers.

---

### Task 1: Freeze the Conversation Digest Contract

**Files:**
- Modify: `server/src/domain/contracts.ts`
- Modify: `contracts/schemas/inbox-event-batch.schema.json`
- Modify: `contracts/schemas/inbox-item.schema.json`
- Create: `contracts/schemas/inbox-acknowledge.schema.json`
- Modify: `contracts/schemas/inbox-send.schema.json`
- Modify: `contracts/fixtures/inbox-event-batch-demo.json`
- Modify: `contracts/fixtures/inbox-item-enriched-demo.json`
- Create: `contracts/fixtures/inbox-group-digest-demo.json`
- Modify: `contracts/openapi.yaml`
- Modify: `server/tests/contracts/fixtures.test.ts`
- Modify: `server/tests/contracts/openapi.test.ts`

**Interfaces:**
- Add `InboxConversationType = "direct" | "group"`.
- Add `InboxItemKind = "message" | "conversation_digest"`.
- Add public `InboxReplyTarget { target_id, display_name, reason }`.
- Add `InboxAcknowledgeRequest { schema_version, request_id, expected_revision }`.
- Extend normalized events with `conversation_type`, `conversation_name`, and nullable synthetic `sender_ref`.
- Extend public items with `item_kind`, `revision`, `message_count`, digest-window timestamps, acknowledgement state, and `reply_targets`.

- [ ] **Step 1: Add failing Zod and fixture tests**

In `server/tests/contracts/fixtures.test.ts`, add assertions that:

```typescript
const digest = unifiedInboxItemSchema.parse(
  readFixture("inbox-group-digest-demo.json")
);

expect(digest).toMatchObject({
  provider: "dingtalk",
  conversation_type: "group",
  item_kind: "conversation_digest",
  sender: null,
  revision: 3,
  message_count: 18
});
expect(digest.conversation_name).toBe("产品讨论组");
expect(digest.reply_targets).toEqual([
  {
    target_id: "participant_demo_1",
    display_name: "王同学",
    reason: "需要确认接口交付时间"
  }
]);
expect("sender_provider_id" in digest).toBe(false);
```

Also parse this acknowledge payload with the new Zod schema:

```typescript
expect(
  inboxAcknowledgeRequestSchema.parse({
    schema_version: "1.0",
    request_id: "req_ack_demo",
    expected_revision: 3
  })
).toMatchObject({ expected_revision: 3 });
```

In `server/tests/contracts/openapi.test.ts`, assert that
`POST /v1/inbox/items/{itemId}:acknowledge` exists and references
`inbox-acknowledge.schema.json`.

- [ ] **Step 2: Run the contract tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
```

Expected: FAIL because the digest fixture, acknowledge schema, and operation do not exist.

- [ ] **Step 3: Add the Zod contract fields**

Define these schemas in `server/src/domain/contracts.ts`:

```typescript
export const inboxConversationTypeSchema = z.enum(["direct", "group"]);
export const inboxItemKindSchema = z.enum([
  "message",
  "conversation_digest"
]);

export const inboxReplyTargetSchema = z
  .object({
    target_id: z.string().regex(/^participant_[a-zA-Z0-9_-]{8,64}$/),
    display_name: z.string().min(1).max(120),
    reason: z.string().min(1).max(500)
  })
  .strict();

export const inboxAcknowledgeRequestSchema = z
  .object({
    schema_version: schemaVersion,
    request_id: requestId,
    expected_revision: z.number().int().min(1)
  })
  .strict();
```

Extend `inboxEventSchema` with:

```typescript
conversation_type: inboxConversationTypeSchema,
conversation_name: z.string().min(1).max(200),
sender_ref: z
  .string()
  .regex(/^participant_[a-zA-Z0-9_-]{8,64}$/)
  .nullable()
```

Keep source-event `sender` and `content` non-null because connector events
carry raw messages internally. In `unifiedInboxItemSchema.extend`, explicitly
override the three public fields:

```typescript
sender: z.string().min(1).max(120).nullable(),
sender_ref: z
  .string()
  .regex(/^participant_[a-zA-Z0-9_-]{8,64}$/)
  .nullable(),
content: z.string().min(1).nullable()
```

Extend `inboxSummaryResultSchema` with:

```typescript
reply_targets: z.array(inboxReplyTargetSchema).max(20)
```

Extend `unifiedInboxItemSchema` with:

```typescript
item_kind: inboxItemKindSchema,
revision: z.number().int().min(1),
message_count: z.number().int().min(1).max(1_000),
window_started_at: z.iso.datetime({ offset: true }),
window_ended_at: z.iso.datetime({ offset: true }),
sealed_at: z.iso.datetime({ offset: true }).nullable(),
acknowledged_at: z.iso.datetime({ offset: true }).nullable(),
reply_targets: z.array(inboxReplyTargetSchema).max(20)
```

For a group digest, public `content` must be `null`, `sender` must be `null`,
and `sender_ref` must be `null`. Add a Zod `superRefine` check so invalid
group responses cannot leave the service.

- [ ] **Step 4: Mirror the contract in JSON Schema, fixtures, and OpenAPI**

Keep every JSON schema strict with `additionalProperties: false`. Use only
synthetic demo identifiers such as `participant_demo_1`; do not copy external
test account or chat IDs into fixtures.

Add this OpenAPI operation:

```yaml
/v1/inbox/items/{itemId}:acknowledge:
  post:
    tags: [Inbox]
    operationId: acknowledgeInboxItem
    parameters:
      - $ref: "#/components/parameters/RequestId"
      - $ref: "#/components/parameters/AppToken"
      - name: itemId
        in: path
        required: true
        schema:
          type: string
    requestBody:
      required: true
      content:
        application/json:
          schema:
            $ref: "./schemas/inbox-acknowledge.schema.json"
    responses:
      "200":
        description: Exact digest revision acknowledged
        content:
          application/json:
            schema:
              $ref: "./schemas/inbox-item.schema.json"
      "409":
        $ref: "#/components/responses/ErrorResponse"
```

- [ ] **Step 5: Run contract verification and commit**

Run:

```bash
cd server
pnpm vitest run tests/contracts/fixtures.test.ts tests/contracts/openapi.test.ts
pnpm typecheck
```

Expected: selected tests PASS and TypeScript reports no errors.

Commit:

```bash
git add contracts server/src/domain/contracts.ts server/tests/contracts
git commit -m "feat(inbox): define conversation digest contracts"
```

---

### Task 2: Add Private Participant Bindings and Group Aggregation

**Files:**
- Modify: `server/src/inbox/ports.ts`
- Modify: `server/src/inbox/in-memory.ts`
- Modify: `server/tests/unit/inbox-repositories.test.ts`
- Create: `server/tests/unit/inbox-participants.test.ts`

**Interfaces:**
- Add private `InboxParticipantBinding`.
- Add `InboxParticipantDirectory.bindAll()` and `resolve()`.
- Change `InboxSource.pull()` to return `participantBindings` beside safe events.
- Change `InboxRepository.upsert()` to return `created`, `changed`, and the current public item.
- Add `InboxRepository.sourceMessages()`, revision-aware `saveEnrichment()`, and `acknowledge()`.

- [ ] **Step 1: Write failing aggregation tests**

Add repository tests for all of these cases:

1. Two group events with the same provider/account/conversation return the same
   item ID, increment `revision` and `message_count`, keep `sender/content` null,
   and expose the latest `window_ended_at`.
2. Re-ingesting the same provider message ID is a duplicate and does not
   increment the revision or count.
3. Acknowledging the exact revision sets `acknowledged_at` and `sealed_at`; the
   next message creates a different item ID.
4. Acknowledging a stale revision rejects with `INBOX_VERSION_CONFLICT`.
5. Message 1001 creates a new digest after the first reaches 1000.
6. A message at or after `window_started_at + 24h` creates a new digest.
7. Direct messages remain independent `item_kind: "message"` items.

Use a loop for the storage boundary:

```typescript
for (let index = 1; index <= 1_000; index += 1) {
  await repository.upsert(
    groupEvent({
      messageId: `group-message-${index}`,
      receivedAt: new Date(
        Date.parse("2026-07-24T00:00:00.000Z") + index * 1_000
      ).toISOString()
    }),
    "2026-07-24T01:00:00.000Z"
  );
}

const overflow = await repository.upsert(
  groupEvent({
    messageId: "group-message-1001",
    receivedAt: "2026-07-24T01:00:01.000Z"
  }),
  "2026-07-24T01:00:01.000Z"
);
expect(overflow.created).toBe(true);
expect(overflow.item.message_count).toBe(1);
```

- [ ] **Step 2: Write failing participant privacy tests**

Create `server/tests/unit/inbox-participants.test.ts` and verify:

```typescript
await directory.bindAll([
  {
    provider: "feishu",
    accountId: "account-demo",
    conversationId: "conversation-demo",
    participantRef: "participant_12345678",
    providerParticipantId: "ou_private_value",
    displayName: "王同学"
  }
]);

await expect(
  directory.resolve({
    provider: "feishu",
    accountId: "account-demo",
    conversationId: "conversation-demo",
    participantRefs: ["participant_12345678"]
  })
).resolves.toEqual([
  {
    participantRef: "participant_12345678",
    providerParticipantId: "ou_private_value",
    displayName: "王同学"
  }
]);
```

Also assert that resolving an unknown or cross-conversation reference rejects
with `INBOX_VERSION_CONFLICT`.

- [ ] **Step 3: Run repository tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
```

Expected: FAIL because the repository has no group window or participant
directory.

- [ ] **Step 4: Implement the private types and directory**

Add these internal-only types to `server/src/inbox/ports.ts`:

```typescript
export interface InboxParticipantBinding {
  provider: InboxProvider;
  accountId: string;
  conversationId: string;
  participantRef: string;
  providerParticipantId: string;
  displayName: string;
}

export interface ResolvedInboxParticipant {
  participantRef: string;
  providerParticipantId: string;
  displayName: string;
}

export interface InboxParticipantDirectory {
  bindAll(bindings: InboxParticipantBinding[]): Promise<void>;
  resolve(input: {
    provider: InboxProvider;
    accountId: string;
    conversationId: string;
    participantRefs: string[];
  }): Promise<ResolvedInboxParticipant[]>;
}

export interface InboxSourceMessage {
  providerMessageId: string;
  senderRef: string | null;
  senderDisplayName: string | null;
  content: string;
  receivedAt: string;
}
```

Key bindings by
`provider + accountId + conversationId + participantRef`. Never add a method
that lists provider participant IDs.

- [ ] **Step 5: Implement repository aggregation**

Keep raw source messages in a private map keyed by Inbox item ID. Keep a
separate open-digest index keyed by
`provider + account_id + conversation_id`. Before appending, seal and remove
the index if either condition is true:

```typescript
const reachesMessageLimit = current.message_count >= 1_000;
const reachesTimeLimit =
  Date.parse(event.received_at) -
    Date.parse(current.window_started_at) >=
  24 * 60 * 60 * 1_000;
```

On an accepted group append:

- increment `revision` and `message_count`;
- update `provider_message_id`, `received_at`, and `window_ended_at`;
- clear summary fields, `reply_targets`, and `draft_id`;
- set `sync_status` to `pending`;
- preserve `item_kind: "conversation_digest"`, `sender: null`,
  `sender_ref: null`, and `content: null`.

On exact-revision acknowledge, set both timestamps and remove the open index.
On a revision mismatch, throw `INBOX_VERSION_CONFLICT` with only
`current_revision` in details.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-repositories.test.ts tests/unit/inbox-participants.test.ts
pnpm typecheck
```

Expected: selected tests PASS.

Commit:

```bash
git add server/src/inbox/ports.ts server/src/inbox/in-memory.ts server/tests/unit/inbox-repositories.test.ts server/tests/unit/inbox-participants.test.ts
git commit -m "feat(inbox): aggregate unviewed group conversations"
```

---

### Task 3: Replace Unified Inbox Intelligence with StepFun

**Files:**
- Modify: `server/src/inbox/intelligence.ts`
- Modify: `server/src/inbox/ports.ts`
- Modify: `server/tests/unit/inbox-intelligence.test.ts`

**Interfaces:**
- Rename `RealInboxIntelligenceProvider` to
  `StepFunInboxIntelligenceProvider`.
- Add injectable `StepFunTransport`.
- Change summary input from one flattened message to conversation metadata,
  allowed participants, and source messages.
- Produce `reply_targets` in the validated summary result.

- [ ] **Step 1: Write failing StepFun transport tests**

Use a recording transport rather than real network access. Verify:

- endpoint is exactly
  `https://api.stepfun.com/step_plan/v1/chat/completions`;
- model is exactly `step-3.7-flash`;
- authorization is passed as a bearer header but absent from the serialized
  prompt;
- prompt contains `conversation_name`, display names, synthetic
  `participant_ref`, content, and timestamps;
- prompt does not contain account, conversation, provider message, or raw
  provider participant IDs;
- a target not present in `allowedParticipants` is rejected as
  `INBOX_AI_UNAVAILABLE` with reason `invalid_output`;
- 1000 short messages result in multiple map calls and one reduce call;
- no individual request exceeds `100` messages or `60_000` serialized
  characters;
- malformed JSON and non-2xx responses are sanitized.

The multi-chunk assertion must be:

```typescript
expect(transport.requests.length).toBeGreaterThan(1);
expect(
  transport.requests.every(
    (request) =>
      request.messageCount <= 100 &&
      request.prompt.length <= 60_000
  )
).toBe(true);
```

- [ ] **Step 2: Run the intelligence tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-intelligence.test.ts
```

Expected: FAIL because Unified Inbox still uses the Anthropic SDK and accepts a
single message.

- [ ] **Step 3: Implement the native-fetch StepFun transport**

Use this configuration shape:

```typescript
export interface StepFunInboxConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxMessagesPerChunk: number;
  maxPromptCharacters: number;
}

export interface StepFunTransport {
  completeJson(input: {
    endpoint: string;
    apiKey: string;
    model: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}
```

The fetch transport must call:

```typescript
await fetch(`${baseUrl.replace(/\/+$/u, "")}/chat/completions`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }]
  }),
  signal
});
```

Parse only `choices[0].message.content`. Strip an optional JSON code fence and
validate with Zod. Never attach response text or the caught error message to
`AppError.details`.

- [ ] **Step 4: Implement map/reduce summary and target validation**

Split on both boundaries: at most 100 messages and at most 60,000 prompt
characters. Each map call returns summary facts with target references. The
reduce call receives only map outputs plus the same allowed participant list,
not the original messages.

The system prompt must require `reply_targets: []` by default. A participant
may be selected only when the source conversation contains a concrete request
for that person to answer, decide, approve, deliver, or take over work. Merely
speaking, being mentioned socially, or appearing frequently is not sufficient.
Every selected target must include a short evidence-based `reason`.

For every final target:

```typescript
const allowedRefs = new Set(
  input.allowedParticipants.map((participant) => participant.participantRef)
);
for (const target of result.reply_targets) {
  if (!allowedRefs.has(target.target_id)) {
    throw invalidStepFunOutput();
  }
}
```

Deduplicate target IDs in first-seen order and cap the result at 20. The draft
prompt receives the validated summary and target display names, but no provider
IDs or sending capability.

- [ ] **Step 5: Keep fixture and unavailable implementations contract-correct**

The fixture implementation must summarize group input without selecting a
sender and must return `reply_targets: []` unless the fixture input explicitly
contains a participant whose display name is referenced by a deterministic
test message.

- [ ] **Step 6: Verify no Unified Inbox Anthropic dependency and commit**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-intelligence.test.ts
pnpm typecheck
rg -n "Anthropic|CLAUDE_" src/inbox src/application/inbox
```

Expected: tests PASS, typecheck succeeds, and `rg` returns no matches. The
Anthropic package and `src/agent/claude-llm.ts` remain unchanged.

Commit:

```bash
git add server/src/inbox/intelligence.ts server/src/inbox/ports.ts server/tests/unit/inbox-intelligence.test.ts
git commit -m "feat(inbox): generate digests with StepFun"
```

---

### Task 4: Orchestrate Revision-Safe Enrichment, Acknowledgement, and Sending

**Files:**
- Modify: `server/src/application/inbox/inbox-service.ts`
- Modify: `server/src/api/inbox-routes.ts`
- Modify: `server/src/inbox/ports.ts`
- Modify: `server/tests/unit/inbox-service.test.ts`
- Modify: `server/tests/integration/inbox-http.test.ts`
- Modify: `server/tests/vertical-slice/unified-inbox-vertical-slice.test.ts`

**Interfaces:**
- Change `InboxService.ingest(batch, participantBindings?)`.
- Add `InboxService.acknowledge(itemId, expectedRevision)`.
- Add private participant resolution before provider send.
- Pass resolved provider participants to `InboxSender.send()` without exposing
  them in API results.

- [ ] **Step 1: Write failing service tests**

Cover these behaviors:

1. A batch containing multiple messages from one group calls StepFun once for
   the changed digest, not once per raw message.
2. A duplicate-only batch does not call StepFun.
3. `needs_reply: false` leaves `draft_id` null.
4. `needs_reply: true` creates an editable AI draft.
5. A group append that changes the revision prevents an older enrichment from
   overwriting the new digest.
6. `acknowledge(id, revision)` seals the item; stale revision returns 409.
7. Sending a group draft resolves only the validated `reply_targets`.
8. An unknown target refuses to send before consuming the confirmation token
   or claiming the draft.
9. Direct-message sending keeps the existing confirmation and idempotency
   behavior.

Record resolved mentions in the fake sender:

```typescript
expect(sender.inputs[0]?.mentions).toEqual([
  {
    participantRef: "participant_12345678",
    providerParticipantId: "ou_private_value",
    displayName: "王同学"
  }
]);
```

- [ ] **Step 2: Add failing HTTP tests**

In `server/tests/integration/inbox-http.test.ts`:

- post three group events and verify one returned group card with
  `message_count: 3`;
- assert `sender`, `sender_ref`, and `content` are null;
- acknowledge the returned exact revision and get 200;
- repeat the acknowledgement with the old revision and get 409;
- post another message and verify a new item ID;
- fetch both items and confirm no property contains the fake raw provider
  participant ID.

- [ ] **Step 3: Run service and HTTP tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-service.test.ts tests/integration/inbox-http.test.ts tests/vertical-slice/unified-inbox-vertical-slice.test.ts
```

Expected: FAIL because service ingestion is still per-message and there is no
acknowledgement endpoint or participant resolution.

- [ ] **Step 4: Make ingestion revision-aware**

During one batch:

1. bind private participant bindings;
2. upsert every event;
3. collect distinct changed item IDs;
4. capture each current revision;
5. summarize each item from `sourceMessages(itemId)`;
6. save enrichment only if the revision still matches;
7. create a draft only when `needs_reply` is true.

Do not swallow all errors. Continue to preserve the raw item when AI is
unavailable, but set `sync_status: "failed"` through a repository method and
record only a sanitized reason.

- [ ] **Step 5: Add the acknowledge route**

Register:

```typescript
server.post<{
  Params: { itemId: string };
}>("/v1/inbox/items/:itemId(^[^:]+)::acknowledge", async (request, reply) => {
  const context = helpers.context(request, reply, true, "app");
  const input = inboxAcknowledgeRequestSchema.parse(request.body);
  helpers.assertBodyRequestId(input.request_id, context.requestId);
  return context.inbox.acknowledge(
    request.params.itemId,
    input.expected_revision
  );
});
```

Match the existing Fastify escaped-colon convention used by the send route.

- [ ] **Step 6: Resolve mention targets only after confirmation validation**

Include target IDs in the idempotency request hash. Inside the idempotent
`create` callback:

1. resolve targets against provider/account/conversation;
2. consume the one-time confirmation;
3. claim the draft for send;
4. pass resolved participants to `InboxSender.send()`.

Never pass the participant directory, confirmation token, or sender object to
StepFun.

- [ ] **Step 7: Run the focused suites and commit**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-service.test.ts tests/integration/inbox-http.test.ts tests/vertical-slice/unified-inbox-vertical-slice.test.ts
pnpm typecheck
```

Expected: selected tests PASS.

Commit:

```bash
git add server/src/application/inbox/inbox-service.ts server/src/api/inbox-routes.ts server/src/inbox/ports.ts server/tests/unit/inbox-service.test.ts server/tests/integration/inbox-http.test.ts server/tests/vertical-slice/unified-inbox-vertical-slice.test.ts
git commit -m "feat(inbox): orchestrate digest acknowledgement and reply targets"
```

---

### Task 5: Normalize Real Feishu Conversation Metadata and Mentions

**Files:**
- Modify: `server/src/inbox/providers/lark-cli-adapter.ts`
- Modify: `server/src/inbox/providers/provider-fixtures.ts`
- Modify: `server/tests/unit/inbox-cli-adapters.test.ts`
- Modify: `server/tests/provider-contracts/inbox-provider.contract.ts`
- Modify: `server/tests/provider-contracts/inbox-provider-kit.test.ts`

**Interfaces:**
- Parse official `im +messages-search` fields `chat_type`, `chat_name`,
  `chat_partner`, sender identity, and mentions.
- Return a synthetic sender reference plus a private binding.
- Render validated group mentions using Feishu text markup.

- [ ] **Step 1: Add failing Feishu adapter tests**

Use a sanitized official-shaped search result containing:

```typescript
{
  message_id: "feishu-message-demo",
  chat_id: "feishu-chat-demo",
  chat_type: "group",
  chat_name: "产品讨论组",
  sender: {
    id: "ou_private_feishu",
    name: "王同学"
  },
  content: "请确认接口交付时间",
  create_time: "1784854800000"
}
```

Assert:

- event `conversation_type` is `group`;
- event `conversation_name` is `产品讨论组`;
- event `sender_ref` starts with `participant_` and is not
  `ou_private_feishu`;
- the private binding contains `ou_private_feishu`;
- a group send with that resolved participant renders
  `<at user_id="ou_private_feishu">王同学</at>`;
- a send with no target contains no `<at` markup;
- public serialized events and errors never contain the raw ID.

- [ ] **Step 2: Run the adapter tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-cli-adapters.test.ts tests/provider-contracts/inbox-provider-kit.test.ts
```

Expected: FAIL because conversation metadata and bindings are ignored.

- [ ] **Step 3: Normalize Feishu search results**

Generate a deterministic synthetic reference with SHA-256 over a
provider-scoped tuple and expose only its truncated digest:

```typescript
const digest = createHash("sha256")
  .update(["feishu", accountId, chatId, providerSenderId].join("\u0000"))
  .digest("base64url")
  .slice(0, 32);
const participantRef = `participant_${digest}`;
```

For `chat_type: "p2p"`, use `chat_partner.name` as the conversation name when
available. For `chat_type: "group"`, use `chat_name`. If the official envelope
lacks required chat type, name, sender ID, or timestamp, reject the page with a
sanitized provider-output error so its checkpoint is not advanced.

- [ ] **Step 4: Render Feishu mentions at send time**

Build the text sent to the CLI from validated resolved participants:

```typescript
const mentionPrefix = input.mentions
  .map(
    (mention) =>
      `<at user_id="${escapeFeishuAttribute(
        mention.providerParticipantId
      )}">${escapeFeishuText(mention.displayName)}</at>`
  )
  .join(" ");
const text = mentionPrefix
  ? `${mentionPrefix}\n${input.content}`
  : input.content;
```

Continue using a direct argument array through `CommandRunner`; do not invoke a
shell. Preserve the CLI idempotency key and ambiguous-timeout handling.

- [ ] **Step 5: Run tests, typecheck, and commit**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-cli-adapters.test.ts tests/provider-contracts/inbox-provider-kit.test.ts
pnpm typecheck
```

Expected: selected tests PASS.

Commit:

```bash
git add server/src/inbox/providers/lark-cli-adapter.ts server/src/inbox/providers/provider-fixtures.ts server/tests/unit/inbox-cli-adapters.test.ts server/tests/provider-contracts
git commit -m "feat(inbox): normalize Feishu conversation digests"
```

---

### Task 6: Normalize Official DWS Conversation Batches and Mentions

**Files:**
- Modify: `server/src/inbox/providers/dingtalk-dws-adapter.ts`
- Modify: `server/tests/unit/inbox-cli-adapters.test.ts`
- Modify: `server/tests/provider-contracts/inbox-provider-kit.test.ts`

**Interfaces:**
- Accept the official grouped `conversationMessagesList` result and the
  currently supported flat `messages` result.
- Preserve group title and conversation type in normalized events.
- Use current DWS send flags `--at-open-dingtalk-ids` and matching body
  placeholders.

- [ ] **Step 1: Add failing grouped-envelope tests**

Use this sanitized DWS shape:

```typescript
{
  result: {
    conversationMessagesList: [
      {
        title: "产品讨论组",
        openConversationId: "ding-chat-demo",
        conversationType: "group",
        messages: [
          {
            messageId: "ding-message-demo",
            senderOpenDingTalkId: "private_dingtalk_user",
            senderName: "王同学",
            text: "请确认接口交付时间",
            createTime: "2026-07-24T09:00:00+08:00"
          }
        ]
      }
    ],
    hasMore: true,
    nextCursor: "20"
  }
}
```

Assert the same public/private separation as Feishu. Keep one regression test
for the flat `messages` envelope already supported by the adapter.

- [ ] **Step 2: Add failing DWS send tests**

For a group send with one target, assert the exact argument sequence contains:

```typescript
[
  "chat",
  "message",
  "send",
  "--group",
  "ding-chat-demo",
  "--title",
  "Hush 回复",
  "--text",
  "<@private_dingtalk_user>\n用户确认后的回复",
  "--at-open-dingtalk-ids",
  "private_dingtalk_user",
  "--uuid",
  "send-key-1",
  "--format",
  "json"
]
```

Do not expect the obsolete `--at-users`, `@-`, stdin body, or `--yes`.

- [ ] **Step 3: Run adapter tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-cli-adapters.test.ts tests/provider-contracts/inbox-provider-kit.test.ts
```

Expected: FAIL because the adapter currently requires a flat `messages` array
and uses old send arguments.

- [ ] **Step 4: Implement grouped flattening and safe participant refs**

Flatten each conversation group into messages while inheriting
`openConversationId`, `title`, and `conversationType`. Generate DingTalk
participant refs with the same SHA-256 scheme as Task 5, but with
`"dingtalk"` in the tuple.

Treat `conversationType` values `group` and `2` as group; treat `p2p`,
`direct`, and `1` as direct. Reject unknown types with a sanitized provider
output error so they cannot be misrouted.

- [ ] **Step 5: Implement current DWS send semantics**

For group sends, add one `<@openDingTalkId>` line per validated target and pass
the same comma-separated IDs through `--at-open-dingtalk-ids`. Pass the
idempotency key, truncated to the DWS documented limit, through `--uuid`.

For direct sends, use
`chat message send --open-dingtalk-id <resolved-id> --text <content> --uuid
<idempotency-key> --format json`. The provider participant ID comes from the
direct source message's private binding. If it cannot be resolved, return
`INBOX_PROVIDER_UNAVAILABLE` without attempting a send.

- [ ] **Step 6: Run tests, typecheck, and commit**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-cli-adapters.test.ts tests/provider-contracts/inbox-provider-kit.test.ts
pnpm typecheck
```

Expected: selected tests PASS.

Commit:

```bash
git add server/src/inbox/providers/dingtalk-dws-adapter.ts server/tests/unit/inbox-cli-adapters.test.ts server/tests/provider-contracts/inbox-provider-kit.test.ts
git commit -m "feat(inbox): normalize DingTalk conversation digests"
```

---

### Task 7: Persist Local Inbox State Across Hush Restarts

**Files:**
- Create: `server/src/inbox/state-backend.ts`
- Create: `server/src/inbox/file-state-backend.ts`
- Modify: `server/src/inbox/in-memory.ts`
- Modify: `server/src/inbox/ports.ts`
- Create: `server/tests/unit/inbox-file-state.test.ts`

**Interfaces:**
- Add internal `InboxStateBackend.read()` and serialized
  `InboxStateBackend.mutate()`.
- Keep `InMemoryInboxStateBackend` for deterministic tests.
- Add `FileInboxStateBackend` for the real local Connector Host.
- Persist Inbox items, raw source messages, dedupe keys, open-digest indexes,
  drafts, private participant bindings, checkpoints, and completed send
  idempotency claims.
- Keep confirmation tokens in memory so a restart safely requires a new user
  confirmation.

- [ ] **Step 1: Write failing restart tests**

Using `mkdtemp` under the test temp directory:

1. create a file backend and repository set;
2. ingest two group messages, enrich the digest, create and edit a draft, bind
   a private participant, save a checkpoint, and record a completed send claim;
3. discard every object;
4. create a second backend from the same path;
5. verify the digest ID/revision/count, source-message dedupe, edited draft,
   private target resolution, checkpoint, and same-request idempotency result
   survive;
6. verify the next group event appends to the same open digest;
7. verify a different request hash with the same idempotency key conflicts;
8. verify the state file mode is owner read/write only.

Also test that two concurrent mutations both survive and that a malformed state
file fails startup with a sanitized configuration error rather than silently
starting from an empty Inbox.

- [ ] **Step 2: Run the persistence test and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-file-state.test.ts
```

Expected: FAIL because only process-local Maps exist.

- [ ] **Step 3: Define one versioned internal state**

Use an internal Zod schema with this top-level structure:

```typescript
export interface InboxStateBackend {
  read<T>(reader: (state: Readonly<InboxPersistedState>) => T): Promise<T>;
  mutate<T>(
    mutation: (state: InboxPersistedState) => {
      state: InboxPersistedState;
      value: T;
    }
  ): Promise<T>;
}

interface InboxPersistedState {
  state_version: 1;
  items: Record<string, PersistedInboxItem>;
  source_messages: Record<string, InboxSourceMessage[]>;
  dedupe_item_ids: Record<string, string>;
  open_digest_ids: Record<string, string>;
  drafts: Record<string, InboxDraft>;
  participant_bindings: Record<string, InboxParticipantBinding>;
  checkpoints: Record<string, InboxSyncStatus>;
  completed_send_claims: Record<
    string,
    {
      request_hash: string;
      result: InboxSendResult;
      expires_at: string;
    }
  >;
}
```

`PersistedInboxItem` may include raw-message bookkeeping needed by the
repository, but app responses must still be produced through
`unifiedInboxItemSchema` and must not expose it.

The state schema must not contain OAuth/PAT/API keys, CLI credential material,
confirmation tokens, or full CLI response envelopes.

- [ ] **Step 4: Implement atomic file transactions**

`FileInboxStateBackend.mutate()` must serialize mutations through one promise
queue, validate the resulting state, write a sibling temporary file with mode
`0o600`, fsync it, rename it over the target, and then update the in-memory
snapshot. Create the parent directory with mode `0o700`.

Never log the snapshot, mutation input, path contents, or caught parse text.
Never recover from malformed JSON by deleting or overwriting it. Return a
sanitized startup error instructing the user to preserve the file for manual
recovery.

- [ ] **Step 5: Move repository operations onto the backend**

Use the same repository classes with either backend so aggregation behavior
cannot diverge between tests and real runtime. Every mutation that changes an
item, draft, binding, checkpoint, or completed send claim must complete its
backend transaction before returning.

Keep in-flight send promises in memory. Persist an idempotency claim only after
the provider result is known; failed calls remove the in-flight claim, while
`unknown` is a valid persisted result and must not be automatically retried.

- [ ] **Step 6: Run persistence and regression tests**

Run:

```bash
cd server
pnpm vitest run tests/unit/inbox-file-state.test.ts tests/unit/inbox-repositories.test.ts tests/unit/inbox-service.test.ts tests/unit/connector-host.test.ts
pnpm typecheck
```

Expected: selected tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/inbox/state-backend.ts server/src/inbox/file-state-backend.ts server/src/inbox/in-memory.ts server/src/inbox/ports.ts server/tests/unit/inbox-file-state.test.ts
git commit -m "feat(inbox): persist local state across restarts"
```

---

### Task 8: Wire StepFun, Persistent State, and Connector Limits into Composition

**Files:**
- Modify: `.gitignore`
- Modify: `server/src/config.ts`
- Modify: `server/.env.example`
- Modify: `server/src/composition.ts`
- Modify: `server/src/inbox/connector-host.ts`
- Modify: `server/tests/unit/config.test.ts`
- Modify: `server/tests/unit/composition.test.ts`
- Modify: `server/tests/unit/connector-host.test.ts`

**Interfaces:**
- Add `INBOX_STEPFUN_BASE_URL`, `INBOX_STEPFUN_MODEL`,
  `INBOX_STEPFUN_API_KEY`, `INBOX_INITIAL_LOOKBACK_MINUTES`, and
  `INBOX_SYNC_BATCH_LIMIT`.
- Add `INBOX_STATE_FILE`.
- Compose StepFun only for Unified Inbox.
- Pass participant bindings from the Connector Host into the same ingest call
  as their events.

- [ ] **Step 1: Add failing config and composition tests**

Assert these defaults:

```typescript
expect(config.INBOX_STEPFUN_BASE_URL).toBe(
  "https://api.stepfun.com/step_plan/v1"
);
expect(config.INBOX_STEPFUN_MODEL).toBe("step-3.7-flash");
expect(config.INBOX_INITIAL_LOOKBACK_MINUTES).toBe(60);
expect(config.INBOX_SYNC_BATCH_LIMIT).toBe(100);
expect(config.INBOX_STATE_FILE).toBe(".data/unified-inbox-state.json");
```

Assert production composition selects the real StepFun provider only when
`INBOX_STEPFUN_API_KEY` is present. When absent, preserve Fixture behavior in
demo/test and Unavailable behavior in production. Assert `CLAUDE_API_KEY`
changes only the existing general Agent provider, not Inbox intelligence.

- [ ] **Step 2: Add failing connector tests**

Verify that the Connector Host:

- passes its configured batch limit, capped at 100, to each source;
- passes `participantBindings` to `InboxService.ingest` with the matching
  events;
- advances a checkpoint only after bindings and events are accepted;
- retains the old checkpoint when ingestion fails;
- records only a sanitized provider failure.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/unit/config.test.ts tests/unit/composition.test.ts tests/unit/connector-host.test.ts
```

Expected: FAIL because StepFun configuration and binding flow are not wired.

- [ ] **Step 4: Add safe environment configuration**

Add to `server/.env.example` with an empty key:

```dotenv
INBOX_STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1
INBOX_STEPFUN_MODEL=step-3.7-flash
INBOX_STEPFUN_API_KEY=
INBOX_INITIAL_LOOKBACK_MINUTES=60
INBOX_SYNC_BATCH_LIMIT=100
INBOX_STATE_FILE=.data/unified-inbox-state.json
```

Never copy the key supplied in chat into this file, a fixture, a test snapshot,
or a command committed to git.

- [ ] **Step 5: Update composition without disturbing the general Agent**

Instantiate `StepFunInboxIntelligenceProvider` from the new Inbox-specific
settings. Keep the existing `ClaudeLlm` composition exactly for non-Inbox
features. Give `InboxService` the participant directory backed by the selected
state backend; Connector Host transports bindings through
`InboxService.ingest`.

In test/demo Fixture graphs, build the Inbox repositories around
`InMemoryInboxStateBackend`. For a real Connector Host, build the same
repositories around `FileInboxStateBackend` from `INBOX_STATE_FILE`; this
includes its participant directory, checkpoint store, and completed-send
idempotency store. Add `.data/` to `.gitignore`.

Pass `INBOX_INITIAL_LOOKBACK_MINUTES` to both CLI adapters and
`INBOX_SYNC_BATCH_LIMIT` to Connector Host. Do not change Outlook/QQ selection.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
cd server
pnpm vitest run tests/unit/config.test.ts tests/unit/composition.test.ts tests/unit/connector-host.test.ts
pnpm typecheck
```

Expected: selected tests PASS.

Commit:

```bash
git add .gitignore server/src/config.ts server/.env.example server/src/composition.ts server/src/inbox/connector-host.ts server/tests/unit/config.test.ts server/tests/unit/composition.test.ts server/tests/unit/connector-host.test.ts
git commit -m "feat(inbox): wire StepFun conversation digest runtime"
```

---

### Task 9: Add a Sanitized External Validation Harness and Runbook

**Files:**
- Create: `server/scripts/smoke-inbox.mjs`
- Modify: `server/package.json`
- Create: `docs/unified-inbox-external-validation.md`
- Create: `server/tests/integration/inbox-smoke-script.test.ts`

**Interfaces:**
- `pnpm smoke:inbox -- --provider feishu --mode read`
- `pnpm smoke:inbox -- --provider dingtalk --mode read`
- `pnpm smoke:inbox -- --provider feishu --mode send --item-id <id>`
- `pnpm smoke:inbox -- --provider dingtalk --mode send --item-id <id>`

- [ ] **Step 1: Write failing harness tests**

Spawn the script against an in-process fake HTTP server and verify:

- `read` checks sync status, lists cards, finds the requested provider, verifies
  conversation metadata, non-empty StepFun summary, draft presence when
  `needs_reply`, and no private-ID fields;
- `read` prints counts and booleans only, never subject, content, summary,
  draft, names, account IDs, conversation IDs, or item IDs;
- `send` refuses to run unless `HUSH_SMOKE_ALLOW_SEND=true`;
- `send` requires an explicit item ID, fetches the current draft version,
  obtains a confirmation token, and sends with a fresh idempotency key;
- failures print only provider, stage, HTTP status, and Hush error code.

- [ ] **Step 2: Run the harness test and verify RED**

Run:

```bash
cd server
pnpm vitest run tests/integration/inbox-smoke-script.test.ts
```

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the harness**

Use Node's built-in `fetch` and `crypto.randomUUID`; add no dependency. Require:

```text
HUSH_BASE_URL
HUSH_APP_TOKEN
```

For send mode also require:

```text
HUSH_SMOKE_ALLOW_SEND=true
```

The script must never call provider CLIs itself. It validates the running Hush
server, so the same flow covers Connector Host, StepFun, repository, API, and
sender.

- [ ] **Step 4: Write the external validation runbook**

Document separate sections for the designated Feishu computer and designated
DingTalk computer:

1. authenticate the official CLI to the personal/current-user account;
2. set only local `.env` values;
3. start Hush in the foreground and leave the app/server running;
4. send new direct and group messages from another participant;
5. run read smoke and verify one evolving card per group;
6. open/acknowledge the exact revision;
7. send another group message and verify a new card;
8. inspect and edit the AI draft in Hush;
9. run send smoke only after checking provider, conversation, draft, and @
   targets in the app;
10. confirm delivery in the real Feishu or DingTalk session.
11. restart Hush, rerun read smoke, and verify the checkpoint continues without
    losing the digest or creating a duplicate card.

For DingTalk, reference local environment variable names only. Do not include
the real corp ID, account ID, openDingTalkId, group ID, or verified message
contents previously supplied by the user.

- [ ] **Step 5: Run harness tests and commit**

Run:

```bash
cd server
pnpm vitest run tests/integration/inbox-smoke-script.test.ts
```

Expected: PASS.

Commit:

```bash
git add server/scripts/smoke-inbox.mjs server/package.json server/tests/integration/inbox-smoke-script.test.ts docs/unified-inbox-external-validation.md
git commit -m "test(inbox): add sanitized external validation harness"
```

---

### Task 10: Complete Local Verification and Prepare External Handoff

**Files:**
- Modify only if a failing check identifies a defect directly caused by Tasks
  1–9.

- [ ] **Step 1: Scan for leaked secrets and private identifiers**

Run:

```bash
git grep -nE '(INBOX_STEPFUN_API_KEY|DINGTALK_ACCOUNT_ID|LARK_ACCOUNT_ID)=.+' -- . ':!server/.env.example'
```

Expected: no output. If any tracked secret or real account value exists, remove
it and replace fixture identifiers with synthetic values before continuing.

- [ ] **Step 2: Run all local backend checks**

Run:

```bash
cd server
pnpm check
```

Expected: typecheck, all Vitest suites, and build PASS.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git log --oneline --decorate origin/main..HEAD
```

Expected: clean worktree, no whitespace errors, only W2/P3 backend/contracts/
tests/docs changes, and no frontend or Xcode changes.

- [ ] **Step 4: Perform code review**

Use `superpowers:requesting-code-review`. Resolve only findings that are in
scope and rerun the focused test for every correction. Then rerun:

```bash
cd server
pnpm check
```

Expected: PASS after review corrections.

- [ ] **Step 5: Hand off external validation**

Do not claim real-provider completion and do not push. Give the user the two
exact read commands from Task 8 and the runbook path. Wait for sanitized
Feishu and DingTalk validation results.

- [ ] **Step 6: Verify after external success and push only with authorization**

After both external computers pass read, StepFun summary/draft,
acknowledgement, edited draft, targeted send, real delivery, and restart
continuation:

```bash
cd server
pnpm check
cd ..
git status --short
```

Expected: all checks PASS and the worktree is clean.

Only then, and only after the user confirms the external results and authorizes
the push, use `superpowers:finishing-a-development-branch` to choose the remote
integration action.
