import "server-only";
import { Readable } from "node:stream";
import type {
  IHttpClient,
  HttpHeaders,
  WebResource,
  HttpOperationResponse,
} from "@azure/storage-blob";
import { readBinaryBody } from "../request-body";
import { AppError } from "../errors";
class AzureHeaders implements HttpHeaders {
  constructor(private readonly values: Headers) {}
  set(name: string, value: string | number) {
    this.values.set(name, String(value));
  }
  get(name: string) {
    return this.values.get(name) ?? undefined;
  }
  contains(name: string) {
    return this.values.has(name);
  }
  remove(name: string) {
    const had = this.contains(name);
    this.values.delete(name);
    return had;
  }
  rawHeaders() {
    return Object.fromEntries(this.values.entries());
  }
  headersArray() {
    return [...this.values.entries()].map(([name, value]) => ({ name, value }));
  }
  headerNames() {
    return [...this.values.keys()];
  }
  headerValues() {
    return [...this.values.values()];
  }
  clone() {
    return new AzureHeaders(new Headers(this.values));
  }
  toJson() {
    return this.rawHeaders();
  }
}
export class AzureBlobHttpClient implements IHttpClient {
  constructor(
    private readonly origin: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async sendRequest(input: WebResource): Promise<HttpOperationResponse> {
    const url = new URL(input.url);
    if (
      url.origin !== this.origin ||
      url.protocol !== "https:" ||
      url.username ||
      url.password
    )
      throw new AppError(
        "AZURE_DESTINATION",
        "Storage destination is not allowed.",
        503,
      );
    let body = typeof input.body === "function" ? input.body() : input.body;
    if (body instanceof Readable) body = Readable.toWeb(body);
    const response = await this.request(url, {
      method: input.method,
      headers: input.headers.toJson(),
      body: body as BodyInit | undefined,
      duplex: "half",
      redirect: "error",
      signal: input.abortSignal as AbortSignal | undefined,
    } as RequestInit);
    const result: HttpOperationResponse = {
      request: input,
      status: response.status,
      headers: new AzureHeaders(response.headers),
    };
    if (input.streamResponseStatusCodes?.has(response.status) && response.body)
      result.readableStreamBody = Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream,
      );
    else
      result.bodyAsText = response.body
        ? new TextDecoder().decode(await readBinaryBody(response, 65536))
        : "";
    return result;
  }
}
export class AzureDeadline {
  constructor(private readonly timeoutMs: number) {}
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(controller.signal),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new AppError(
                "AZURE_TIMEOUT",
                "Azure storage operation timed out.",
                503,
              ),
            );
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
