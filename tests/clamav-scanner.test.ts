import { createServer, type Socket } from "node:net";
import { describe, it, expect } from "vitest";
import { ClamAvScanner } from "@/server/providers/clamav-scanner";
async function daemon(reply: string | ((socket: Socket) => void)) {
  let scanned = Buffer.alloc(0);
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let command = false;
    socket.on("data", (data) => {
      buffer = Buffer.concat([
        buffer,
        Buffer.isBuffer(data) ? data : Buffer.from(data),
      ]);
      if (!command) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        expect(buffer.subarray(0, end).toString()).toBe("zINSTREAM");
        buffer = buffer.subarray(end + 1);
        command = true;
      }
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (buffer.length < 4 + size) return;
        scanned = Buffer.concat([scanned, buffer.subarray(4, 4 + size)]);
        buffer = buffer.subarray(4 + size);
        if (size === 0) {
          if (typeof reply === "string") socket.end(reply);
          else reply(socket);
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as { port: number }).port,
    bytes: () => scanned,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
describe("ClamAV INSTREAM protocol adapter", () => {
  it("frames all bytes and accepts only an explicit clean result", async () => {
    const server = await daemon("stream: OK\0");
    try {
      const bytes = Buffer.alloc(150000, 42);
      await new ClamAvScanner("127.0.0.1", server.port, 2000).scan(bytes);
      expect(server.bytes()).toEqual(bytes);
    } finally {
      await server.close();
    }
  });
  it.each([
    ["stream: Synthetic.Test FOUND\0", 422],
    ["stream: size limit exceeded ERROR\0", 503],
    ["unexpected OK\0", 503],
    ["stream: OK", 503],
  ] as const)("fails closed on %s", async (reply, status) => {
    const server = await daemon(reply);
    try {
      await expect(
        new ClamAvScanner("127.0.0.1", server.port, 2000).scan(
          Buffer.from("fixture"),
        ),
      ).rejects.toMatchObject({ status });
    } finally {
      await server.close();
    }
  });
  it("fails closed when the scanner is unavailable", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await expect(
      new ClamAvScanner("127.0.0.1", port, 1000).scan(Buffer.from("fixture")),
    ).rejects.toMatchObject({ status: 503 });
  });
});

it("rejects a clean response received before the upload has finished", async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.pause();
    socket.end("stream: OK\0");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await expect(
      new ClamAvScanner(
        "127.0.0.1",
        (server.address() as { port: number }).port,
        1000,
      ).scan(Buffer.alloc(8 * 1024 * 1024, 42)),
    ).rejects.toMatchObject({ code: "SCANNER_UNAVAILABLE", status: 503 });
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it.each([
  "stream: OK\0stream: Synthetic.Test FOUND\0",
  "stream: OK\0unexpected trailing bytes",
  "stream: OK\0\0",
])("rejects ambiguous clean frames: %s", async (reply) => {
  const server = await daemon(reply);
  try {
    await expect(
      new ClamAvScanner("127.0.0.1", server.port, 1000).scan(
        Buffer.from("fixture"),
      ),
    ).rejects.toMatchObject({ code: "SCANNER_UNAVAILABLE", status: 503 });
  } finally {
    await server.close();
  }
});
it("waits through fragmented replies and rejects later trailing records", async () => {
  const server = await daemon((socket) => {
    socket.write("stream: OK\0");
    setTimeout(() => socket.end("stream: Synthetic.Test FOUND\0"), 20);
  });
  try {
    await expect(
      new ClamAvScanner("127.0.0.1", server.port, 1000).scan(
        Buffer.from("fixture"),
      ),
    ).rejects.toMatchObject({ code: "SCANNER_UNAVAILABLE", status: 503 });
  } finally {
    await server.close();
  }
});
it("accepts a fragmented single clean record only after normal response completion", async () => {
  const server = await daemon((socket) => {
    socket.write("stream: ");
    setImmediate(() => socket.end("OK\0"));
  });
  try {
    await expect(
      new ClamAvScanner("127.0.0.1", server.port, 1000).scan(
        Buffer.from("fixture"),
      ),
    ).resolves.toBeUndefined();
  } finally {
    await server.close();
  }
});
it("times out if a daemon sends a clean prefix but never finishes its response", async () => {
  const server = await daemon((socket) => socket.write("stream: OK\0"));
  try {
    await expect(
      new ClamAvScanner("127.0.0.1", server.port, 80).scan(
        Buffer.from("fixture"),
      ),
    ).rejects.toMatchObject({ code: "SCANNER_UNAVAILABLE", status: 503 });
  } finally {
    await server.close();
  }
});
