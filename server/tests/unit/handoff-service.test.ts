import { describe, expect, it } from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { HandoffService } from "../../src/application/handoff/handoff-service.js";
import { AppError } from "../../src/domain/errors.js";
import type {
  HandoffJob,
  HandoffJobState,
  HandoffStartRequest
} from "../../src/domain/contracts.js";
import type {
  DraftRequest,
  DraftResult,
  HandoffAgentInput,
  HandoffCompletionSink,
  HandoffJobRecord,
  HandoffJobTransition,
  HandoffJobTransitionResult,
  IdGenerator,
  MailFetchContext,
  MailItem,
  MailProvider,
  ProviderHealth
} from "../../src/domain/ports.js";
import {
  InMemoryHandoffJobRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";

const CONCURRENT_CALLS = 20;
const NOW = "2026-07-24T22:00:00+08:00";

describe("HandoffService concurrency", () => {
  it("creates and processes one Job for concurrent identical starts", async () => {
    const jobs = new CountingHandoffJobRepository();
    const mail = new RecordingMailProvider();
    const agent = new ControlledHandoffAgent();
    const completion = new RecordingCompletionSink();
    const service = createService({ jobs, mail, agent, completion });
    const request = handoffRequest("req_concurrent_same", [
      {
        id: "ol_same",
        text: "回复李老师",
        desired_time: "tomorrow_morning"
      }
    ]);

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_CALLS }, () =>
        service.start(request, "idem-concurrent-same")
      )
    );

    expect(new Set(results.map((result) => result.job_id)).size).toBe(1);
    expect(jobs.createCalls).toBe(1);
    await agent.waitUntilStarted();
    expect(agent.summarizeCalls).toBe(1);
    expect(mail.fetchCalls).toBe(1);

    agent.release();
    await completion.waitUntilNotified();

    expect(mail.draftCalls).toBe(1);
    expect(completion.notifyCalls).toBe(1);
    const record = await jobs.get(results[0]!.job_id);
    expect(record?.state.status).toBe("succeeded");
    expect(record?.state.summary?.drafts).toHaveLength(1);
    expect(record?.state.summary?.pause_receipt.held_items).toHaveLength(2);
  });

  it("rejects the same key with a different Handoff request", async () => {
    const completion = new RecordingCompletionSink();
    const service = createService({
      agent: new RecordingHandoffAgent(),
      completion
    });
    const first = handoffRequest("req_conflict_a", [
      {
        id: "ol_a",
        text: "回复李老师",
        desired_time: "tomorrow"
      }
    ]);
    const second = handoffRequest("req_conflict_b", [
      {
        id: "ol_b",
        text: "准备演示材料",
        desired_time: "tomorrow"
      }
    ]);

    await service.start(first, "idem-handoff-conflict");

    await expect(
      service.start(second, "idem-handoff-conflict")
    ).rejects.toMatchObject({
      statusCode: 409
    });
    await completion.waitUntilNotified();
  });

  it("reuses a Job when only request metadata changes", async () => {
    const completion = new RecordingCompletionSink();
    const service = createService({
      agent: new RecordingHandoffAgent(),
      completion
    });
    const first = handoffRequest("req_metadata_a", []);
    const second = handoffRequest("req_metadata_b", []);

    const firstResult = await service.start(
      first,
      "idem-handoff-metadata"
    );
    const secondResult = await service.start(
      second,
      "idem-handoff-metadata"
    );

    expect(secondResult.job_id).toBe(firstResult.job_id);
    expect(secondResult.request_id).toBe("req_metadata_b");
    await completion.waitUntilNotified();
  });
});

describe("HandoffService cancellation races", () => {
  it.each([
    ["after mail fetch", "classifying"],
    ["after agent classification", "creating_drafts"],
    ["after draft processing", "preparing_receipt"],
    ["before Pause Receipt construction", "preparing_receipt"],
    ["before succeeded persistence", "completed"],
    ["before completion notification", "completed"]
  ] as const)(
    "keeps cancelled terminal when cancellation wins %s",
    async (_boundary, blockedStage) => {
      const jobs = new GatedUpdateHandoffJobRepository(blockedStage);
      const completion = new RecordingCompletionSink();
      const service = createService({
        jobs,
        agent: new RecordingHandoffAgent(),
        completion
      });
      const record = jobRecord(
        handoffRequest(`req_cancel_${blockedStage}`, [
          {
            id: `ol_cancel_${blockedStage}`,
            text: "取消后不能完成",
            desired_time: "tomorrow"
          }
        ]),
        `hj_cancel_${blockedStage}`
      );
      await jobs.create(record);

      const processing = service.process(record.job.job_id);
      await jobs.waitUntilBlocked();
      await service.cancel(record.job.job_id);
      expect((await jobs.get(record.job.job_id))?.state.status).toBe(
        "cancelled"
      );

      jobs.release();
      await processing;

      const finalRecord = await jobs.get(record.job.job_id);
      expect(finalRecord?.state).toMatchObject({
        status: "cancelled",
        progress_stage: "cancelled",
        summary: null
      });
      expect(completion.notifyCalls).toBe(0);
    }
  );
});

