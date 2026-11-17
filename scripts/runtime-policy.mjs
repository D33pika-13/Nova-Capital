// A source-controlled security floor; runtime environment cannot lower it.
export const minimumNodeVersion = "24.22.3";
export const nodeRuntimeRequirement = `Node.js ${minimumNodeVersion} or a newer stable 24.x release is required.`;

export function assertNodeRuntime(version = process.versions.node) {
  if (
    typeof version !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
  )
    throw new Error(nodeRuntimeRequirement);
  const [major, minor, patch] = version.split(".").map(Number);
  const [minimumMajor, minimumMinor, minimumPatch] = minimumNodeVersion
    .split(".")
    .map(Number);
  if (
    ![major, minor, patch].every(Number.isSafeInteger) ||
    major !== minimumMajor ||
    minor < minimumMinor ||
    (minor === minimumMinor && patch < minimumPatch)
  )
    throw new Error(nodeRuntimeRequirement);
}
