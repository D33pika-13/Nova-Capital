import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertNodeRuntime,
  nodeRuntimeRequirement,
} from "./runtime-policy.mjs";
try {
  assertNodeRuntime();
} catch {
  console.error(nodeRuntimeRequirement);
  process.exit(1);
}
const require = createRequire(import.meta.url);
process.env.NODE_ENV = "production";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
try {
  // The private cleanup boundary is explicitly pinned and must survive packaging.
  if (
    process.env.NEXT_MANUAL_SIG_HANDLE ||
    require("next/package.json").version !== "16.4.6" ||
    !readFileSync(
      require.resolve("next/dist/server/lib/start-server"),
      "utf8",
    ).includes("Symbol.for('nova.server.shutdown')")
  )
    throw Error("Unsupported server shutdown runtime");
  // Initialize Next's Node globals before loading its generated server modules.
  require("next/dist/server/node-environment");
  // This Next version can defer instrumentation until the first request.
  // Complete bootstrap before importing the server that opens its listener.
  const { register } = require("../.next/server/instrumentation.js");
  await register();
  await import("../server.js");
} catch {
  console.error("Server configuration bootstrap failed.");
  process.exit(1);
}
