import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer, createConnection } from "node:net";
import { randomBytes } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";
const execute = promisify(execFile);
assert.equal(process.argv.length, 2, "No target/daemon arguments are accepted");
assert.notEqual(process.getuid?.(), 0, "Run scanner verification unprivileged");
const safePath = async (value) => {
  assert.ok(
    value && path.isAbsolute(value),
    "Supply explicit reviewed scanner tool/database paths",
  );
  const resolved = await realpath(value);
  assert.match(
    resolved,
    /^[/a-zA-Z0-9_.-]+$/,
    "Scanner paths cannot contain whitespace or config metacharacters",
  );
  return resolved;
};
const binary = await safePath(process.env.CLAMD_BIN);
const database = await safePath(process.env.CLAMAV_DATABASE_DIR);
const certificates = process.env.CLAMAV_CERTS_DIR
  ? await safePath(process.env.CLAMAV_CERTS_DIR)
  : undefined;
for (const name of ["daily.cvd", "main.cvd", "bytecode.cvd"]) {
  const archive = await stat(path.join(database, name));
  assert.ok(
    archive.isFile() && archive.size > 512,
    "Official definition archives are required",
  );
}
const root = process.cwd();
const policy = JSON.parse(
  await readFile(path.join(root, "infra/scanner/policy.json"), "utf8"),
);
assert.ok(
  Object.entries(policy.clamd).every(
    ([key, value]) =>
      /^[A-Za-z]+$/.test(key) &&
      typeof value === "string" &&
      /^[A-Za-z0-9]+$/.test(value),
  ),
  "Invalid scanner policy",
);

const temporary = await mkdtemp(path.join(tmpdir(), "nova-native-scanner-"));
const marker = randomBytes(24).toString("hex");
const socketPath = path.join(temporary, "clamd.sock");
let daemon,
  tests,
  interrupted = false,
  stage = "configuration";
const interrupt = () => {
  interrupted = true;
  tests?.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ping = () =>
  new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let response = "";
    const finish = (error) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(response);
    };
    const timer = setTimeout(
      () => finish(Error("Scanner readiness deadline")),
      500,
    );
    socket.on("error", finish);
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (data) => {
      response += data.toString();
      if (response.length > 100) finish(Error("Invalid readiness response"));
      else if (response.includes("\0")) finish();
    });
  });
try {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const config = path.join(temporary, "clamd.conf");
  await writeFile(path.join(temporary, "marker"), marker, { mode: 0o600 });
  await writeFile(
    config,
    [
      "Foreground yes",
      `DatabaseDirectory ${database}`,
      ...(certificates ? [`CVDCertsDirectory ${certificates}`] : []),
      `TCPSocket ${port}`,
      "TCPAddr 127.0.0.1",
      `LocalSocket ${socketPath}`,
      `PidFile ${temporary}/clamd.pid`,
      `LogFile ${temporary}/clamd.log`,
      `TemporaryDirectory ${temporary}`,
      ...Object.entries(policy.clamd).map(([key, value]) => `${key} ${value}`),
      "ReadTimeout 5",
      "CommandReadTimeout 5",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  stage = "engine version";
  const version = await execute(
    binary,
    [`--config-file=${config}`, "--version"],
    { timeout: 5000 },
  );
  assert.match(
    version.stdout,
    /^ClamAV 1\.5\.4\b/,
    "This local check is reviewed for ClamAV 1.5.4",
  );
  stage = "owned daemon startup";
  daemon = spawn(binary, [`--config-file=${config}`], {
    stdio: "ignore",
    env: {
      ...process.env,
      ...(certificates ? { CVD_CERTS_DIR: certificates } : {}),
    },
  });
  let daemonError;
  daemon.once("error", (error) => {
    daemonError = error;
  });
  let ready = false;
  for (let attempt = 0; attempt < 180 && !interrupted; attempt++) {
    assert.ok(
      !daemonError && daemon.exitCode === null && daemon.signalCode === null,
      "Owned scanner exited before readiness",
    );
    try {
      if (
        (await ping()) === "PONG\0" &&
        Number(
          (await readFile(path.join(temporary, "clamd.pid"), "utf8")).trim(),
        ) === daemon.pid
      ) {
        ready = true;
        break;
      }
    } catch {}
    await wait(500);
  }
  assert.ok(
    ready && !interrupted,
    "Owned scanner readiness was not established",
  );
  stage = "adapter and publication checks";
  const fixture = path.join(temporary, "fixture.json");
  await writeFile(
    fixture,
    JSON.stringify({ marker, host: "127.0.0.1", port, pid: daemon.pid }),
    { mode: 0o600 },
  );
  assert.ok(!interrupted, "Native scanner verification interrupted");
  tests = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.scanner.config.ts",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NOVA_SCANNER_TEST_FIXTURE: fixture },
    },
  );
  const code = await new Promise((resolve, reject) => {
    tests.once("error", reject);
    tests.once("exit", resolve);
  });
  assert.equal(code, 0, "Native scanner tests failed");
  assert.ok(
    daemon.exitCode === null && daemon.signalCode === null,
    "Scanner stopped during tests",
  );
  console.log(
    "Owned ClamAV 1.5.4 adapter/engine checks passed with official databases; hosted freshness, image and end-to-end verification remain separate.",
  );
} catch {
  console.error(
    `Native scanner verification failed during ${stage}. No file publication is authorized by a failed check.`,
  );
  process.exitCode = 1;
} finally {
  const stop = async (child) => {
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await stopped;
    clearTimeout(timer);
  };
  await stop(tests);
  await stop(daemon);
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await rm(temporary, { recursive: true, force: true });
  console.log(
    "Owned scanner process, socket, config and fixture removed; reviewed input tools/databases were preserved.",
  );
}
