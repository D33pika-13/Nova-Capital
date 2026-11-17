import "server-only";
import { AppError } from "./errors";
export async function readBinaryBody(
  request: Pick<Request, "body">,
  maxBytes = 4096,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const reader = request.body?.getReader();
  if (!reader)
    throw new AppError("INVALID_INPUT", "A request body is required.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError("TOO_LARGE", "Request is too large.", 413);
      }
      chunks.push(value);
    }
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
export async function readJsonBody(
  request: Request,
  maxBytes = 4096,
): Promise<unknown> {
  const bytes = await readBinaryBody(request, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new AppError("INVALID_INPUT", "Invalid request.", 400);
  }
}
