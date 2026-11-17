import sharp from "sharp";
sharp.cache(false);
sharp.concurrency(1);
process.on("disconnect", () => process.exit(0));
process.once("message", async (message) => {
  try {
    const input = Buffer.from(message.bytes);
    const png = input
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = input[0] === 255 && input[1] === 216 && input[2] === 255;
    if (input.length === 0 || input.length > 5242880 || (!png && !jpeg))
      throw new Error("invalid");
    if (png) {
      // APNG must not be silently reduced to its first frame.
      let offset = 8;
      let ended = false;
      while (offset + 12 <= input.length) {
        const size = input.readUInt32BE(offset);
        const type = input.toString("ascii", offset + 4, offset + 8);
        if (size > input.length - offset - 12 || type === "acTL")
          throw new Error("invalid");
        offset += size + 12;
        if (type === "IEND") {
          ended = true;
          break;
        }
      }
      if (!ended) throw new Error("invalid");
    }
    const image = sharp(input, {
      limitInputPixels: 16777216,
      limitInputChannels: 5,
      failOn: "warning",
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (
      !["png", "jpeg"].includes(metadata.format) ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > 4096 ||
      metadata.height > 4096 ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error("invalid");
    const { data, info } = await image
      .autoOrient()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 85, effort: 3 })
      .timeout({ seconds: 3 })
      .toBuffer({ resolveWithObject: true });
    if (
      info.format !== "webp" ||
      data.length > 5242880 ||
      data.length < 12 ||
      info.width < 1 ||
      info.height < 1 ||
      info.width > 1600 ||
      info.height > 1600
    )
      throw new Error("invalid");
    const bytes = Uint8Array.from(data);
    process.send({ ok: true, bytes, width: info.width, height: info.height });
  } catch {
    process.send({ ok: false });
  }
});
