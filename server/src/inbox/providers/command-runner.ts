import { execFile } from "node:child_process";
import { AppError } from "../../domain/errors.js";

export interface CommandInvocation {
  executable: string;
  args: string[];
  timeoutMs?: number;
  input?: string;
  ambiguousOnTimeout?: boolean;
}

export interface CommandRunner {
  run(invocation: CommandInvocation): Promise<string>;
}

export class ExecFileCommandRunner implements CommandRunner {
  async run(invocation: CommandInvocation): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        invocation.executable,
        invocation.args,
        {
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          shell: false,
          timeout: invocation.timeoutMs ?? 30_000
        },
        (error, stdout) => {
          if (error) {
            if (
              invocation.ambiguousOnTimeout &&
              (error.killed ||
                error.signal !== null ||
                error.code === "ETIMEDOUT")
            ) {
              reject(
                new AppError({
                  code: "INBOX_SEND_UNKNOWN",
                  message: "渠道发送结果未知，请先核对原渠道。",
                  statusCode: 503,
                  retryable: false,
                  details: { reason: "command_timeout" }
                })
              );
              return;
            }
            reject(
              new AppError({
                code: "INBOX_PROVIDER_UNAVAILABLE",
                message: "本机渠道命令执行失败。",
                statusCode: 503,
                retryable: true,
                details: { reason: "command_failed" }
              })
            );
            return;
          }
          resolve(stdout);
        }
      );
      if (invocation.input !== undefined) {
        child.stdin?.end(invocation.input);
      }
    });
  }
}
