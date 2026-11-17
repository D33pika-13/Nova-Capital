import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";
import type { PdfValidator } from "@/server/modules/reports/report-contracts";
import { AppError } from "@/server/errors";
export class WorkerPdfValidator implements PdfValidator {
  constructor(
    private readonly maximumPages: number,
    private readonly timeoutMs: number,
  ) {}
  validate(bytes: Uint8Array): Promise<{ pageCount: number }> {
    return new Promise((resolve, reject) => {
      const copy = Uint8Array.from(bytes).buffer;
      const worker = new Worker(
        path.join(process.cwd(), "scripts/pdf-validation-worker.mjs"),
        {
          env: { NODE_ENV: "production" },
          workerData: { bytes: copy, maximumPages: this.maximumPages },
          transferList: [copy],
          resourceLimits: { maxOldGenerationSizeMb: 64 },
          stdout: true,
          stderr: true,
        },
      );
      worker.stdout?.resume();
      worker.stderr?.resume();
      let complete = false;
      const timer = setTimeout(
        () =>
          finish(
            new AppError(
              "PDF_LIMIT",
              "The PDF could not be validated within safe processing limits.",
              422,
            ),
          ),
        this.timeoutMs,
      );
      const finish = (error?: Error, pageCount?: number) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        void worker.terminate();
        if (error) reject(error);
        else resolve({ pageCount: pageCount! });
      };
      worker.on("message", (message) => {
        if (
          message?.ok === true &&
          Number.isInteger(message.pageCount) &&
          message.pageCount > 0 &&
          message.pageCount <= this.maximumPages
        )
          finish(undefined, message.pageCount);
        else {
          const reason = message?.reason;
          finish(
            new AppError(
              "INVALID_PDF",
              reason === "active"
                ? "PDFs containing scripts, automatic actions, embedded files or XFA are not accepted."
                : reason === "encrypted"
                  ? "Encrypted or password-protected PDFs cannot be validated. Upload an unencrypted report."
                  : reason === "pages"
                    ? "The PDF exceeds the page-count limit."
                    : "The PDF is damaged or unsupported.",
              422,
            ),
          );
        }
      });
      worker.on("error", () =>
        finish(
          new AppError(
            "PDF_VALIDATOR_UNAVAILABLE",
            "PDF validation could not be completed. No report was published.",
            503,
          ),
        ),
      );
      worker.on("exit", () => {
        if (!complete)
          finish(
            new AppError(
              "PDF_VALIDATOR_UNAVAILABLE",
              "PDF validation ended without a result.",
              503,
            ),
          );
      });
    });
  }
}
