import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import type {
  ImageProcessor,
  NormalizedImage,
} from "../modules/offers/image-contracts";
import { AppError } from "../errors";
export class WorkerImageProcessor implements ImageProcessor {
  constructor(private readonly timeoutMs = 5000) {}
  normalize(bytes: Uint8Array): Promise<NormalizedImage> {
    if (bytes.length === 0 || bytes.length > 5242880)
      return Promise.reject(
        new AppError("INVALID_IMAGE", "Invalid image size.", 422),
      );
    return new Promise((resolve, reject) => {
      // A native decoder crash is confined to a child process. No credentials are inherited.
      const child = spawn(
        process.execPath,
        [
          "--max-old-space-size=64",
          path.join(process.cwd(), "scripts/image-validation-worker.mjs"),
        ],
        {
          env: { NODE_ENV: "production" },
          serialization: "advanced",
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      let completed = false;
      const finish = (error?: AppError, result?: NormalizedImage) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        if (error) reject(error);
        else resolve(result!);
      };
      const timer = setTimeout(
        () =>
          finish(
            new AppError(
              "IMAGE_LIMIT",
              "The image exceeded safe processing limits.",
              422,
            ),
          ),
        this.timeoutMs,
      );
      child.on("message", (message: unknown) => {
        const value = message as {
          ok?: boolean;
          bytes?: unknown;
          width?: number;
          height?: number;
        };
        if (
          value?.ok === true &&
          value.bytes instanceof Uint8Array &&
          value.bytes.byteLength > 0 &&
          value.bytes.byteLength <= 5242880 &&
          Number.isInteger(value.width) &&
          Number.isInteger(value.height) &&
          value.width! > 0 &&
          value.height! > 0 &&
          value.width! <= 1600 &&
          value.height! <= 1600
        )
          finish(undefined, {
            bytes: Uint8Array.from(value.bytes),
            width: value.width!,
            height: value.height!,
          });
        else
          finish(
            new AppError(
              "INVALID_IMAGE",
              "Upload a valid, non-animated PNG or JPEG, up to 4096 pixels per side and 5 MiB.",
              422,
            ),
          );
      });
      child.on("error", () =>
        finish(
          new AppError(
            "IMAGE_PROCESSOR_UNAVAILABLE",
            "Image processing is unavailable. No image was published.",
            503,
          ),
        ),
      );
      child.on("exit", () => {
        if (!completed)
          finish(
            new AppError(
              "IMAGE_PROCESSOR_UNAVAILABLE",
              "Image processing ended without a result.",
              503,
            ),
          );
      });
      child.send({ bytes: Uint8Array.from(bytes) }, (error) => {
        if (error)
          finish(
            new AppError(
              "IMAGE_PROCESSOR_UNAVAILABLE",
              "Image processing could not start.",
              503,
            ),
          );
      });
    });
  }
}
