import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { WorkerPdfValidator } from "@/server/providers/pdf-validator";
async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc;
}
describe("PDF validator in bounded worker threads", () => {
  it("validates a static PDF without modifying original bytes", async () => {
    const bytes = await (await pdf()).save();
    const original = Uint8Array.from(bytes);
    expect(await new WorkerPdfValidator(100, 3000).validate(bytes)).toEqual({
      pageCount: 1,
    });
    expect(bytes).toEqual(original);
  });
  it("rejects malformed and truncated PDFs", async () => {
    await expect(
      new WorkerPdfValidator(100, 3000).validate(
        Buffer.from("%PDF-1.7\nnot a document\n%%EOF"),
      ),
    ).rejects.toMatchObject({ status: 422 });
    const bytes = await (await pdf()).save();
    await expect(
      new WorkerPdfValidator(100, 3000).validate(bytes.slice(0, -20)),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("rejects active automatic actions and embedded files", async () => {
    const doc = await pdf();
    doc.catalog.set(
      PDFName.of("OpenAction"),
      doc.context.obj({
        S: PDFName.of("JavaScript"),
        JS: PDFString.of("app.alert('fixture')"),
      }),
    );
    await expect(
      new WorkerPdfValidator(100, 3000).validate(await doc.save()),
    ).rejects.toMatchObject({ code: "INVALID_PDF", status: 422 });
    const attached = await pdf();
    await attached.attach(Buffer.from("Synthetic attachment"), "fixture.txt");
    await expect(
      new WorkerPdfValidator(100, 3000).validate(await attached.save()),
    ).rejects.toMatchObject({ status: 422 });
  });
  it("rejects encrypted documents and enforces page limits", async () => {
    const doc = await pdf();
    doc.context.trailerInfo.Encrypt = doc.context.register(
      doc.context.obj({ Filter: PDFName.of("Standard") }),
    );
    await expect(
      new WorkerPdfValidator(100, 3000).validate(await doc.save()),
    ).rejects.toMatchObject({ status: 422 });
    const large = await pdf();
    large.addPage();
    await expect(
      new WorkerPdfValidator(1, 3000).validate(await large.save()),
    ).rejects.toMatchObject({ status: 422 });
  });
});
