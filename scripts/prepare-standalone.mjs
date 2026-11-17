import { readFile, mkdir, cp, stat } from "node:fs/promises";
import path from "node:path";

// Next 16.4.6 omits the instrumentation entrypoint from standalone output.
// Preserve its generated dependency trace rather than guessing bundle names.
const root = process.cwd();
const base = path.join(root, ".next/server");
const output = path.join(root, ".next/standalone");
const trace = JSON.parse(
  await readFile(path.join(base, "instrumentation.js.nft.json"), "utf8"),
);
for (const entry of [
  "instrumentation.js",
  "instrumentation.js.map",
  "instrumentation.js.nft.json",
  ...trace.files,
]) {
  const source = path.resolve(base, entry);
  const relative = path.relative(root, source);
  if (relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    throw new Error("Invalid instrumentation package trace");
  const destination = path.join(output, relative);
  const type = await stat(source);
  if (type.isDirectory()) {
    if (!(await stat(destination)).isDirectory())
      throw new Error("Missing traced package directory");
    continue;
  }
  if (!type.isFile()) throw new Error("Invalid instrumentation package trace");
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { dereference: true });
}
await mkdir(path.join(output, "scripts"), { recursive: true });
for (const entry of ["standalone-entry.mjs", "runtime-policy.mjs"])
  await cp(
    path.join(root, "scripts", entry),
    path.join(output, "scripts", entry),
  );
console.log(
  "Standalone instrumentation and its traced dependencies are packaged.",
);
