const assert = require("node:assert/strict");
const test = require("node:test");
const { extractPdfSource } = require("../src/company-context/pdf-source.service");

function minimalPdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 40} >>\nstream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "binary"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, "binary");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}

test("extracts bounded selectable text and file provenance from a PDF", async () => {
  const buffer = minimalPdf("Acme Holdings operates technology services for enterprise customers and monitors regulatory risk.");
  const source = await extractPdfSource({ buffer, size: buffer.length, originalname: "company-profile.pdf", mimetype: "application/pdf" });
  assert.equal(source.sourceType, "file");
  assert.match(source.text, /Acme Holdings/);
  assert.equal(source.metadata.fileName, "company-profile.pdf");
  assert.equal(source.metadata.pageCount, 1);
  assert.match(source.metadata.fileSha256, /^[a-f0-9]{64}$/);
});

test("rejects non-PDF content before parsing", async () => {
  await assert.rejects(() => extractPdfSource({ buffer: Buffer.from("not a pdf"), size: 9, originalname: "company-profile.pdf", mimetype: "application/pdf" }), { code: "PDF_SIGNATURE_INVALID" });
});

test("fails closed for scan-only or text-insufficient PDFs", async () => {
  const buffer = minimalPdf("x");
  await assert.rejects(() => extractPdfSource({ buffer, size: buffer.length, originalname: "scan.pdf", mimetype: "application/pdf" }), { code: "PDF_TEXT_INSUFFICIENT" });
});
