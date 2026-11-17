import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const execute = promisify(execFile);
// Test tooling only: no database connections, services, root install or app dependencies.
const version = "17.11";
const sha256 =
  "dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979";
const root = await mkdtemp(path.join(tmpdir(), "nova-pg-client-tools-"));
const log = path.join(root, "build.log");
const env = { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" };
const run = async (command, args, cwd = root) => {
  try {
    const result = await execute(command, args, {
      cwd,
      env,
      timeout: 120000,
      maxBuffer: 4194304,
    });
    await writeFile(log, result.stdout + result.stderr, {
      flag: "a",
      mode: 0o600,
    });
    return result;
  } catch (error) {
    await writeFile(
      log,
      String(error.stdout ?? "") + String(error.stderr ?? ""),
      { flag: "a", mode: 0o600 },
    );
    throw Error("Client tool build failed");
  }
};
try {
  assert.notEqual(process.getuid?.(), 0, "Use an unprivileged build user");
  const response = await fetch(
    `https://ftp.postgresql.org/pub/source/v${version}/postgresql-${version}.tar.bz2`,
    { redirect: "error", signal: AbortSignal.timeout(30000) },
  );
  assert.ok(response.ok && response.body);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    assert.ok(length <= 67108864, "Source archive is too large");
    chunks.push(chunk);
  }
  const sourceArchive = Buffer.concat(chunks);
  assert.equal(
    createHash("sha256").update(sourceArchive).digest("hex"),
    sha256,
    "Source archive integrity mismatch",
  );
  await writeFile(path.join(root, "source.tar.bz2"), sourceArchive, {
    mode: 0o600,
  });
  // Extraction executes only after matching the pinned official release bytes.
  await run("tar", ["-xjf", "source.tar.bz2"]);
  const source = path.join(root, `postgresql-${version}`);
  const prefix = path.join(root, "tools");
  const args = [
    `--prefix=${prefix}`,
    "--without-readline",
    "--without-icu",
    "--with-openssl",
  ];
  if (process.env.POSTGRES_OPENSSL_ROOT) {
    const ssl = await realpath(process.env.POSTGRES_OPENSSL_ROOT);
    assert.ok(
      path.isAbsolute(ssl) && /^[A-Za-z0-9_./-]+$/.test(ssl),
      "Use a simple absolute OpenSSL root path",
    );
    args.push(`--with-includes=${ssl}/include`, `--with-libraries=${ssl}/lib`);
    if (process.platform === "darwin") env.LDFLAGS = `-Wl,-rpath,${ssl}/lib`;
  }
  await run("./configure", args, source);
  await run("make", ["-j4", "-C", "src/backend", "generated-headers"], source);
  await run("make", ["-j4", "-C", "src/bin/pg_dump"], source);
  await run("make", ["-C", "src/interfaces/libpq", "install"], source);
  await run("make", ["-C", "src/bin/pg_dump", "install"], source);
  const bin = path.join(prefix, "bin");
  for (const tool of ["pg_dump", "pg_restore"]) {
    const result = await run(path.join(bin, tool), ["--version"]);
    assert.ok(result.stdout.includes(`(PostgreSQL) ${version}`));
  }
  const manifest = { root, bin, version, sha256 };
  if (process.env.POSTGRES_CLIENT_MANIFEST)
    await writeFile(
      process.env.POSTGRES_CLIENT_MANIFEST,
      JSON.stringify(manifest) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  console.log(JSON.stringify(manifest));
} catch {
  console.error(
    `Pinned PostgreSQL client-tool build failed; owned build log: ${log}`,
  );
  process.exitCode = 1;
}