describe("Handoff Job state transitions", () => {
  it("keeps repeated cancellation idempotent and terminal", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const service = createService({ jobs });
    const record = jobRecord(
      handoffRequest("req_cancel_idempotent", []),
      "hj_cancel_idempotent"
    );
    await jobs.create(record);

    await service.cancel(record.job.job_id);
    await service.cancel(record.job.job_id);

    expect((await jobs.get(record.job.job_id))?.state.status).toBe(
      "cancelled"
    );
    await expect(
      jobs.transition(record.job.job_id, {
        expectedStatuses: ["cancelled"],
        updatedAt: NOW,
        nextState: {
          ...record.state,
          status: "running",
          progress_stage: "fetching_mail"
        }
      })
    ).rejects.toThrow("illegal Handoff status transition");
  });

  it.each([
    ["succeeded", "completed"],
    ["failed", "failed"]
  ] as const)(
    "does not reverse the %s terminal state",
    async (terminalStatus, terminalStage) => {
      const jobs = new InMemoryHandoffJobRepository();
      const service = createService({ jobs });
      const record = jobRecord(
        handoffRequest(`req_terminal_${terminalStatus}`, []),
        `hj_terminal_${terminalStatus}`
      );
      await jobs.create(record);
      await jobs.transition(record.job.job_id, {
        expectedStatuses: ["queued"],
        updatedAt: NOW,
        nextState: {
          ...record.state,
          status: "running",
          progress_stage: "fetching_mail"
        }
      });
      const running = await jobs.get(record.job.job_id);
      if (!running) {
        throw new Error("running Job must exist");
      }
      await jobs.transition(record.job.job_id, {
        expectedStatuses: ["running"],
        updatedAt: NOW,
        nextState: {
          ...running.state,
          status: terminalStatus,
          progress_stage: terminalStage
        }
      });

      await service.cancel(record.job.job_id);

      expect((await jobs.get(record.job.job_id))?.state.status).toBe(
        terminalStatus
      );
      const reverseStatus =
        terminalStatus === "succeeded" ? "failed" : "succeeded";
      const reverseStage =
        reverseStatus === "succeeded" ? "completed" : "failed";
      await expect(
        jobs.transition(record.job.job_id, {
          expectedStatuses: [terminalStatus],
          updatedAt: NOW,
          nextState: {
            ...running.state,
            status: reverseStatus,
            progress_stage: reverseStage
          }
        })
      ).rejects.toThrow("illegal Handoff status transition");
    }
  );

  it("rejects a direct queued-to-succeeded transition", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const record = jobRecord(
      handoffRequest("req_illegal_queued", []),
      "hj_illegal_queued"
    );
    await jobs.create(record);

    await expect(
      jobs.transition(record.job.job_id, {
        expectedStatuses: ["queued"],
        updatedAt: NOW,
        nextState: {
          ...record.state,
          status: "succeeded",
          progress_stage: "completed"
        }
      })
    ).rejects.toThrow("illegal Handoff status transition");
  });
});

