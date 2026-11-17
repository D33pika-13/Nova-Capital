import "server-only";
import { createConnection } from "node:net";
import type { MalwareScanner } from "@/server/modules/reports/report-contracts";
import { AppError } from "@/server/errors";
export class ClamAvScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}
  scan(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let finished = false;
      let streamComplete = false;
      let prematureResponse = false;
      let response = Buffer.alloc(0);
      const timer = setTimeout(
        () =>
          finish(
            new AppError(
              "SCANNER_UNAVAILABLE",
              "Malware scanning timed out. No report was published.",
              503,
            ),
          ),
        this.timeoutMs,
      );
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };
      socket.on("error", () =>
        finish(
          new AppError(
            "SCANNER_UNAVAILABLE",
            "Malware scanning is unavailable. No report was published.",
            503,
          ),
        ),
      );
      socket.on("end", () => {
        if (finished) return;
        const end = response.indexOf(0);
        if (
          !streamComplete ||
          prematureResponse ||
          end < 0 ||
          end !== response.length - 1
        ) {
          finish(
            new AppError(
              "SCANNER_UNAVAILABLE",
              "Malware scanning returned an incomplete or invalid result.",
              503,
            ),
          );
          return;
        }
        const result = response.subarray(0, end).toString("utf8");
        if (result === "stream: OK") finish();
        else if (/^stream: [\x20-\x7e]+ FOUND$/.test(result))
          finish(
            new AppError(
              "MALWARE_DETECTED",
              "The file failed malware scanning and was not published.",
              422,
            ),
          );
        else
          finish(
            new AppError(
              "SCANNER_UNAVAILABLE",
              "The scanner could not confirm this file is clean.",
              503,
            ),
          );
      });
      socket.on("data", (chunk) => {
        if (finished) return;
        if (!streamComplete) prematureResponse = true;
        response = Buffer.concat([
          response,
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        ]);
        if (response.length > 4096) {
          finish(
            new AppError(
              "SCANNER_UNAVAILABLE",
              "Invalid scanner response.",
              503,
            ),
          );
          return;
        }
        // This is a single command, not IDSESSION. Wait for response EOF so a
        // clean prefix cannot hide a later record in a different TCP packet.
      });
      socket.on("connect", () => {
        void (async () => {
          const write = (buffer: Uint8Array) =>
            new Promise<void>((done, fail) =>
              socket.write(buffer, (error) => (error ? fail(error) : done())),
            );
          try {
            await write(Buffer.from("zINSTREAM\0"));
            for (
              let start = 0;
              start < bytes.length && !finished;
              start += 65536
            ) {
              const part = bytes.subarray(
                start,
                Math.min(start + 65536, bytes.length),
              );
              const size = Buffer.alloc(4);
              size.writeUInt32BE(part.length);
              await write(size);
              await write(part);
            }
            if (!finished) {
              await write(Buffer.alloc(4));
              streamComplete = true;
            }
          } catch {
            finish(
              new AppError(
                "SCANNER_UNAVAILABLE",
                "Malware scanning could not be completed.",
                503,
              ),
            );
          }
        })();
      });
    });
  }
}
