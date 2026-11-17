import { fork } from "node:child_process";
import sharp from "sharp";
import path from "node:path";
import { withStandaloneCopy } from "./package-check-helpers.mjs";
try {
  const bytes = await sharp({
    create: {
      width: 8,
      height: 4,
      channels: 4,
      background: { r: 30, g: 70, b: 100, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  await withStandaloneCopy(async (root) => {
    const child = fork(
      path.join(root, "scripts/image-validation-worker.mjs"),
      [],
      {
        cwd: root,
        env: { NODE_ENV: "production" },
        execArgv: ["--max-old-space-size=64"],
        serialization: "advanced",
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 5000);
        child.once("message", resolve);
        child.once("error", reject);
        child.once("exit", () => reject(new Error("decoder exited")));
        child.send({ bytes });
      });
      if (
        result?.ok !== true ||
        result.width !== 8 ||
        result.height !== 4 ||
        !(result.bytes instanceof Uint8Array) ||
        Buffer.from(result.bytes.subarray(8, 12)).toString("ascii") !== "WEBP"
      )
        throw new Error("conversion failed");
      console.log(
        "Isolated standalone image decoder produced WebP without workspace dependency fallback.",
      );
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 1000);
      });
    }
  });
} catch {
  console.error(
    "Packaged image validation failed. Rebuild with sharp, its native libraries and the decoder script included.",
  );
  process.exitCode = 1;
}
