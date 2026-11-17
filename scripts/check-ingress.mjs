import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = process.env.CADDY_BIN;
assert(binary, "CADDY_BIN must point to the verified Caddy 2.11.9 binary");
assert.match(
  execFileSync(binary, ["version"], { encoding: "utf8" }),
  /^v2\.11\.9\b/,
);
const config = resolve("infra/ingress/Caddyfile");
const host = "staging.example.test";
const directory = await mkdtemp(join(tmpdir(), "nova-ingress-"));
const listen = (server) =>
  new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server.address().port)),
  );
let seen;
const upstream = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  seen = { headers: req.headers, body: Buffer.concat(chunks).toString() };
  res.writeHead(307, {
    location: "/login",
    "cache-control": "no-store",
    "set-cookie": [
      "session=synthetic; Secure; HttpOnly; SameSite=Lax",
      "csrf=synthetic; Secure; HttpOnly",
    ],
  });
  res.end("synthetic response");
});
let proxy;
let output = "";
let checks = 0;
try {
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const env = {
    ...process.env,
    INGRESS_LISTEN_PORT: String(port),
    INGRESS_UPSTREAM_PORT: String(upstreamPort),
    INGRESS_PUBLIC_HOST: host,
    XDG_DATA_HOME: directory,
    XDG_CONFIG_HOME: directory,
  };
  const adapted = JSON.parse(
    execFileSync(
      binary,
      ["adapt", "--config", config, "--adapter", "caddyfile"],
      { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ),
  );
  assert.equal(adapted.admin.disabled, true);
  assert.equal(adapted.apps.http.servers.srv0.listen[0], `127.0.0.1:${port}`);
  checks += 2;
  proxy = spawn(binary, ["run", "--config", config, "--adapter", "caddyfile"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxy.stdout.on("data", (chunk) => {
    output += chunk;
  });
  proxy.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const send = (overrides = {}, body = "") =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/contact",
          method: "POST",
          headers: {
            Host: host,
            "CF-Connecting-IP": "192.0.2.42",
            "X-Forwarded-Proto": "https",
            ...overrides,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res));
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await send();
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert(ready, "proxy starts");
  const response = await send(
    {
      "X-Real-IP": "198.51.100.99",
      "X-Forwarded-For": "198.51.100.99",
      Forwarded: "for=198.51.100.99",
      "X-Forwarded-Host": "evil.invalid",
      Cookie: "synthetic_cookie_marker=1",
    },
    "synthetic_body_marker".repeat(10000),
  );
  assert.equal(response.statusCode, 307);
  assert.equal(response.headers.location, "/login");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["set-cookie"].length, 2);
  assert.equal(seen.headers["x-real-ip"], "192.0.2.42");
  assert.equal(seen.headers["x-forwarded-for"], "192.0.2.42");
  assert.equal(seen.headers.host, host);
  assert.equal(seen.headers["x-forwarded-proto"], "https");
  assert.equal(seen.headers.forwarded, undefined);
  assert.equal(seen.headers["x-forwarded-host"], undefined);
  assert.equal(seen.headers.cookie, "synthetic_cookie_marker=1");
  assert.equal(seen.body, "synthetic_body_marker".repeat(10000));
  checks += 12;
  for (const value of [
    "",
    "not-an-ip",
    "192.0.2.42, 198.51.100.2",
    ["192.0.2.42", "198.51.100.2"],
    "999.999.999.999",
    "127.0.0.1",
    "::1",
  ]) {
    assert.equal((await send({ "CF-Connecting-IP": value })).statusCode, 503);
    checks++;
  }
  assert.equal((await send({ Host: "evil.invalid" })).statusCode, 421);
  assert.equal((await send({ "X-Forwarded-Proto": "http" })).statusCode, 400);
  assert.equal(
    (await send({ "CF-Connecting-IP": "2001:db8::42" })).statusCode,
    307,
  );
  assert.equal(seen.headers["x-real-ip"], "2001:db8::42");
  checks += 4;
  await new Promise((resolve) => upstream.close(resolve));
  assert.equal((await send()).statusCode, 502);
  assert(!output.includes("synthetic_cookie_marker"));
  assert(!output.includes("synthetic_body_marker"));
  checks += 3;
  console.log(
    JSON.stringify({
      result: "passed",
      checks,
      binaryVersion: "2.11.9",
      scope:
        "real loopback proxy; no hosted ingress or email delivery inferred",
    }),
  );
} finally {
  if (proxy && proxy.exitCode === null) {
    proxy.kill("SIGTERM");
    await new Promise((resolve) => proxy.once("exit", resolve));
  }
  if (upstream.listening)
    await new Promise((resolve) => upstream.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
