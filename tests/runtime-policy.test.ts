import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const { assertNodeRuntime, minimumNodeVersion } = createRequire(
  import.meta.url,
)("../scripts/runtime-policy.mjs") as {
  assertNodeRuntime: (version?: unknown) => void;
  minimumNodeVersion: string;
};

describe("runtime security floor", () => {
  it.each(["24.22.3", "24.22.4", "24.23.0"])(
    "accepts stable supported runtime %s",
    (version) => expect(() => assertNodeRuntime(version)).not.toThrow(),
  );
  it.each([
    "22.23.5",
    "24.21.9",
    "24.22.1",
    "24.22.2",
    "25.0.0",
    "26.13.1",
    "24.22.3-rc.1",
    "v24.22.3",
    "24.022.3",
    "24.22.9007199254740992",
    null,
  ])("rejects unsupported or ambiguous runtime %s", (version) => {
    expect(() => assertNodeRuntime(version)).toThrow(minimumNodeVersion);
  });
  it("keeps release declarations above the same security floor", () => {
    const pin = readFileSync(".node-version", "utf8").trim();
    expect(pin).toBe(minimumNodeVersion);
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.engines.node).toBe(`>=${minimumNodeVersion} <25`);
    const versions = [
      ...readFileSync("Dockerfile", "utf8").matchAll(/FROM node:([\d.]+)-/g),
    ].map((match) => match[1]);
    expect(versions).toEqual([pin, pin]);
    expect(() => assertNodeRuntime()).not.toThrow();
  });
});
