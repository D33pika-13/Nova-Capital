import { parentPort, workerData } from "node:worker_threads";
import { PDFDocument, PDFDict, PDFArray, PDFName } from "pdf-lib";
const reject = (reason) => parentPort.postMessage({ ok: false, reason });
try {
  const bytes = new Uint8Array(workerData.bytes);
  if (
    !/%%EOF\s*$/.test(
      Buffer.from(bytes.subarray(Math.max(0, bytes.length - 2048))).toString(
        "latin1",
      ),
    )
  )
    throw new Error("invalid");
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  const pageCount = doc.getPageCount();
  if (pageCount < 1 || pageCount > workerData.maximumPages) {
    reject("pages");
  } else {
    const bannedKeys = new Set([
      "JS",
      "OpenAction",
      "AA",
      "EmbeddedFiles",
      "XFA",
      "RichMediaContent",
      "RichMediaSettings",
      "AF",
    ]);
    const bannedNames = new Set([
      "JavaScript",
      "Launch",
      "GoToR",
      "GoToE",
      "SubmitForm",
      "ImportData",
      "EmbeddedFile",
      "FileAttachment",
      "Movie",
      "Sound",
      "RichMedia",
      "3D",
    ]);
    const pending = doc.context
      .enumerateIndirectObjects()
      .map(([, object]) => object);
    const seen = new Set();
    let safe = true;
    while (pending.length) {
      const object = pending.pop();
      if (seen.has(object)) continue;
      seen.add(object);
      if (seen.size > 100000) {
        safe = false;
        break;
      }
      if (object instanceof PDFName && bannedNames.has(object.decodeText())) {
        safe = false;
        break;
      }
      if (object?.dict instanceof PDFDict) pending.push(object.dict);
      if (object instanceof PDFDict) {
        for (const [key, value] of object.entries()) {
          if (bannedKeys.has(key.decodeText())) {
            safe = false;
            break;
          }
          pending.push(value);
        }
        if (!safe) break;
      }
      if (object instanceof PDFArray)
        for (let i = 0; i < object.size(); i++) pending.push(object.get(i));
    }
    if (!safe) reject("active");
    else parentPort.postMessage({ ok: true, pageCount });
  }
} catch (error) {
  reject(
    String(error?.message ?? "")
      .toLowerCase()
      .includes("encrypted")
      ? "encrypted"
      : "invalid",
  );
}
