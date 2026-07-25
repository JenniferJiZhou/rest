import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  InboxEvent,
  InboxSendResult
} from "../../src/domain/contracts.js";
import { FileInboxStateBackend } from "../../src/inbox/file-state-backend.js";
import {
  InboxSendIdempotencyStore,
  InMemoryCheckpointStore,
  InMemoryInboxDraftRepository,
  InMemoryInboxParticipantDirectory,
  InMemoryInboxRepository
} from "../../src/inbox/in-memory.js";
import type { InboxStateBackend } from "../../src/inbox/state-backend.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("FileInboxStateBackend", () => {
  it("restores one repository graph after a process restart", async () => {
    const stateFile = await temporaryStateFile();
    const firstBackend = await FileInboxStateBackend.open(stateFile);
    const first = repositories(firstBackend);

    const initial = await first.items.upsert(
      groupEvent("group-message-1", "2026-07-24T00:00:00.000Z")
    );
    const aggregated = await first.items.upsert(
      groupEvent("group-message-2", "2026-07-24T00:01:00.000Z")
    );
    await first.items.saveEnrichment(
      aggregated.item.id,
      aggregated.item.revision,
      {
        summary: "群聊摘要",
        important_points: ["待确认交付时间"],
        todos: ["确认交付时间"],
        priority: "urgent",
        needs_reply: true,
        reply_targets: [
          {
            target_id: "participant_demo_0002",
            display_name: "王同学",
            reason: "需要确认"
          }
        ]
      }
    );
    await first.drafts.create({
      id: "draft-persisted",
      inboxItemId: initial.item.id,
      content: "AI 草稿",
      contentType: "text",
      now: "2026-07-24T00:02:00.000Z"
    });
    await first.drafts.update("draft-persisted", {
      content: "用户编辑后的草稿",
      contentType: "text",
      expectedVersion: 1
    });
    await first.participants.bindAll([
      {
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "group-conversation-1",
        participantRef: "participant_demo_0002",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);
    await first.checkpoints.put("feishu", "account-demo", "checkpoint-2");
    const unknownResult: InboxSendResult = {
      draft_id: "draft-persisted",
      provider: "feishu",
      status: "unknown",
      provider_message_id: null,
      sent_at: null
    };
    await first.sendClaims.claimOrGet({
      key: "persistent-send-key",
      requestHash: "request-hash-1",
      ttlSeconds: 3600,
      create: async () => unknownResult
    });

    const secondBackend = await FileInboxStateBackend.open(stateFile);
    const second = repositories(secondBackend);
    const restored = await second.items.get(initial.item.id);

    expect(restored).toMatchObject({
      id: initial.item.id,
      revision: 2,
      message_count: 2,
      summary: "群聊摘要"
    });
    await expect(
      second.items.upsert(
        groupEvent("group-message-2", "2026-07-24T00:01:00.000Z")
      )
    ).resolves.toMatchObject({
      created: false,
      changed: false,
      item: { id: initial.item.id, message_count: 2 }
    });
    await expect(second.drafts.get("draft-persisted")).resolves.toMatchObject({
      content: "用户编辑后的草稿",
      version: 2,
      origin: "user"
    });
    await expect(
      second.participants.resolve({
        provider: "feishu",
        accountId: "account-demo",
        conversationId: "group-conversation-1",
        participantRefs: ["participant_demo_0002"]
      })
    ).resolves.toEqual([
      {
        participantRef: "participant_demo_0002",
        providerParticipantId: "ou_private_value",
        displayName: "王同学"
      }
    ]);
    await expect(
      second.checkpoints.get("feishu", "account-demo")
    ).resolves.toBe("checkpoint-2");

    const replayCreate = vi.fn(async () => ({
      ...unknownResult,
      status: "sent" as const
    }));
    await expect(
      second.sendClaims.claimOrGet({
        key: "persistent-send-key",
        requestHash: "request-hash-1",
        ttlSeconds: 3600,
        create: replayCreate
      })
    ).resolves.toEqual({
      kind: "existing_same_request",
      value: unknownResult
    });
    expect(replayCreate).not.toHaveBeenCalled();

    const appended = await second.items.upsert(
      groupEvent("group-message-3", "2026-07-24T00:03:00.000Z")
    );
    expect(appended).toMatchObject({
      created: false,
      changed: true,
      item: {
        id: initial.item.id,
        revision: 3,
        message_count: 3
      }
    });
    await expect(
      second.sendClaims.claimOrGet({
        key: "persistent-send-key",
        requestHash: "different-request-hash",
        ttlSeconds: 3600,
        create: async () => unknownResult
      })
    ).resolves.toEqual({ kind: "conflict_different_request" });

    const serialized = await readFile(stateFile, "utf8");
    expect(serialized).not.toContain("confirmation_token");
  });

  it("serializes concurrent mutations so neither update is lost", async () => {
    const backend = await FileInboxStateBackend.open(
      await temporaryStateFile()
    );
    const firstRepository = new InMemoryInboxRepository(backend);
    const secondRepository = new InMemoryInboxRepository(backend);

    await Promise.all([
      firstRepository.upsert(directEvent("message-1")),
      secondRepository.upsert(directEvent("message-2"))
    ]);

    expect((await firstRepository.list({ limit: 20 })).items).toHaveLength(2);
  });

  it("keeps in-flight sends in memory and persists only a completed result", async () => {
    const stateFile = await temporaryStateFile();
    const backend = await FileInboxStateBackend.open(stateFile);
    const store = new InboxSendIdempotencyStore(
      backend,
      () => Date.parse("2026-07-24T00:00:00.000Z")
    );
    const failedCreate = vi.fn(async (): Promise<InboxSendResult> => {
      throw new Error("provider failed");
    });

    await expect(
      store.claimOrGet({
        key: "retryable-send-key",
        requestHash: "request-hash",
        ttlSeconds: 3600,
        create: failedCreate
      })
    ).rejects.toThrow("provider failed");

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completedResult: InboxSendResult = {
      draft_id: "draft-persisted",
      provider: "feishu",
      status: "unknown",
      provider_message_id: null,
      sent_at: null
    };
    const successfulCreate = vi.fn(async () => {
      await gate;
      return completedResult;
    });
    const first = store.claimOrGet({
      key: "retryable-send-key",
      requestHash: "request-hash",
      ttlSeconds: 3600,
      create: successfulCreate
    });
    const second = store.claimOrGet({
      key: "retryable-send-key",
      requestHash: "request-hash",
      ttlSeconds: 3600,
      create: successfulCreate
    });
    await vi.waitFor(() => {
      expect(successfulCreate).toHaveBeenCalledTimes(1);
    });
    release();

    await expect(first).resolves.toEqual({
      kind: "created",
      value: completedResult
    });
    await expect(second).resolves.toEqual({
      kind: "existing_same_request",
      value: completedResult
    });
    expect(failedCreate).toHaveBeenCalledTimes(1);

    const restarted = new InboxSendIdempotencyStore(
      await FileInboxStateBackend.open(stateFile),
      () => Date.parse("2026-07-24T00:00:01.000Z")
    );
    const unexpectedCreate = vi.fn(async () => completedResult);
    await expect(
      restarted.claimOrGet({
        key: "retryable-send-key",
        requestHash: "request-hash",
        ttlSeconds: 3600,
        create: unexpectedCreate
      })
    ).resolves.toEqual({
      kind: "existing_same_request",
      value: completedResult
    });
    expect(unexpectedCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed state without exposing its contents or replacing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hush-inbox-malformed-"));
    temporaryDirectories.push(directory);
    const stateFile = join(directory, "unified-inbox-state.json");
    const malformedContents = '{"state_version":1,"secret":"do-not-expose"';
    await writeFile(stateFile, malformedContents, { mode: 0o600 });

    await expect(FileInboxStateBackend.open(stateFile)).rejects.toThrow(
      "Invalid Inbox state configuration. Preserve the state file for manual recovery."
    );
    await expect(readFile(stateFile, "utf8")).resolves.toBe(
      malformedContents
    );
    await expect(FileInboxStateBackend.open(stateFile)).rejects.not.toThrow(
      /do-not-expose/u
    );
  });

  it.skipIf(process.platform === "win32")(
    "uses restrictive directory and replacement file permissions",
    async () => {
      const stateFile = await temporaryStateFile();
      await mkdir(dirname(stateFile), { recursive: true });
      await writeFile(
        stateFile,
        JSON.stringify({
          state_version: 1,
          items: {},
          source_messages: {},
          dedupe_item_ids: {},
          open_digest_ids: {},
          drafts: {},
          participant_bindings: {},
          checkpoints: {},
          completed_send_claims: {}
        })
      );
      await chmod(stateFile, 0o666);
      const backend = await FileInboxStateBackend.open(stateFile);

      expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(stateFile))).mode & 0o777).toBe(0o700);

      await new InMemoryInboxRepository(backend).upsert(
        directEvent("permission-message")
      );

      expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(stateFile))).mode & 0o777).toBe(0o700);
    }
  );
});

