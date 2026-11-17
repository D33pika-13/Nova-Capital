import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenCredential, GetTokenOptions } from "@azure/identity";
import {
  AzureMonitorCredential,
  monitorTokenScope,
} from "@/server/providers/azure-monitor-credential";
const token = () => ({
  token: "synthetic-monitor-access-token",
  expiresOnTimestamp: Date.now() + 3600000,
});
afterEach(() => vi.useRealTimers());
describe("bounded Monitor credential", () => {
  it.each([monitorTokenScope, [monitorTokenScope]])(
    "acquires only the fixed scope and drops caller/credential metadata",
    async (scope) => {
      const supplied = { ...token(), refreshAfterTimestamp: 42 },
        getToken = vi.fn(async () => supplied);
      const result = await new AzureMonitorCredential({ getToken }).getToken(
        scope,
        {
          tracingOptions: { tracingContext: {} as never },
          requestOptions: { timeout: 999999 },
          enableCae: true,
        },
      );
      expect(result).toEqual({
        token: supplied.token,
        expiresOnTimestamp: supplied.expiresOnTimestamp,
      });
      expect(result).not.toBe(supplied);
      expect(getToken).toHaveBeenCalledExactlyOnceWith(monitorTokenScope, {
        abortSignal: expect.any(AbortSignal),
      });
    },
  );
  it.each([
    "https://graph.microsoft.com/.default",
    "https://monitor.azure.com/.default",
    [],
    [monitorTokenScope, monitorTokenScope],
    null,
  ])(
    "rejects unselected or ambiguous scopes before credential access",
    async (scope) => {
      const getToken = vi.fn();
      await expect(
        new AzureMonitorCredential({ getToken }).getToken(
          scope as string | string[],
        ),
      ).rejects.toMatchObject({ code: "MONITOR_CREDENTIAL_UNAVAILABLE" });
      expect(getToken).not.toHaveBeenCalled();
    },
  );
  it.each([
    { claims: "private-challenge" },
    { tenantId: "foreign-tenant" },
    { abortSignal: AbortSignal.abort() },
  ])(
    "rejects challenge tenant/claims and pre-cancelled acquisition",
    async (options) => {
      const getToken = vi.fn();
      await expect(
        new AzureMonitorCredential({ getToken }).getToken(
          monitorTokenScope,
          options,
        ),
      ).rejects.toMatchObject({ code: "MONITOR_CREDENTIAL_UNAVAILABLE" });
      expect(getToken).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { ...token(), token: "short" },
    { ...token(), token: "invalid\r\nprivate-token" },
    { ...token(), token: "x".repeat(16385) },
    { ...token(), expiresOnTimestamp: Number.NaN },
    { ...token(), expiresOnTimestamp: 1 },
  ])(
    "rejects missing/malformed/expired token results privately",
    async (result) => {
      const getToken = vi.fn(async () => result);
      await expect(
        new AzureMonitorCredential({ getToken }).getToken(monitorTokenScope),
      ).rejects.toMatchObject({
        code: "MONITOR_CREDENTIAL_UNAVAILABLE",
        message: "Telemetry authentication is unavailable.",
      });
      expect(getToken).toHaveBeenCalledTimes(1);
    },
  );
  it("does not expose synchronous or asynchronous credential errors", async () => {
    for (const getToken of [
      vi.fn(() => {
        throw Error("private-provider-token");
      }),
      vi.fn(async () => {
        throw Error("private-provider-token");
      }),
    ]) {
      await expect(
        new AzureMonitorCredential({ getToken }).getToken(monitorTokenScope),
      ).rejects.toMatchObject({
        message: "Telemetry authentication is unavailable.",
      });
    }
  });
  it("aborts a hung noncooperative credential and discards its late completion", async () => {
    vi.useFakeTimers();
    let complete: (value: ReturnType<typeof token>) => void = () => {};
    let signal: GetTokenOptions["abortSignal"];
    const getToken: TokenCredential["getToken"] = async (_scope, options) => {
      signal = options?.abortSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    const pending = new AzureMonitorCredential({ getToken }, 20).getToken(
      monitorTokenScope,
    );
    const check = expect(pending).rejects.toMatchObject({
      code: "MONITOR_CREDENTIAL_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(21);
    await check;
    expect(signal?.aborted).toBe(true);
    complete(token());
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("forwards cancellation and removes its listener/timer", async () => {
    const controller = new AbortController(),
      remove = vi.spyOn(controller.signal, "removeEventListener");
    let signal: GetTokenOptions["abortSignal"];
    const getToken: TokenCredential["getToken"] = async (_scope, options) => {
      signal = options?.abortSignal;
      return new Promise(() => {});
    };
    const pending = new AzureMonitorCredential({ getToken }).getToken(
      monitorTokenScope,
      { abortSignal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "MONITOR_CREDENTIAL_UNAVAILABLE",
    });
    expect(signal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
  });
  it.each([0, -1, 3001, Number.NaN, 1.5])(
    "rejects an invalid acquisition deadline",
    (timeout) => {
      expect(
        () => new AzureMonitorCredential({ getToken: vi.fn() }, timeout),
      ).toThrow("AZURE_MONITOR_CREDENTIAL_TIMEOUT");
    },
  );
});