describe("Handoff completion delivery isolation", () => {
  it.each([
    [
      "provider unavailable",
      new AppError({
        code: "PHOTON_UNAVAILABLE",
        message: "messaging unavailable",
        statusCode: 503,
        retryable: true
      })
    ],
    [
      "provider timeout",
      new AppError({
        code: "PHOTON_UNAVAILABLE",
        message: "messaging timed out",
        statusCode: 503,
        retryable: true,
        details: { reason: "timeout" }
      })
    ],
    ["ordinary exception", new Error("ordinary delivery failure")]
  ])(
    "preserves succeeded summary when completion has %s",
    async (_scenario, error) => {
      const jobs = new InMemoryHandoffJobRepository();
      const completion = new ThrowingCompletionSink(error);
      const service = createService({ jobs, completion });
      const record = jobRecord(
        handoffRequest(`req_completion_${_scenario}`, []),
        `hj_completion_${_scenario}`
      );
      await jobs.create(record);

      await service.process(record.job.job_id);

      const finalRecord = await jobs.get(record.job.job_id);
      expect(finalRecord?.state.status).toBe("succeeded");
      expect(finalRecord?.state.summary).not.toBeNull();
      expect(finalRecord?.state.summary?.pause_receipt).toBeDefined();
      expect(completion.notifyCalls).toBe(1);
    }
  );

  it("does not deliver completion twice for the same Job", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const completion = new RecordingCompletionSink();
    const service = createService({ jobs, completion });
    const record = jobRecord(
      handoffRequest("req_completion_once", []),
      "hj_completion_once"
    );
    await jobs.create(record);

    await service.process(record.job.job_id);
    await service.process(record.job.job_id);

    expect(completion.notifyCalls).toBe(1);
  });
});

describe("Handoff draft failure receipt", () => {
  it("retains failed drafts as not_saved without failing the Job", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const service = createService({
      jobs,
      mail: new PartiallyFailingMailProvider(),
      agent: new TwoDraftHandoffAgent()
    });
    const record = jobRecord(
      handoffRequest("req_partial_draft_failure", []),
      "hj_partial_draft_failure"
    );
    await jobs.create(record);

    await service.process(record.job.job_id);

    const finalRecord = await jobs.get(record.job.job_id);
    expect(finalRecord?.state.status).toBe("succeeded");
    expect(finalRecord?.state.summary?.drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          for_item_id: "mail_success",
          saved: true
        }),
        expect.objectContaining({
          for_item_id: "mail_failure",
          saved: false
        })
      ])
    );
    expect(
      finalRecord?.state.summary?.pause_receipt.held_items
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "mail_success",
          status: "gmail_draft_saved"
        }),
        expect.objectContaining({
          id: "mail_failure",
          status: "not_saved"
        })
      ])
    );
    expect(
      finalRecord?.state.summary?.pause_receipt.coverage_note
    ).toContain("未保存");
    expect(
      finalRecord?.state.summary?.pause_receipt.conclusion
    ).not.toContain("所有事项均已接住");
  });
});

function createService(
  overrides: {
    jobs?: InMemoryHandoffJobRepository;
    mail?: MailProvider;
    agent?: CannedAgentLLM;
    completion?: HandoffCompletionSink;
  } = {}
): HandoffService {
  return new HandoffService(
    overrides.jobs ?? new InMemoryHandoffJobRepository(),
    new InMemoryIdempotencyStore<string>(),
    overrides.mail ?? new RecordingMailProvider(),
    overrides.agent ?? new RecordingHandoffAgent(),
    overrides.completion ?? new RecordingCompletionSink(),
    { now: () => new Date(NOW) },
    new SequentialIdGenerator(),
    { log: () => {} }
  );
}

function handoffRequest(
  requestId: string,
  openLoops: HandoffStartRequest["open_loops"]
): HandoffStartRequest {
  return {
    schema_version: "1.0",
    request_id: requestId,
    source: "ios_app",
    include_gmail: true,
    gmail_account_id: "demo",
    open_loops: openLoops,
    response_channel: "imessage",
    timezone: "Asia/Shanghai",
    locale: "zh-CN"
  };
}

function jobRecord(
  request: HandoffStartRequest,
  jobId: string
): HandoffJobRecord {
  const job: HandoffJob = {
    schema_version: "1.0",
    request_id: request.request_id,
    job_id: jobId,
    status: "queued",
    estimated_wait_seconds: 20,
    micro_reset_available: true
  };
  const state: HandoffJobState = {
    schema_version: "1.0",
    request_id: request.request_id,
    job_id: jobId,
    status: "queued",
    progress_stage: "queued",
    estimated_wait_seconds: 20,
    summary: null,
    error: null
  };
  return {
    job,
    request,
    state,
    idempotencyKey: `idem-${jobId}`,
    createdAt: NOW,
    updatedAt: NOW,
    cancelled: false
  };
}

class CountingHandoffJobRepository extends InMemoryHandoffJobRepository {
  createCalls = 0;

  override async create(record: HandoffJobRecord): Promise<void> {
    this.createCalls += 1;
    await super.create(record);
  }
}

class GatedUpdateHandoffJobRepository extends InMemoryHandoffJobRepository {
  private readonly entered = deferred<void>();
  private readonly gate = deferred<void>();
  private blocked = false;

