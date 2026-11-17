import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { it, expect } from "vitest";
const execute = promisify(execFile);
it("runs the operational scheduler through authenticated HTTP and drains repeatable batches without printing its token", async () => {
  const secret = "synthetic-command-line-maintenance-test-token";
  const requests: { method?: string; url?: string; authorization?: string }[] =
    [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        expiredOffers: requests.length === 1 ? 500 : 3,
        mayHaveMore: requests.length === 1,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const result = await execute(
      process.execPath,
      ["scripts/run-maintenance.mjs"],
      {
        env: {
          ...process.env,
          APP_ENV: "test",
          SCHEDULER_PROVIDER: "local",
          APP_URL: `http://127.0.0.1:${port}`,
          CRON_SECRET: secret,
        },
        timeout: 5000,
      },
    );
    expect(requests).toEqual(
      Array.from({ length: 2 }, () => ({
        method: "POST",
        url: "/api/maintenance",
        authorization: `Bearer ${secret}`,
      })),
    );
    expect(result.stdout).toContain('"expiredOffers":503');
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).toBe("");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("rejects remote cleartext and unsafe hosted watch profiles before sending credentials", async () => {
  for (const env of [
    {
      APP_ENV: "test",
      APP_URL: "http://example.test",
      SCHEDULER_PROVIDER: "external",
    },
    {
      APP_ENV: "production",
      APP_URL: "https://example.test",
      SCHEDULER_PROVIDER: "local",
    },
  ])
    await expect(
      execute(process.execPath, ["scripts/run-maintenance.mjs"], {
        env: {
          ...process.env,
          ...env,
          CRON_SECRET: "synthetic-command-line-maintenance-test-token",
        },
        timeout: 5000,
      }),
    ).rejects.toMatchObject({ code: 1 });
});
