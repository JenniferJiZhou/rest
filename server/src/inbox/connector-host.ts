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

  constructor(
    private readonly accounts: ConnectorAccount[],
    private readonly inbox: Pick<InboxService, "ingest">,
    private readonly checkpoints: CheckpointStore,
    private readonly ids: IdGenerator,
    private readonly pollIntervalMs: number
  ) {}

  async runOnce(): Promise<void> {
    for (const account of this.accounts) {
      try {
        const checkpoint = await this.checkpoints.get(
          account.source.provider,
          account.accountId
        );
        const pulled = await account.source.pull({
          accountId: account.accountId,
          checkpoint,
          limit: 100
        });
        await this.inbox.ingest({
          schema_version: CONTRACT_VERSION,
          request_id: this.ids.next("connector"),
          checkpoint: pulled.checkpoint,
          events: pulled.items
        });
        await this.checkpoints.put(
          account.source.provider,
          account.accountId,
          pulled.checkpoint
        );
      } catch {
        await this.checkpoints.recordFailure(
          account.source.provider,
          account.accountId,
          "provider_sync_failed"
        );
      }
    }
  }

  start(): void {
    if (this.timer) {
      throw new Error("ConnectorHost already started.");
    }
    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.pollIntervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }
}
