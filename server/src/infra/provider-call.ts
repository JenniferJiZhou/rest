export interface ProviderTimeoutInput<T> {
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutError(): Error;
  operation(signal: AbortSignal): Promise<T>;
}

export class ProviderCallAbortedError extends Error {
  constructor(cause?: unknown) {
    super("Provider call aborted.", { cause });
    this.name = "ProviderCallAbortedError";
  }
}

export async function withProviderTimeout<T>(
  input: ProviderTimeoutInput<T>
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectBoundary!: (reason: unknown) => void;
  const boundary = new Promise<never>((_resolve, reject) => {
    rejectBoundary = reject;
  });

  const abortFromParent = (): void => {
    const error = new ProviderCallAbortedError(input.signal?.reason);
    controller.abort(error);
    rejectBoundary(error);
  };

  if (input.signal?.aborted) {
    abortFromParent();
  } else {
    input.signal?.addEventListener("abort", abortFromParent, {
      once: true
    });
  }

  if (!controller.signal.aborted) {
    timeout = setTimeout(() => {
      const error = input.timeoutError();
      controller.abort(error);
      rejectBoundary(error);
    }, input.timeoutMs);
  }

  try {
    return await Promise.race([
      input.operation(controller.signal),
      boundary
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    input.signal?.removeEventListener("abort", abortFromParent);
  }
}
