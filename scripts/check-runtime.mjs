import {
  assertNodeRuntime,
  nodeRuntimeRequirement,
} from "./runtime-policy.mjs";
try {
  assertNodeRuntime();
  console.log(`Node.js runtime accepted (${process.version}).`);
} catch {
  console.error(nodeRuntimeRequirement);
  process.exit(1);
}