  constructor(
    private readonly blockedStage: HandoffJobState["progress_stage"]
  ) {
    super();
  }

  override async transition(
    id: string,
    input: HandoffJobTransition
  ): Promise<HandoffJobTransitionResult> {
    if (
      !this.blocked &&
      input.nextState.progress_stage === this.blockedStage
    ) {
      this.blocked = true;
      this.entered.resolve();
      await this.gate.promise;
    }
    return super.transition(id, input);
  }

  waitUntilBlocked(): Promise<void> {
    return this.entered.promise;
  }

  release(): void {
    this.gate.resolve();
  }
}

class RecordingMailProvider implements MailProvider {
  fetchCalls = 0;
  draftCalls = 0;

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(_context: MailFetchContext): Promise<MailItem[]> {
    this.fetchCalls += 1;
    return [
      {
        id: "mail_1",
        threadId: "thread_1",
        from: "teacher@example.com",
        replyTo: null,
        subject: "演示确认",
        receivedAt: NOW,
        plainText: "请确认明天的演示安排。"
      }
    ];
  }

  async createDraft(_request: DraftRequest): Promise<DraftResult> {
    this.draftCalls += 1;
    return { draftId: "draft_1" };
  }
}

class RecordingHandoffAgent extends CannedAgentLLM {
  summarizeCalls = 0;

  override async summarizeHandoff(
    _input: HandoffAgentInput
  ) {
    this.summarizeCalls += 1;
    return {
      classifications: [
        {
          id: "mail_1",
          priority: "tomorrow" as const,
          gist: "确认明天的演示安排",
          reason: "明天处理即可",
          suggestedDraft: "好的，我明天确认。"
        }
      ],
      tomorrowFirstStep: "先确认演示安排"
    };
  }
}

class ControlledHandoffAgent extends RecordingHandoffAgent {
  private readonly started = deferred<void>();
  private readonly gate = deferred<void>();

  override async summarizeHandoff(input: HandoffAgentInput) {
    this.summarizeCalls += 1;
    this.started.resolve();
    await this.gate.promise;
    return {
      classifications: input.mail.map((item) => ({
        id: item.id,
        priority: "tomorrow" as const,
        gist: "确认明天的演示安排",
        reason: "明天处理即可",
        suggestedDraft: "好的，我明天确认。"
      })),
      tomorrowFirstStep: "先确认演示安排"
    };
  }

  waitUntilStarted(): Promise<void> {
    return this.started.promise;
  }

  release(): void {
    this.gate.resolve();
  }
}

class RecordingCompletionSink implements HandoffCompletionSink {
  notifyCalls = 0;
  private readonly notified = deferred<void>();

  async notify(_record: HandoffJobRecord): Promise<void> {
    this.notifyCalls += 1;
    this.notified.resolve();
  }

  waitUntilNotified(): Promise<void> {
    return this.notified.promise;
  }
}

class ThrowingCompletionSink implements HandoffCompletionSink {
  notifyCalls = 0;

  constructor(private readonly error: Error) {}

  async notify(_record: HandoffJobRecord): Promise<void> {
    this.notifyCalls += 1;
    throw this.error;
  }
}

class PartiallyFailingMailProvider implements MailProvider {
  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(_context: MailFetchContext): Promise<MailItem[]> {
    return ["mail_success", "mail_failure"].map((id) => ({
      id,
      threadId: `thread_${id}`,
      from: `${id}@example.com`,
      replyTo: null,
      subject: `Subject ${id}`,
      receivedAt: NOW,
      plainText: "明天请确认。"
    }));
  }

  async createDraft(request: DraftRequest): Promise<DraftResult> {
    if (request.forItemId === "mail_failure") {
      throw new AppError({
        code: "GMAIL_DRAFT_FAILED",
        message: "draft failed",
        statusCode: 503,
        retryable: true
      });
    }
    return { draftId: "draft_success" };
  }
}

class TwoDraftHandoffAgent extends CannedAgentLLM {
  override async summarizeHandoff(input: HandoffAgentInput) {
    return {
      classifications: input.mail.map((mail) => ({
        id: mail.id,
        priority: "tomorrow" as const,
        gist: `Gist ${mail.id}`,
        reason: "明天处理",
        suggestedDraft: `Reply ${mail.id}`
      })),
      tomorrowFirstStep: "先处理成功草稿"
    };
  }
}

class SequentialIdGenerator implements IdGenerator {
  private value = 0;

  next(prefix: string): string {
    this.value += 1;
    return `${prefix}_${this.value}`;
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}
