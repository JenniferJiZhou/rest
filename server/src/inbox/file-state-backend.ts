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
const SANITIZED_PERSISTENCE_ERROR =
  "Unable to persist Inbox state safely. Restart Hush before retrying.";

interface FileInboxStateBackendDependencies {
  syncParentDirectory?: (directoryPath: string) => Promise<void>;
}

export class FileInboxStateBackend implements InboxStateBackend {
  private state: InboxPersistedState = emptyInboxPersistedState();
  private mutationQueue: Promise<void> = Promise.resolve();
  private mutationsPoisoned = false;
  private readonly syncDirectory: (directoryPath: string) => Promise<void>;

  constructor(
    private readonly filePath: string,
    dependencies: FileInboxStateBackendDependencies = {}
  ) {
    this.syncDirectory =
      dependencies.syncParentDirectory ?? syncParentDirectory;
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
      if (this.mutationsPoisoned) {
        throw persistenceError();
      }
      const result = mutation(structuredClone(this.state));
      const validated = inboxPersistedStateSchema.parse(result.state);
      try {
        await this.persist(validated);
      } catch (error) {
        if (error instanceof PostRenamePersistenceError) {
          this.state = validated;
          this.mutationsPoisoned = true;
        }
        throw persistenceError();
      }
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
      const parentDirectory = dirname(this.filePath);
      const createdDirectory = mkdirSync(parentDirectory, {
        recursive: true,
        mode: 0o700
      });
      if (createdDirectory !== undefined) {
        chmodSync(parentDirectory, 0o700);
      }
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
      const parsed = inboxPersistedStateSchema.parse(JSON.parse(contents));
      chmodSync(this.filePath, 0o600);
      this.state = parsed;
    } catch {
      throw new Error(SANITIZED_STATE_ERROR);
    }
  }

  private async persist(state: InboxPersistedState): Promise<void> {
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let renamed = false;
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
      renamed = true;
      await chmod(this.filePath, 0o600);
      await this.syncDirectory(dirname(this.filePath));
    } catch {
      if (temporaryFile) {
        await temporaryFile.close().catch(() => undefined);
      }
      await unlink(temporaryPath).catch(() => undefined);
      if (renamed) {
        throw new PostRenamePersistenceError();
      }
      throw persistenceError();
    }
  }
}

class PostRenamePersistenceError extends Error {}

function persistenceError(): Error {
  return new Error(SANITIZED_PERSISTENCE_ERROR);
}

async function syncParentDirectory(directoryPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
