import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const execute = promisify(execFile);
const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), "nova-compose-check-"));
const binary = process.env.COMPOSE_BIN ?? "docker";
const prefix = process.env.COMPOSE_BIN ? [] : ["compose"];
try {
  const fixture = path.join(temporary, ".env.integration");
  await writeFile(fixture, await readFile("infra/local.env.example", "utf8"));
  const profile = async (files) => {
    const args = [
      ...prefix,
      "--project-directory",
      temporary,
      "--env-file",
      fixture,
    ];
    for (const file of files) args.push("-f", path.join(root, file));
    const result = await execute(
      binary,
      [...args, "config", "--format", "json"],
      {
        env: {
          ...process.env,
          NOVA_LOCAL_DB_PASSWORD: "synthetic-compose-validation-only",
        },
        timeout: 10000,
      },
    );
    return JSON.parse(result.stdout);
  };
  const base = await profile(["compose.yaml"]);
  assert.equal(base.services.web.environment.SERVICES_ENABLED, "false");
  assert.equal(base.services.web.read_only, true);
  assert.ok(base.services.web.cap_drop.includes("ALL"));
  assert.equal(base.services.web.ports[0].host_ip, "127.0.0.1");
  const integrated = await profile(["compose.yaml", "compose.integrated.yaml"]);
  assert.equal(integrated.services.web.environment.SERVICES_ENABLED, "true");
  assert.equal(
    integrated.services.web.environment.SMTP_ALLOW_INSECURE_LOCAL,
    "true",
  );
  assert.equal(integrated.services.web.environment.CLAMAV_HOST, "scanner");
  assert.ok(!integrated.services.scanner.ports?.length);
  const scannerPolicy = JSON.parse(
    await readFile("infra/scanner/policy.json", "utf8"),
  );
  const scannerEnvironment = {
    ...Object.fromEntries(
      Object.entries(scannerPolicy.clamd).map(([key, value]) => [
        `CLAMD_CONF_${key}`,
        value,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(scannerPolicy.freshclam).map(([key, value]) => [
        `FRESHCLAM_CONF_${key}`,
        value,
      ]),
    ),
    FRESHCLAM_CHECKS: scannerPolicy.updateChecks,
    CLAMD_CONF_TCPAddr: "0.0.0.0",
  };
  assert.deepEqual(
    integrated.services.scanner.environment,
    scannerEnvironment,
    "Compose scanner must render the complete shared policy without bypasses",
  );

  assert.ok(
    !integrated.services.database,
    "Integrated Supabase storage must use the Supabase database, not a disconnected application database",
  );
  const database = await profile(["compose.database.yaml"]);
  assert.equal(database.services.database.ports[0].host_ip, "127.0.0.1");
  for (const configuration of [integrated, database])
    for (const service of Object.values(configuration.services)) {
      if (service.image && service.image !== "nova-capital:local")
        assert.match(service.image, /@sha256:[a-f0-9]{64}$/);
    }
  console.log(
    "Public-shell, integrated Supabase helpers and separate database-rehearsal Compose profiles validate with synthetic fixtures; no daemon or services were used.",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
