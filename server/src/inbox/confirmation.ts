import { createHash, randomBytes } from "node:crypto";
import type { ConfirmationTokenStore } from "./ports.js";

interface ConfirmationRecord {
  draftId: string;
  version: number;
  principalId: string;
  expiresAt: number;
}

export class InMemoryConfirmationTokenStore
  implements ConfirmationTokenStore
{
  private readonly records = new Map<string, ConfirmationRecord>();

  constructor(
    private readonly now: () => Date = () => new Date()
  ) {}

  async issue(
    draftId: string,
    version: number,
    principalId: string
  ): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now().getTime() + 5 * 60 * 1_000;
    this.records.set(digest(token), {
      draftId,
      version,
      principalId,
      expiresAt
    });
    return {
      token,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  async consume(
    token: string,
    draftId: string,
    version: number,
    principalId: string
  ): Promise<boolean> {
    const key = digest(token);
    const record = this.records.get(key);
    this.records.delete(key);
    return (
      record !== undefined &&
      record.expiresAt > this.now().getTime() &&
      record.draftId === draftId &&
      record.version === version &&
      record.principalId === principalId
    );
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
