import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const execute = promisify(execFile);
const docker = async (...args) =>
  (
    await execute("docker", args, { timeout: 30000, maxBuffer: 262144 })
  ).stdout.trim();
const image = process.env.CONTAINER_IMAGE ?? "nova-capital:verify-local";
const name = `nova-check-${randomUUID()}`;
let created = false;
try {
  const endpoint =
    process.env.DOCKER_HOST ??
    JSON.parse(
      await docker(
        "context",
        "inspect",
        "--format",
        "{{json .Endpoints.docker.Host}}",
      ),
    );
  assert.ok(
    endpoint.startsWith("unix://") || endpoint.startsWith("npipe://"),
    "Container checks require a local Docker endpoint",
  );
  const configuration = JSON.parse(await docker("image", "inspect", image))[0]
    .Config;
  assert.equal(
    configuration.User,
    "node",
    "Runtime must use the non-root application user",
  );
  assert.deepEqual(configuration.Cmd, ["node", "scripts/standalone-entry.mjs"]);
  assert.ok(
    !configuration.Env.some((value) =>
      /^(SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|SMTP_PASSWORD|OPENAI_API_KEY|CRON_SECRET|CONTACT_HASH_SECRET|ENTRA_CLIENT_SECRET|ENTRA_DIRECTORY_CLIENT_SECRET|ENTRA_MFA_ENCRYPTION_KEYS|AZURE_MONITOR_CONNECTION_STRING)=/.test(
        value,
      ),
    ),
    "Runtime image must not contain service credentials",
  );
  await docker(
    "run",
    "--detach",
    "--name",
    name,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--tmpfs",
    "/tmp:rw,size=128m,mode=1777",
    "--tmpfs",
    "/app/.next/cache:rw,size=64m,uid=1000,gid=1000,mode=0700",
    "--publish",
    "127.0.0.1::3000",
    "--env",
    "APP_ENV=test",
    "--env",
    "SERVICES_ENABLED=false",
    "--env",
    "SECRETS_PROVIDER=env",
    image,
  );
  created = true;
  const binding = await docker("port", name, "3000/tcp");
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const origin = `http://${binding}`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        const health = await response.json();
        assert.equal(health.mode, "public-shell");
        assert.equal(health.dependenciesVerified, false);
        ready = true;
        break;
      }
    } catch {
      /* Poll only this owned container. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Container did not become ready");
  assert.equal((await fetch(`${origin}/contact`)).status, 200);
  assert.equal((await fetch(`${origin}/api/portal/portfolio`)).status, 503);
  const rejected = await fetch(`${origin}/api/contact`, {
    method: "POST",
    headers: {
      Origin: "https://attacker.example.test",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  console.log(
    "Built container passed non-root/read-only startup, credential-free image configuration and HTTP isolation checks.",
  );
} finally {
  if (created) await docker("rm", "--force", name);
}
