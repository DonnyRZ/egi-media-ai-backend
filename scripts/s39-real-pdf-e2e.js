const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PDFDocument = require("pdfkit");

const BASE_URL = process.env.AI_BASE_URL || "http://localhost:5003";
const EMAIL = process.env.E2E_EMAIL || "owner-1784884157945-bpu9n8@clean-customer.example";
const PASSWORD = process.env.E2E_PASSWORD || "CustomerTest123!";

function buildPdf(text) { return new Promise((resolve) => { const doc = new PDFDocument(); const chunks = []; doc.on("data", (chunk) => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.fontSize(14).text(text, 72, 72, { width: 468 }); doc.end(); }); }

async function request(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const json = await response.json();
  if (!response.ok) throw new Error(`${pathname} ${response.status}: ${json.error?.message || "request failed"} ${JSON.stringify(json.error?.details || {})}`);
  return json.data;
}

async function main() {
  const login = await request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  const token = login.access_token; const headers = { Authorization: `Bearer ${token}` };
  const pdfPath = path.join(os.tmpdir(), `egi-company-profile-${Date.now()}.pdf`);
  fs.writeFileSync(pdfPath, await buildPdf("Clean Customer Company provides diversified investment and advisory services. It monitors financial markets, regulatory developments, operational resilience, compliance obligations, and reputational risk. Its goals include evaluating relevant news for investment decisions and assessing effects on portfolio companies, customers, and reputation."));
  try {
    const pdfBuffer = fs.readFileSync(pdfPath); const idempotencyKey = `s39-real-pdf-${Date.now()}`;
    const buildForm = () => { const form = new FormData(); form.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), "company-profile.pdf"); form.append("extraction_language", "en"); return form; };
    const created = await request("/api/v1/company-context/draft/pdf", { method: "POST", headers: { ...headers, "Idempotency-Key": idempotencyKey }, body: buildForm() });
    const replay = await request("/api/v1/company-context/draft/pdf", { method: "POST", headers: { ...headers, "Idempotency-Key": idempotencyKey }, body: buildForm() });
    if (replay.draft.draft_id !== created.draft.draft_id) throw new Error("PDF upload idempotency replay returned a different draft");
    const draft = created.draft;
    const approved = await request(`/api/v1/company-context/drafts/${draft.draft_id}/approve`, {
      method: "POST",
      headers: { ...headers, "If-Match": String(draft.revision), "Idempotency-Key": `s39-approve-${Date.now()}`, "content-type": "application/json" },
      body: JSON.stringify({ approval_note: "S39 real PDF E2E activate" }),
    });
    const effective = await request(`/api/v1/companies/${login.company_id}/context`, { headers });
    console.log(JSON.stringify({ draft_id: draft.draft_id, source: created.source, draft_status: approved.draft.status, effective_status: effective.status, effective_version: effective.version, company_id: effective.company_id }, null, 2));
  } finally { fs.rmSync(pdfPath, { force: true }); }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
