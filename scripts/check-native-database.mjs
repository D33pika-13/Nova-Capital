import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { Client } from "pg";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import assert from "node:assert/strict";
const execute = promisify(execFile);
const options = process.argv.slice(2);
assert.ok(
  options.length === 0 || (options.length === 1 && options[0] === "--load"),
  "Only the fixed --load workload is supported; arbitrary targets are forbidden",
);
const load = options[0] === "--load";
const binary = process.env.POSTGRES_BIN_DIR;
assert.ok(binary, "Set POSTGRES_BIN_DIR to reviewed PostgreSQL 17 binaries");
assert.notEqual(
  process.getuid?.(),
  0,
  "Run native verification as an unprivileged user",
);
const clientBinary = path.resolve(
  process.env.POSTGRES_CLIENT_BIN_DIR ?? binary,
);
const root = process.cwd();
const temporary = await mkdtemp(path.join(tmpdir(), "nova-native-db-"));
const data = path.join(temporary, "data");
const nativeEnv = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };
const openssl = process.env.OPENSSL_BIN ?? "openssl";
const run = async (tool, args) =>
  execute(tool, args, {
    cwd: temporary,
    env: nativeEnv,
    timeout: 30000,
    maxBuffer: 131072,
  });
let server;
let tests;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  tests?.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  const version = await run(path.join(binary, "initdb"), ["--version"]);
  assert.match(version.stdout, /PostgreSQL\) 17\./);
  for (const name of ["pg_dump", "pg_restore"]) {
    const result = await run(path.join(clientBinary, name), ["--version"]);
    assert.match(
      result.stdout,
      /PostgreSQL\) 17\./,
      "Use reviewed PostgreSQL 17 dump/restore clients; set POSTGRES_CLIENT_BIN_DIR if separate",
    );
  }
  const ownerPassword = randomBytes(24).toString("hex");
  const runtimePassword = randomBytes(24).toString("hex");
  await writeFile(path.join(temporary, "password"), ownerPassword, {
    mode: 0o600,
  });
  await writeFile(
    path.join(temporary, "ca.cnf"),
    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n[dn]\nCN=NOVA synthetic native CA\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n",
  );
  await run(openssl, [
    "req",
    "-new",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-config",
    "ca.cnf",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
  ]);
  await run(openssl, [
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
  ]);
  await chmod(path.join(temporary, "server.key"), 0o600);
  await writeFile(
    path.join(temporary, "server.cnf"),
    "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n",
  );
  await run(openssl, [
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-days",
    "2",
    "-extfile",
    "server.cnf",
    "-out",
    "server.crt",
  ]);
  await run(path.join(binary, "initdb"), [
    "-D",
    data,
    "--username=nova_test_owner",
    `--pwfile=${path.join(temporary, "password")}`,
    "--auth=scram-sha-256",
    "--encoding=UTF8",
    "--locale=C",
  ]);
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const marker = `nova_native_${randomBytes(12).toString("hex")}`;
  server = spawn(
    path.join(binary, "postgres"),
    [
      "-D",
      data,
      "-h",
      "localhost",
      "-p",
      String(port),
      "-c",
      "unix_socket_directories=",
      "-c",
      `cluster_name=${marker}`,
      "-c",
      "ssl=on",
      "-c",
      `ssl_cert_file=${path.join(temporary, "server.crt")}`,
      "-c",
      `ssl_key_file=${path.join(temporary, "server.key")}`,
      "-c",
      "ssl_min_protocol_version=TLSv1.2",
    ],
    { cwd: temporary, env: nativeEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.resume();
  server.stderr.resume();
  let serverFailed = false;
  server.on("error", () => {
    serverFailed = true;
  });
  let ready = false;
  const ca = await readFile(path.join(temporary, "ca.crt"), "utf8");
  for (let attempt = 0; attempt < 100 && !interrupted; attempt++) {
    assert.equal(server.exitCode, null, "Owned native server exited");
    assert.ok(!serverFailed, "Owned native server could not start");
    const client = new Client({
      host: "localhost",
      port,
      database: "postgres",
      user: "nova_test_owner",
      password: ownerPassword,
      ssl: { ca, rejectUnauthorized: true, minVersion: "TLSv1.2" },
      connectionTimeoutMillis: 500,
      options: "-c search_path=public",
    });
    try {
      await client.connect();
      assert.equal(
        (await client.query("select current_setting('cluster_name') marker"))
          .rows[0].marker,
        marker,
      );
      ready = true;
      break;
    } catch {
    } finally {
      await client.end().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready && !interrupted, "Owned native server did not become ready");
  const fixture = path.join(temporary, "fixture.json");
  await writeFile(
    fixture,
    JSON.stringify({
      marker,
      port,
      clientBinary,
      ownerPassword,
      runtimePassword,
      caFile: path.join(temporary, "ca.crt"),
    }),
    { mode: 0o600 },
  );
  const args = [
    path.join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "--config",
    load ? "vitest.native-load.config.ts" : "vitest.native.config.ts",
  ];
  // The load file prints only fixed aggregate measurements, never fixtures.
  if (load) args.push("--disableConsoleIntercept");
  assert.ok(!interrupted, "Native verification interrupted");
  tests = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, NOVA_NATIVE_TEST_FIXTURE: fixture },
    stdio: "inherit",
  });
  const code = await new Promise((resolve, reject) => {
    tests.once("error", reject);
    tests.once("exit", resolve);
  });
  assert.equal(code, 0, "Native database verification failed");
  console.log(
    load
      ? "Owned PostgreSQL 17 bounded mixed workload passed; this is not hosted capacity evidence."
      : "Owned PostgreSQL 17 cluster verification passed.",
  );
} finally {
  if (server?.pid && server.exitCode === null) {
    server.kill("SIGINT");
    await new Promise((resolve) => {
      const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await rm(temporary, { recursive: true, force: true });
  console.log(
    "Owned native cluster, synthetic credentials and generated TLS keys removed.",
  );
}
