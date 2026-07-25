import { CONTRACT_VERSION } from "../domain/contracts.js";
import type { IdGenerator } from "../domain/ports.js";
import type { InboxService } from "../application/inbox/inbox-service.js";
import type {
  CheckpointStore,
  InboxSource
} from "./ports.js";

export interface ConnectorAccount {
  source: InboxSource;
  accountId: string;
}

export class ConnectorHost {
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private recovered = false;
  private generation = 0;
  private inFlight: Promise<void> | null = null;
  private readonly batchLimit: number;
  private readonly failures = new Map<
    string,
    { count: number; retryAt: number }
  >();

  constructor(
    private readonly accounts: ConnectorAccount[],
    private readonly inbox: Pick<InboxService, "ingest"> &
      Partial<Pick<InboxService, "recover">>,
    private readonly checkpoints: CheckpointStore,
    private readonly ids: IdGenerator,
    private readonly pollIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly syncTimeoutMs = 30_000,
    syncBatchLimit = 100
  ) {
    this.batchLimit = Number.isFinite(syncBatchLimit)
      ? Math.min(Math.max(Math.trunc(syncBatchLimit), 1), 100)
      : 100;
  }

  async runOnce(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const operation = Promise.all(
      this.accounts.map((account) => this.syncAccount(account))
    ).then(() => undefined);
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    }
  }

  start(): void {
    if (this.started) {
      throw new Error("ConnectorHost already started.");
    }
    this.started = true;
    this.generation += 1;
    void this.runLoop(this.generation);
  }

  async stop(): Promise<void> {
    this.started = false;
    this.generation += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inFlight;
  }

  private async runLoop(generation: number): Promise<void> {
    if (!this.recovered) {
      try {
        await this.inbox.recover?.();
        this.recovered = true;
      } catch {
        this.started = false;
        return;
      }
    }
    await this.runOnce();
    if (!this.started || generation !== this.generation) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runLoop(generation);
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  private async syncAccount(account: ConnectorAccount): Promise<void> {
    const key = JSON.stringify([
      account.source.provider,
      account.accountId
    ]);
    const failure = this.failures.get(key);
    if (failure && failure.retryAt > this.now()) {
      return;
    }
    try {
      const checkpoint = await this.checkpoints.get(
        account.source.provider,
        account.accountId
      );
      const controller = new AbortController();
      const pulled = await withTimeout(
        account.source.pull(
          {
            accountId: account.accountId,
            checkpoint,
            limit: this.batchLimit
          },
          { signal: controller.signal }
        ),
        this.syncTimeoutMs,
        () => controller.abort()
      );
      await this.inbox.ingest(
        {
          schema_version: CONTRACT_VERSION,
          request_id: this.ids.next("connector"),
          checkpoint: pulled.checkpoint,
          events: pulled.items
        },
        pulled.participantBindings
      );
      await this.checkpoints.put(
        account.source.provider,
        account.accountId,
        pulled.checkpoint
      );
      this.failures.delete(key);
    } catch {
      const count = (failure?.count ?? 0) + 1;
      const delay = Math.min(
        this.pollIntervalMs * 2 ** count,
        5 * 60 * 1_000
      );
      this.failures.set(key, {
        count,
        retryAt: this.now() + delay
      });
      await this.checkpoints.recordFailure(
        account.source.provider,
        account.accountId,
        "provider_sync_failed"
      );
    }
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error("connector_sync_timeout"));
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
