import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { get } from "node:http";
import { writeFile, readFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { withStandaloneCopy } from "./package-check-helpers.mjs";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
let stage = "package copy";
async function check(root, mode, signal, slow = false) {
  stage = `${mode} ${signal}`;
  const selectedPort = await port(),
    base = `http://127.0.0.1:${selectedPort}`;
  const marker = path.join(root, `shutdown-${mode}-${signal}.json`);
  const fixture = path.join(root, "scripts/shutdown-fixture.mjs");
  // Fixture injection exists only in the private copied artifact, with no runtime
  // test route, credential, network exporter or environment-controlled app hook.
  const body =
    mode === "resources"
      ? `
    await import('./standalone-entry.mjs');
    const events=[];
    globalThis.novaPool={end:async()=>{events.push('database');await new Promise(r=>setTimeout(r,40));events.push('database_closed');}};
    globalThis.novaTelemetryFactory.shutdown=async()=>{events.push('telemetry');await new Promise(r=>setTimeout(r,100));events.push('telemetry_closed');writeFileSync(${JSON.stringify(marker)},JSON.stringify(events));};
  `
      : `
    globalThis[Symbol.for('nova.server.shutdown')]=${mode === "fail" ? "async()=>{throw Error('synthetic-private-shutdown-error');}" : "async()=>new Promise(()=>{})"};
    await import('./standalone-entry.mjs');
  `;
  await writeFile(fixture, `import {writeFileSync} from 'node:fs';\n${body}`);
  const child = spawn(process.execPath, [fixture], {
    cwd: root,
    env: {
      NODE_ENV: "production",
      APP_ENV: "test",
      SERVICES_ENABLED: "false",
      APP_URL: base,
      SECRETS_PROVIDER: "env",
      HOSTNAME: "127.0.0.1",
      PORT: String(selectedPort),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "",
    stream,
    timer;
  child.stdout.on("data", (value) => {
    logs += value.toString();
  });
  child.stderr.on("data", (value) => {
    logs += value.toString();
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, termination) => resolve({ code, termination }));
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(
        child.exitCode,
        null,
        "Packaged server exited before readiness",
      );
      try {
        if (
          (
            await fetch(`${base}/api/health`, {
              signal: AbortSignal.timeout(500),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, "Packaged shutdown fixture did not start");
    let completed;
    if (slow) {
      const response = await new Promise((resolve, reject) => {
        const request = get(`${base}/nova-shutdown-fixture.bin`, (res) => {
          res.once("error", reject);
          res.once("data", () => {
            res.pause();
            resolve(res);
          });
        });
        request.once("error", reject);
        request.setTimeout(5000, () =>
          request.destroy(Error("Fixture response timed out")),
        );
      });
      assert.equal(response.statusCode, 200);
      stream = response;
      completed = new Promise((resolve, reject) => {
        response.once("end", resolve);
        response.once("error", reject);
      });
      void completed.catch(() => {});
    }
    child.kill(signal);
    if (slow) {
      await delay(100);
      assert.equal(
        child.exitCode,
        null,
        "Signal interrupted an active response",
      );
      await assert.rejects(access(marker), { code: "ENOENT" });
      // A duplicate signal must not start a second resource shutdown or change exit semantics.
      child.kill(signal === "SIGTERM" ? "SIGINT" : "SIGTERM");
      stream.resume();
      let responseTimer;
      try {
        await Promise.race([
          completed,
          new Promise((_, reject) => {
            responseTimer = setTimeout(
              () => reject(Error("Response drain timed out")),
              8000,
            );
          }),
        ]);
      } finally {
        clearTimeout(responseTimer);
      }
    }
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error("Shutdown exceeded its bound")),
          15000,
        );
      }),
    ]);
    assert.equal(result.code, signal === "SIGTERM" ? 143 : 130);
    assert.equal(result.termination, null);
    if (mode === "resources") {
      assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), [
        "database",
        "database_closed",
        "telemetry",
        "telemetry_closed",
      ]);
      assert.equal(logs.split('"event":"application.shutdown"').length - 1, 1);
      assert.ok(!logs.includes("Application shutdown did not complete."));
    } else assert.ok(logs.includes("Application shutdown did not complete."));
    assert.ok(
      !logs.includes("synthetic-private-shutdown-error"),
      "Shutdown error payload leaked",
    );
  } finally {
    clearTimeout(timer);
    stream?.destroy();
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}
try {
  await withStandaloneCopy(async (root) => {
    await mkdir(path.join(root, "public"), { recursive: true });
    await writeFile(
      path.join(root, "public/nova-shutdown-fixture.bin"),
      Buffer.alloc(32 * 1024 * 1024, 0x31),
    );
    await check(root, "resources", "SIGTERM", true);
    await check(root, "resources", "SIGINT");
    await check(root, "fail", "SIGTERM");
    await check(root, "hang", "SIGTERM");
    stage = "missing patch rejection";
    const copiedRequire = createRequire(path.join(root, "package.json"));
    const runtime = copiedRequire.resolve("next/dist/server/lib/start-server");
    const original = await readFile(runtime, "utf8");
    assert.ok(original.includes("nova.server.shutdown"));
    await writeFile(
      runtime,
      original.replaceAll("nova.server.shutdown", "nova.server.missing"),
    );
    const selectedPort = await port();
    const child = spawn(
      process.execPath,
      [path.join(root, "scripts/standalone-entry.mjs")],
      {
        cwd: root,
        env: {
          NODE_ENV: "production",
          APP_ENV: "test",
          SERVICES_ENABLED: "false",
          APP_URL: `http://127.0.0.1:${selectedPort}`,
          HOSTNAME: "127.0.0.1",
          PORT: String(selectedPort),
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: "pipe",
      },
    );
    let text = "";
    child.stdout.on("data", (value) => {
      text += value.toString();
    });
    child.stderr.on("data", (value) => {
      text += value.toString();
    });
    let guardTimer;
    try {
      const code = await Promise.race([
        new Promise((resolve, reject) => {
          child.once("exit", resolve);
          child.once("error", reject);
        }),
        new Promise((_, reject) => {
          guardTimer = setTimeout(
            () => reject(Error("Patch guard did not stop startup")),
            5000,
          );
        }),
      ]);
      assert.equal(code, 1);
      assert.ok(text.includes("Server configuration bootstrap failed."));
    } finally {
      clearTimeout(guardTimer);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
        await new Promise((resolve) => child.once("exit", resolve));
      }
    }
  });
  console.log(
    "Isolated packaged Next server drained an in-flight response, closed pool before telemetry once, honored both signals, redacted failure, bounded a hung hook and rejected a missing runtime patch.",
  );
} catch {
  console.error(`Standalone shutdown verification failed at ${stage}.`);
  process.exitCode = 1;
}
