import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { CannedAgentLLM } from "../../src/agent/canned-llm.js";
import { HandoffService } from "../../src/application/handoff/handoff-service.js";
import type {
  HandoffJob,
  HandoffJobState,
  HandoffStartRequest
} from "../../src/domain/contracts.js";
import type {
  AgentLLM,
  DraftRequest,
  DraftResult,
  HandoffAgentInput,
  HandoffCompletionSink,
  HandoffJobRecord,
  HandoffSummaryDraft,
  IdGenerator,
  MailFetchContext,
  MailItem,
  MailProvider,
  ProviderCallOptions,
  ProviderHealth
} from "../../src/domain/ports.js";
import {
  InMemoryHandoffJobRepository,
  InMemoryIdempotencyStore
} from "../../src/infra/in-memory.js";

const NOW = "2026-07-24T22:00:00+08:00";
const TIMEOUT_MS = 100;
let abortCaseSequence = 0;

describe("Handoff provider timeouts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails a Job when the LLM never returns", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const service = createService({
      jobs,
      agent: new NeverAgent()
    });
    const record = await seed(jobs, "llm_timeout");

    const processing = service.process(record.job.job_id);
    await expectTimeoutToSettle(processing);

    expect((await jobs.get(record.job.job_id))?.state).toMatchObject({
      status: "failed",
      error: { error: { code: "LLM_TIMEOUT" } }
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("degrades a Mail fetch timeout to OPEN_LOOPS_ONLY", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const service = createService({
      jobs,
      mail: new NeverMailProvider("fetch")
    });
    const record = await seed(jobs, "mail_timeout");

    const processing = service.process(record.job.job_id);
    await expectTimeoutToSettle(processing);

    const state = (await jobs.get(record.job.job_id))?.state;
    expect(state?.status).toBe("succeeded");
    expect(
      state?.summary?.pause_receipt.coverage.excluded_sources
    ).toContain("authorized_gmail_unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records a Draft timeout as not_saved", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const service = createService({
      jobs,
      mail: new NeverMailProvider("draft")
    });
    const record = await seed(jobs, "draft_timeout");

    const processing = service.process(record.job.job_id);
    await expectTimeoutToSettle(processing);

    const state = (await jobs.get(record.job.job_id))?.state;
    expect(state?.status).toBe("succeeded");
    expect(state?.summary?.drafts).toEqual([
      expect.objectContaining({ saved: false })
    ]);
    expect(state?.summary?.pause_receipt.held_items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "not_saved" })
      ])
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps succeeded when Completion never returns", async () => {
    const jobs = new InMemoryHandoffJobRepository();
    const service = createService({
      jobs,
      completion: new NeverCompletionSink()
    });
    const record = await seed(jobs, "completion_timeout");

    const processing = service.process(record.job.job_id);
    await expectTimeoutToSettle(processing);

    expect((await jobs.get(record.job.job_id))?.state.status).toBe(
      "succeeded"
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Handoff Job AbortSignal propagation", () => {
  it("aborts Mail fetch when cancellation wins", async () => {
    const operation = new AbortGate<MailItem[]>([]);
    const mail = new AbortableMailProvider(operation, null);
    await verifyCancelledOperation({
      mail,
      operation,
      expectedStatus: "cancelled"
    });
  });

  it("aborts LLM classification when cancellation wins", async () => {
    const operation = new AbortGate<HandoffSummaryDraft>({
      classifications: [],
      tomorrowFirstStep: null
    });
    const agent = new AbortableAgent(operation);
    await verifyCancelledOperation({
      agent,
      operation,
      expectedStatus: "cancelled"
    });
  });

  it("aborts Draft creation when cancellation wins", async () => {
    const operation = new AbortGate<DraftResult>({
      draftId: "released-draft"
    });
    const mail = new AbortableMailProvider(null, operation);
    await verifyCancelledOperation({
      mail,
      operation,
      expectedStatus: "cancelled"
    });
  });

  it("aborts Completion delivery without reversing succeeded", async () => {
    const operation = new AbortGate<void>(undefined);
    const completion = new AbortableCompletionSink(operation);
    await verifyCancelledOperation({
      completion,
      operation,
      expectedStatus: "succeeded"
    });
  });
});

async function verifyCancelledOperation<T>(input: {
  mail?: MailProvider;
  agent?: AgentLLM;
  completion?: HandoffCompletionSink;
  operation: AbortGate<T>;
  expectedStatus: "cancelled" | "succeeded";
}): Promise<void> {
  const jobs = new InMemoryHandoffJobRepository();
  const service = createService({
    jobs,
    ...(input.mail ? { mail: input.mail } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.completion ? { completion: input.completion } : {})
  });
  const record = await seed(
    jobs,
    `abort_${input.expectedStatus}_${++abortCaseSequence}`
  );
  const processing = service.process(record.job.job_id);
  await input.operation.waitUntilStarted();
  try {
    expect(input.operation.signal).toBeDefined();
    await service.cancel(record.job.job_id);
  } finally {
    input.operation.release();
  }
  await processing;

  expect(input.operation.aborted).toBe(true);
  expect((await jobs.get(record.job.job_id))?.state.status).toBe(
    input.expectedStatus
  );
}

function createService(
  overrides: {
    jobs?: InMemoryHandoffJobRepository;
    mail?: MailProvider;
    agent?: AgentLLM;
    completion?: HandoffCompletionSink;
  } = {}
): HandoffService {
  return new HandoffService(
    overrides.jobs ?? new InMemoryHandoffJobRepository(),
    new InMemoryIdempotencyStore<string>(),
    overrides.mail ?? new ImmediateMailProvider(),
    overrides.agent ?? new CannedAgentLLM(),
    overrides.completion ?? new ImmediateCompletionSink(),
    { now: () => new Date(NOW) },
    new SequentialIdGenerator(),
    {
      log: () => {},
      timeouts: {
        llmMs: TIMEOUT_MS,
        mailFetchMs: TIMEOUT_MS,
        draftCreateMs: TIMEOUT_MS,
        completionMs: TIMEOUT_MS
      }
    } as ConstructorParameters<typeof HandoffService>[7]
  );
}

async function seed(
  jobs: InMemoryHandoffJobRepository,
  suffix: string
): Promise<HandoffJobRecord> {
  const request: HandoffStartRequest = {
    schema_version: "1.0",
    request_id: `req_${suffix}`,
    source: "ios_app",
    include_gmail: true,
    gmail_account_id: "demo",
    open_loops: [],
    response_channel: "imessage",
    timezone: "Asia/Shanghai",
    locale: "zh-CN"
  };
  const job: HandoffJob = {
    schema_version: "1.0",
    request_id: request.request_id,
    job_id: `hj_${suffix}`,
    status: "queued",
    estimated_wait_seconds: 20,
    micro_reset_available: true
  };
  const state: HandoffJobState = {
    schema_version: "1.0",
    request_id: request.request_id,
    job_id: job.job_id,
    status: "queued",
    progress_stage: "queued",
    estimated_wait_seconds: 20,
    summary: null,
    error: null
  };
  const record = {
    job,
    request,
    state,
    idempotencyKey: `idem_${suffix}`,
    createdAt: NOW,
    updatedAt: NOW,
    cancelled: false
  };
  await jobs.create(record);
  return record;
}

async function expectTimeoutToSettle(
  processing: Promise<void>
): Promise<void> {
  let settled = false;
  void processing.finally(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
  await Promise.resolve();
  await Promise.resolve();
  expect(settled).toBe(true);
  await processing;
}

class NeverAgent extends CannedAgentLLM {
  override async summarizeHandoff(): Promise<HandoffSummaryDraft> {
    return new Promise(() => {});
  }
}

class NeverMailProvider implements MailProvider {
  constructor(private readonly never: "fetch" | "draft") {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(): Promise<MailItem[]> {
    if (this.never === "fetch") {
      return new Promise(() => {});
    }
    return [mailItem()];
  }

  async createDraft(): Promise<DraftResult> {
    if (this.never === "draft") {
      return new Promise(() => {});
    }
    return { draftId: "immediate-draft" };
  }
}

class NeverCompletionSink implements HandoffCompletionSink {
  async notify(): Promise<void> {
    return new Promise(() => {});
  }
}

class AbortableAgent extends CannedAgentLLM {
  constructor(
    private readonly operation: AbortGate<HandoffSummaryDraft>
  ) {
    super();
  }

  override async summarizeHandoff(
    _input: HandoffAgentInput,
    options?: ProviderCallOptions
  ): Promise<HandoffSummaryDraft> {
    return this.operation.run(options);
  }
}

class AbortableMailProvider implements MailProvider {
  constructor(
    private readonly fetchOperation: AbortGate<MailItem[]> | null,
    private readonly draftOperation: AbortGate<DraftResult> | null
  ) {}

  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(
    _context: MailFetchContext,
    options?: ProviderCallOptions
  ): Promise<MailItem[]> {
    return this.fetchOperation
      ? this.fetchOperation.run(options)
      : [mailItem()];
  }

  async createDraft(
    _request: DraftRequest,
    options?: ProviderCallOptions
  ): Promise<DraftResult> {
    return this.draftOperation
      ? this.draftOperation.run(options)
      : { draftId: "immediate-draft" };
  }
}

class AbortableCompletionSink implements HandoffCompletionSink {
  constructor(private readonly operation: AbortGate<void>) {}

  async notify(
    _record: HandoffJobRecord,
    options?: ProviderCallOptions
  ): Promise<void> {
    return this.operation.run(options);
  }
}

class AbortGate<T> {
  private readonly started = deferred<void>();
  private readonly gate = deferred<T>();
  signal: AbortSignal | undefined;
  aborted = false;

  constructor(private readonly releasedValue: T) {}

  run(options?: ProviderCallOptions): Promise<T> {
    this.signal = options?.signal;
    this.started.resolve();
    if (this.signal) {
      if (this.signal.aborted) {
        this.aborted = true;
        return Promise.reject(this.signal.reason);
      }
      this.signal.addEventListener(
        "abort",
        () => {
          this.aborted = true;
          this.gate.reject(this.signal?.reason);
        },
        { once: true }
      );
    }
    return this.gate.promise;
  }

  waitUntilStarted(): Promise<void> {
    return this.started.promise;
  }

  release(): void {
    this.gate.resolve(this.releasedValue);
  }
}

class ImmediateMailProvider implements MailProvider {
  async health(): Promise<ProviderHealth> {
    return "ready";
  }

  async fetchUnread(): Promise<MailItem[]> {
    return [mailItem()];
  }

  async createDraft(): Promise<DraftResult> {
    return { draftId: "immediate-draft" };
  }
}

class ImmediateCompletionSink implements HandoffCompletionSink {
  async notify(): Promise<void> {}
}

class SequentialIdGenerator implements IdGenerator {
  private value = 0;

  next(prefix: string): string {
    this.value += 1;
    return `${prefix}_${this.value}`;
  }
}

function mailItem(): MailItem {
  return {
    id: "mail_timeout",
    threadId: "thread_timeout",
    from: "sender@example.com",
    replyTo: null,
    subject: "明天确认",
    receivedAt: NOW,
    plainText: "明天请确认。"
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolver, rejecter) => {
    resolve = resolver;
    reject = rejecter;
  });
  return { promise, resolve, reject };
}