async function temporaryStateFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "hush-inbox-state-"));
  temporaryDirectories.push(directory);
  return join(directory, "private", "unified-inbox-state.json");
}

function repositories(backend: InboxStateBackend) {
  const now = () => new Date("2026-07-24T00:05:00.000Z");
  return {
    items: new InMemoryInboxRepository(backend),
    drafts: new InMemoryInboxDraftRepository(backend),
    participants: new InMemoryInboxParticipantDirectory(backend),
    checkpoints: new InMemoryCheckpointStore(now, backend),
    sendClaims: new InboxSendIdempotencyStore(
      backend,
      () => now().getTime()
    )
  };
}

function groupEvent(
  providerMessageId: string,
  receivedAt: string
): InboxEvent {
  return {
    provider: "feishu",
    account_id: "account-demo",
    conversation_id: "group-conversation-1",
    conversation_type: "group",
    conversation_name: "产品讨论组",
    provider_message_id: providerMessageId,
    sender: "王同学",
    sender_ref: "participant_demo_0002",
    recipients: [],
    subject: null,
    content: "请确认接口交付时间。",
    received_at: receivedAt,
    coverage: {
      source: "official_api",
      complete: true,
      note: null
    }
  };
}

function directEvent(providerMessageId: string): InboxEvent {
  return {
    provider: "outlook",
    account_id: "hush@example.com",
    conversation_id: "conversation-1",
    conversation_type: "direct",
    conversation_name: "项目会话",
    provider_message_id: providerMessageId,
    sender: "sender@example.com",
    sender_ref: null,
    recipients: ["hush@example.com"],
    subject: "项目确认",
    content: "请确认项目时间。",
    received_at: "2026-07-24T09:00:00+08:00",
    coverage: {
      source: "official_api",
      complete: true,
      note: null
    }
  };
}
