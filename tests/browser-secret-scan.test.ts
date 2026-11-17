import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

describe("browser secret scanner", () => {
  it("rejects an individual MFA key without printing its material", () => {
    const root = mkdtempSync(path.join(tmpdir(), "nova-browser-secrets-"));
    const material = randomBytes(32).toString("base64url");
    const script = path.resolve("scripts/check-browser-secrets.mjs");
    const env = {
      NODE_ENV: "test" as const,
      ENTRA_MFA_ENCRYPTION_KEYS: JSON.stringify({ current: material }),
    };
    try {
      mkdirSync(path.join(root, ".next/static"), { recursive: true });
      const chunk = path.join(root, ".next/static/chunk.js");
      writeFileSync(chunk, `const leaked = "${material}";`);
      let failure: unknown;
      try {
        execFileSync(process.execPath, [script], {
          cwd: root,
          env,
          stdio: "pipe",
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeDefined();
      const result = failure as { status: number; stderr: Buffer };
      expect(result.status).toBe(1);
      expect(result.stderr.toString()).toContain(
        "ENTRA_MFA_ENCRYPTION_KEYS material",
      );
      expect(result.stderr.toString()).not.toContain(material);
      writeFileSync(chunk, "const publicValue = true;");
      expect(
        execFileSync(process.execPath, [script], {
          cwd: root,
          env,
          encoding: "utf8",
          stdio: "pipe",
        }),
      ).toContain("none of the supplied privileged secret values");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
