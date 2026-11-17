import { cp, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { assertNodeRuntime } from "./runtime-policy.mjs";
assertNodeRuntime();
const root = process.cwd();
const output = path.join(root, ".next/standalone");
try {
  await access(path.join(output, "server.js"));
} catch {
  console.error("Run pnpm build before starting the server.");
  process.exit(1);
}
await cp(path.join(root, ".next/static"), path.join(output, ".next/static"), {
  recursive: true,
});
try {
  await access(path.join(root, "public"));
  await cp(path.join(root, "public"), path.join(output, "public"), {
    recursive: true,
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let envFile = [];
try {
  await access(path.join(root, ".env.local"));
  envFile = ["--env-file=.env.local"];
} catch {}
const child = spawn(
  process.execPath,
  [...envFile, path.join(output, "scripts/standalone-entry.mjs")],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, HOSTNAME: process.env.APP_HOST ?? "127.0.0.1" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("Could not start the application server.");
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
