const { PDFParse } = require("pdf-parse");
const { createHash } = require("crypto");

class PdfSourceError extends Error {
  constructor(message, { code = "PDF_SOURCE_INVALID", statusCode = 422, details = {} } = {}) {
    super(message);
    this.name = "PdfSourceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const DEFAULTS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxPages: 50, maxCharacters: 100000 });

async function extractPdfSource(file, limits = {}) {
  const config = { ...DEFAULTS, ...limits };
  if (!file?.buffer || !Buffer.isBuffer(file.buffer)) throw new PdfSourceError("A PDF file is required", { code: "PDF_FILE_REQUIRED", statusCode: 400 });
  if (file.size > config.maxBytes) throw new PdfSourceError("PDF exceeds the configured size limit", { code: "PDF_TOO_LARGE", details: { maxBytes: config.maxBytes } });
  if (file.buffer.subarray(0, 5).toString("ascii") !== "%PDF-") throw new PdfSourceError("File content is not a valid PDF", { code: "PDF_SIGNATURE_INVALID" });

  let parsed;
  let parser;
  try {
    parser = new PDFParse({ data: file.buffer });
    const info = await parser.getInfo();
    if (info.total > config.maxPages) throw new PdfSourceError("PDF exceeds the configured page limit", { code: "PDF_TOO_MANY_PAGES", details: { maxPages: config.maxPages, pages: info.total } });
    const extracted = await parser.getText();
    parsed = { numpages: info.total, text: extracted.text };
  } catch (error) {
    if (error instanceof PdfSourceError) throw error;
    throw new PdfSourceError("PDF could not be parsed; it may be corrupted or password-protected", { code: "PDF_PARSE_FAILED", details: { reason: error?.message || "parse_failed" } });
  } finally {
    await parser?.destroy?.();
  }
  if (!Number.isInteger(parsed.numpages) || parsed.numpages < 1) throw new PdfSourceError("PDF has no readable pages", { code: "PDF_NO_PAGES" });
  if (parsed.numpages > config.maxPages) throw new PdfSourceError("PDF exceeds the configured page limit", { code: "PDF_TOO_MANY_PAGES", details: { maxPages: config.maxPages, pages: parsed.numpages } });
  const text = normalizeExtractedText(parsed.text);
  if (text.length < 40) throw new PdfSourceError("PDF contains insufficient selectable text; scanned PDFs require OCR support", { code: "PDF_TEXT_INSUFFICIENT", details: { pages: parsed.numpages } });
  if (text.length > config.maxCharacters) throw new PdfSourceError("Extracted PDF text exceeds the configured character limit", { code: "PDF_TEXT_TOO_LARGE", details: { maxCharacters: config.maxCharacters } });

  const digest = createHash("sha256").update(file.buffer).digest("hex");
  return {
    sourceLocator: `upload-pdf-${digest.slice(0, 24)}`,
    sourceType: "file",
    text,
    fingerprint: createHash("sha256").update(text).digest("hex"),
    metadata: { fileName: String(file.originalname || "company-profile.pdf").slice(0, 255), mimeType: file.mimetype || "application/pdf", byteSize: file.size, pageCount: parsed.numpages, fileSha256: digest },
  };
}

function normalizeExtractedText(value) {
  return String(value || "").normalize("NFC").replace(/\u0000/g, "").replace(/[ \t]+/g, " ").replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { DEFAULTS, PdfSourceError, extractPdfSource, normalizeExtractedText };
