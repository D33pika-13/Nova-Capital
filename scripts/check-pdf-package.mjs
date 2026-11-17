import { Worker } from "node:worker_threads";
import { PDFDocument } from "pdf-lib";
import path from "node:path";
import { withStandaloneCopy } from "./package-check-helpers.mjs";
try {
  await withStandaloneCopy(async (root) => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle("SYNTHETIC package check");
    const bytes = Uint8Array.from(await doc.save()).buffer;
    const worker = new Worker(
      path.join(root, "scripts/pdf-validation-worker.mjs"),
      {
        env: { NODE_ENV: "production" },
        workerData: { bytes, maximumPages: 10 },
        transferList: [bytes],
        stdout: true,
        stderr: true,
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      },
    );
    worker.stdout?.resume();
    worker.stderr?.resume();
    let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), 5000);
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", () => reject(new Error("worker exited")));
      });
      if (result?.ok !== true || result.pageCount !== 1)
        throw new Error("validation failed");
      console.log(
        "Isolated standalone PDF worker validated a synthetic report without workspace dependency fallback.",
      );
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  });
} catch {
  console.error(
    "Packaged PDF validation failed. Rebuild with the worker and its dependencies included.",
  );
  process.exitCode = 1;
}
