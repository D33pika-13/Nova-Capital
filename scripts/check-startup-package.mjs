import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import path from "node:path";
import { withStandaloneCopy } from "./package-check-helpers.mjs";

async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
let stage = "package copy";
async function check(
  root,
  fail,
  entra = false,
  monitor = false,
  manualSignal = false,
) {
  stage = monitor
    ? "Azure Monitor startup"
    : entra
      ? "Entra startup"
      : fail
        ? "vault rejection"
        : "shell startup";
  const selectedPort = await port();
  const base = `http://127.0.0.1:${selectedPort}`;
  // Never inherit runtime credentials/identities or .env files into this check.
  const secret = "synthetic-startup-secret-must-not-be-logged";
  const child = spawn(
    process.execPath,
    [path.join(root, "scripts/standalone-entry.mjs")],
    {
      cwd: root,
      env: {
        NODE_ENV: "production",
        APP_ENV: "test",
        SERVICES_ENABLED: entra ? "true" : "false",
        APP_URL: entra ? "https://app.example.test" : base,
        ...(entra
          ? {
              AUTH_PROVIDER: "entra",
              STORAGE_PROVIDER: "azure",
              DATABASE_URL:
                "postgresql://synthetic:synthetic@127.0.0.1:1/synthetic",
              SMTP_HOST: "127.0.0.1",
              EMAIL_FROM: "test@example.test",
              SUPPORT_EMAIL: "support@example.test",
              CLAMAV_HOST: "127.0.0.1",
              AZURE_STORAGE_ACCOUNT_NAME: "syntheticnova",
              AZURE_STORAGE_ACCOUNT_RESOURCE_ID:
                "/subscriptions/40000000-0000-4000-8000-000000000004/resourceGroups/synthetic/providers/Microsoft.Storage/storageAccounts/syntheticnova",
              ENTRA_TENANT_ID: "40000000-0000-4000-8000-000000000004",
              ENTRA_CLIENT_ID: "50000000-0000-4000-8000-000000000005",
              ENTRA_TENANT_SUBDOMAIN: "synthetic",
              ENTRA_CLIENT_SECRET: secret,
              ENTRA_MFA_ISSUER: "Synthetic",
              ENTRA_MFA_ACTIVE_KEY_ID: "current",
              ENTRA_MFA_ENCRYPTION_KEYS: JSON.stringify({
                current: randomBytes(32).toString("base64url"),
              }),
              ENTRA_DIRECTORY_CLIENT_ID: "60000000-0000-4000-8000-000000000006",
              ENTRA_DIRECTORY_CLIENT_SECRET: secret,
              ENTRA_RECOVERY_MODE: "hosted_sspr",
            }
          : {}),
        HOSTNAME: "127.0.0.1",
        PORT: String(selectedPort),
        ...(manualSignal ? { NEXT_MANUAL_SIG_HANDLE: "true" } : {}),
        SECRETS_PROVIDER: fail ? "azure_key_vault" : "env",
        ...(monitor
          ? {
              OBSERVABILITY_PROVIDER: "azure_monitor",
              AZURE_MONITOR_CONNECTION_STRING:
                "InstrumentationKey=40000000-0000-4000-8000-000000000004;IngestionEndpoint=https://westus2-0.in.applicationinsights.azure.com",
              APPLICATION_INSIGHTS_NO_STATSBEAT: "true",
            }
          : {}),
        ...(fail ? { SMTP_PASSWORD: secret } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (value) => {
    logs += value.toString();
  });
  child.stderr.on("data", (value) => {
    logs += value.toString();
  });
  try {
    let observed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) {
        assert.ok(fail || manualSignal, "Valid public-shell package exited");
        assert.notEqual(child.exitCode, 0);
        assert.match(logs, /Server configuration bootstrap failed/);
        observed = true;
        break;
      }
      if (!fail && !manualSignal) {
        try {
          const response = await fetch(`${base}/api/health`, {
            signal: AbortSignal.timeout(500),
          });
          if (response.ok) {
            assert.equal(
              (await response.json()).mode,
              entra ? "configured" : "public-shell",
            );
            observed = true;
            break;
          }
        } catch {
          /* Wait only for this live child to start. */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      observed,
      fail
        ? "Unresolved vault must fail startup"
        : "Package never became ready",
    );
    if (entra) {
      stage = "Entra login page";
      const login = await fetch(`${base}/login`);
      assert.equal(login.status, 200);
      const html = await login.text();
      assert.match(html, /action="\/auth\/entra\/start"/);
      assert.ok(!html.includes('type="password"'));
      stage = "Entra recovery page";
      const recovery = await fetch(`${base}/login?mode=reset`);
      assert.equal(recovery.status, 200);
      assert.match(await recovery.text(), /action="\/auth\/entra\/recover"/);
      stage = "Entra password redirect";
      const password = await fetch(`${base}/password`, { redirect: "manual" });
      if (password.status === 307) {
        assert.equal(password.headers.get("location"), "/login?mode=reset");
      } else {
        // Next's streaming layout emits a client redirect meta tag with HTTP 200.
        assert.equal(password.status, 200);
        const passwordHtml = await password.text();
        assert.match(
          passwordHtml,
          /<meta(?=[^>]*http-equiv="refresh")(?=[^>]*content="1;url=\/login\?mode=reset")[^>]*>/,
        );
        assert.ok(!passwordHtml.includes('type="password"'));
      }
      stage = "Entra unknown route";
      const unknown = await fetch(`${base}/auth/entra/unknown`, {
        method: "POST",
      });
      assert.equal(unknown.status, 404);
      assert.ok(!html.includes(secret), "Secret appeared in login HTML");
    }
    assert.ok(!logs.includes(secret), "Secret appeared in startup logs");
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}
try {
  await withStandaloneCopy(async (root) => {
    await check(root, false);
    await check(root, true);
    await check(root, false, true);
    await check(root, false, false, true);
    stage = "manual signal override rejection";
    await check(root, false, false, false, true);
  });
  console.log(
    "Isolated standalone startup validated public-shell, synthetic Entra page/route selection and Azure Monitor initialization, and rejected unresolved Key Vault config without leaking secrets.",
  );
} catch {
  console.error(`Standalone startup verification failed at ${stage}.`);
  process.exitCode = 1;
}
