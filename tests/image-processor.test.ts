import sharp from "sharp";
import { it, expect } from "vitest";
import { WorkerImageProcessor } from "@/server/providers/image-processor";
const processor = new WorkerImageProcessor(5000);
it("decodes real PNG/JPEG pixels, orients and strips metadata into bounded WebP without changing uploaded bytes", async () => {
  const original = await sharp({
    create: {
      width: 30,
      height: 20,
      channels: 4,
      background: { r: 20, g: 80, b: 120, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const copy = Buffer.from(original);
  const result = await processor.normalize(original);
  expect(Buffer.from(original)).toEqual(copy);
  expect(result).toMatchObject({ width: 30, height: 20 });
  const decoded = await sharp(result.bytes).metadata();
  expect(decoded.format).toBe("webp");
  expect(decoded.hasAlpha).toBe(true);
  expect(decoded.exif).toBeUndefined();
  const jpeg = await sharp({
    create: { width: 2000, height: 1000, channels: 3, background: "navy" },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const oriented = await processor.normalize(jpeg);
  expect(oriented).toMatchObject({ width: 800, height: 1600 });
  expect((await sharp(oriented.bytes).metadata()).exif).toBeUndefined();
});
it("rejects unsupported, malformed, animated or oversized dimensions", async () => {
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const animation = Buffer.concat([
    png.subarray(0, 8),
    Buffer.from([0, 0, 0, 8]),
    Buffer.from("acTL"),
    Buffer.alloc(12),
    png.subarray(8),
  ]);
  const wide = await sharp({
    create: { width: 4097, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  for (const bytes of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    Buffer.from([255, 216, 255, 0]),
    animation,
    wide,
    png.subarray(0, 25),
  ])
    await expect(processor.normalize(bytes)).rejects.toMatchObject({
      status: 422,
    });
});
it("terminates processing at its deadline", async () => {
  const bytes = await sharp({
    create: { width: 10, height: 10, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await expect(
    new WorkerImageProcessor(1).normalize(bytes),
  ).rejects.toMatchObject({ code: "IMAGE_LIMIT", status: 422 });
});
