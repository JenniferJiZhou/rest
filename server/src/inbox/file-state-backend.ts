import { randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync
} from "node:fs";
import {
  chmod,
  open,
  rename,
  unlink
} from "node:fs/promises";
import { dirname } from "node:path";
import type {
  InboxPersistedState,
  InboxStateBackend
} from "./state-backend.js";
import {
  emptyInboxPersistedState,
  inboxPersistedStateSchema
} from "./state-backend.js";

const SANITIZED_STATE_ERROR =
  "Invalid Inbox state configuration. Preserve the state file for manual recovery.";

export class FileInboxStateBackend implements InboxStateBackend {
  private state: InboxPersistedState = emptyInboxPersistedState();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    this.initialize();
  }

  static async open(filePath: string): Promise<FileInboxStateBackend> {
    return new FileInboxStateBackend(filePath);
  }

  async read<T>(
    reader: (state: Readonly<InboxPersistedState>) => T
  ): Promise<T> {
    await this.mutationQueue;
    return reader(structuredClone(this.state));
  }

  async mutate<T>(
    mutation: (state: InboxPersistedState) => {
      state: InboxPersistedState;
      value: T;
    }
  ): Promise<T> {
    const transaction = this.mutationQueue.then(async () => {
      const result = mutation(structuredClone(this.state));
      const validated = inboxPersistedStateSchema.parse(result.state);
      await this.persist(validated);
      this.state = validated;
      return structuredClone(result.value);
    });
    this.mutationQueue = transaction.then(
      () => undefined,
      () => undefined
    );
    return transaction;
  }

  private initialize(): void {
    try {
      mkdirSync(dirname(this.filePath), {
        recursive: true,
        mode: 0o700
      });
      chmodSync(dirname(this.filePath), 0o700);
      let contents: string;
      try {
        contents = readFileSync(this.filePath, "utf8");
      } catch (error) {
        if (isMissingFile(error)) {
          this.state = emptyInboxPersistedState();
          return;
        }
        throw error;
      }
      chmodSync(this.filePath, 0o600);
      this.state = inboxPersistedStateSchema.parse(JSON.parse(contents));
    } catch {
      throw new Error(SANITIZED_STATE_ERROR);
    }
  }

  private async persist(state: InboxPersistedState): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let temporaryFile:
      | Awaited<ReturnType<typeof open>>
      | undefined;
    try {
      temporaryFile = await open(temporaryPath, "wx", 0o600);
      await temporaryFile.writeFile(JSON.stringify(state), "utf8");
      await temporaryFile.sync();
      await temporaryFile.close();
      temporaryFile = undefined;
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
      await this.syncParentDirectory();
    } catch (error) {
      if (temporaryFile) {
        await temporaryFile.close().catch(() => undefined);
      }
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  private async syncParentDirectory(): Promise<void> {
    if (process.platform === "win32") {
      return;
    }
    const directory = await open(dirname(this.filePath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
