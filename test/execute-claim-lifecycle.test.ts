import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

describe("claim execution CLI context lifecycle", () => {
  it("keeps the context open until claim execution resolves", async () => {
    const execution = deferred<string>();
    const executeClaim = vi.fn().mockReturnValue(execution.promise);
    const close = vi.fn().mockResolvedValue(undefined);

    const command = executeWithContext(executeClaim, close);

    expect(executeClaim).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    execution.resolve("CONFIRMED");
    await expect(command).resolves.toBe("CONFIRMED");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes the context only after claim execution rejects", async () => {
    const execution = deferred<string>();
    const executeClaim = vi.fn().mockReturnValue(execution.promise);
    const close = vi.fn().mockResolvedValue(undefined);
    const failure = new Error("claim execution failed");

    const command = executeWithContext(executeClaim, close);

    expect(executeClaim).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    execution.reject(failure);
    await expect(command).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it("requires execute-claim to await execution inside its try/finally", async () => {
    const source = await readFile(
      new URL("../src/cli/execute-claim.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("return await executeClaim({");
    expect(source).not.toMatch(/return\s+executeClaim\s*\(/u);
  });
});

async function executeWithContext<T>(
  executeClaim: () => Promise<T>,
  close: () => Promise<void>,
): Promise<T> {
  try {
    return await executeClaim();
  } finally {
    await close();
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
