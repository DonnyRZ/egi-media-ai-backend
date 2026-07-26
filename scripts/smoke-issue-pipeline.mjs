/**
 * Smoke: ingest 2 relevant + 1 irrelevant CMS articles into AGAT company scope,
 * then drive T02→T10 via internal APIs (no scheduler required).
 */
import jwt from "jsonwebtoken";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = { ...loadEnv(resolve(root, ".env")), ...process.env };
const AI_URL = env.AI_PUBLIC_URL || "http://127.0.0.1:5003";
const CMS_URL = env.CMS_BASE_URL || "http://127.0.0.1:5002";
const COMPANY_ID = process.env.SMOKE_COMPANY_ID || "84292177-c7ae-4080-af54-5adb77f74ff9";
const LOCALE = "id";

function key(label) {
  return `smoke-issue-${label}-${randomUUID()}`.slice(0, 255);
}

async function waitHttp(url, { attempts = 40, delayMs = 1500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status < 500) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function jsonFetch(url, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: res.status, payload };
}

function mintWorkerToken({ tenantId, companyId, userId = "ai-worker-local" }) {
  const secret = env.AI_SERVICE_AUTH_SECRET;
  if (!secret) throw new Error("AI_SERVICE_AUTH_SECRET missing");
  return jwt.sign(
    {
      id: userId,
      role: "ai_worker",
      actor_type: "ai_worker",
      email: "ai-worker@local",
      tenant_id: tenantId,
      company_id: companyId,
    },
    secret,
    { expiresIn: "2h" },
  );
}

async function ensureWorkerMembership({ aiDb, tenantId, companyId }) {
  const userId = "ai-worker-local";
  const upserted = await aiDb.query(
    `INSERT INTO ai.users (id, email, full_name, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (email) DO UPDATE SET status='active', full_name=EXCLUDED.full_name, updated_at=now()
     RETURNING id`,
    [userId, "ai-worker@local", "AI Worker Local"],
  );
  const resolvedUserId = upserted.rows[0].id;

  const existing = await aiDb.query(
    `SELECT id, role, status FROM ai.memberships
     WHERE user_id=$1 AND tenant_id=$2 AND company_id=$3`,
    [resolvedUserId, tenantId, companyId],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].role !== "ai_worker" || existing.rows[0].status !== "active") {
      await aiDb.query(`UPDATE ai.memberships SET role='ai_worker', status='active', updated_at=now() WHERE id=$1`, [
        existing.rows[0].id,
      ]);
    }
    return { membershipId: existing.rows[0].id, userId: resolvedUserId };
  }
  const id = randomUUID();
  await aiDb.query(
    `INSERT INTO ai.memberships (id, user_id, tenant_id, company_id, role, status, version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'ai_worker','active',1,now(),now())`,
    [id, resolvedUserId, tenantId, companyId],
  );
  return { membershipId: id, userId: resolvedUserId };
}

function scoreArticle(row) {
  const hay = `${row.title || ""} ${row.summary || ""} ${row.industry || ""}`.toLowerCase();
  const hospitality = /(hotel|hospitality|resort|pariwisata|restoran|kuliner|penginapan|travel|tourism|f&b|food)/i.test(hay);
  const laser = /(laser|industri|tambang|mining|oil|gas|semiconductor)/i.test(hay);
  return { hospitality, laser, hay };
}

async function pickArticles(cmsDb) {
  // Prefer explicitly seeded smoke articles when present.
  const seededIds = (process.env.SMOKE_ARTICLE_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (seededIds.length >= 3) {
    const result = await cmsDb.query(
      `SELECT id::text AS id, title, summary, status::text AS status, updated_at
       FROM public.articles WHERE id = ANY($1::uuid[])`,
      [seededIds],
    );
    const byId = new Map(result.rows.map((r) => [r.id, r]));
    const ordered = seededIds.map((id) => byId.get(id)).filter(Boolean);
    if (ordered.length >= 3) {
      return {
        relevant: ordered.slice(0, 2),
        irrelevant: ordered.slice(2, 3),
        sample: ordered,
      };
    }
  }

  // Try common CMS schemas; fall back to any published-looking article table.
  const candidates = [
    `SELECT id::text AS id, title, summary, status::text AS status, updated_at
     FROM public.articles WHERE status::text ILIKE 'published' ORDER BY updated_at DESC NULLS LAST LIMIT 80`,
    `SELECT id::text AS id, title, summary, status::text AS status, updated_at
     FROM cms.articles WHERE status::text ILIKE 'published' ORDER BY updated_at DESC NULLS LAST LIMIT 80`,
    `SELECT a.id::text AS id, COALESCE(t.title, a.slug, a.id::text) AS title, t.summary, a.status::text AS status, a.updated_at
     FROM public.articles a
     LEFT JOIN public.article_translations t ON t.article_id = a.id AND t.locale = 'id'
     WHERE a.status::text ILIKE 'published' ORDER BY a.updated_at DESC NULLS LAST LIMIT 80`,
  ];
  let rows = [];
  let lastError = null;
  for (const sql of candidates) {
    try {
      const result = await cmsDb.query(sql);
      rows = result.rows;
      if (rows.length) break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!rows.length) {
    const tables = await cmsDb.query(
      `SELECT table_schema, table_name FROM information_schema.tables
       WHERE table_name ILIKE '%article%' ORDER BY 1,2`,
    );
    throw new Error(
      `No published articles found. Last SQL error: ${lastError?.message || "n/a"}. Tables: ${JSON.stringify(tables.rows)}`,
    );
  }

  const scored = rows.map((row) => ({ ...row, ...scoreArticle(row) }));
  const relevant = scored.filter((r) => r.hospitality && !r.laser).slice(0, 2);
  const irrelevant = scored.filter((r) => !r.hospitality).slice(0, 1);
  // Fill if hospitality corpus is thin
  while (relevant.length < 2 && scored.length) {
    const next = scored.find((r) => !relevant.includes(r) && !irrelevant.includes(r));
    if (!next) break;
    relevant.push(next);
  }
  while (irrelevant.length < 1 && scored.length) {
    const next = scored.find((r) => !relevant.includes(r) && !irrelevant.includes(r));
    if (!next) break;
    irrelevant.push(next);
  }
  return { relevant, irrelevant, sample: scored.slice(0, 5) };
}

async function runArticlePipeline({ token, tenantId, companyId, articleId, label }) {
  const auth = { Authorization: `Bearer ${token}` };
  const log = (step, status, extra) => console.log(`[${label}] ${step} -> ${status}`, extra ? JSON.stringify(extra) : "");
  const scopedBody = (extra = {}) => ({ tenant_id: tenantId, company_id: companyId, ...extra });

  // Prefer CMS source check first
  const source = await jsonFetch(`${AI_URL}/api/v1/internal/source/articles/${articleId}?locale=${LOCALE}`, { headers: auth });
  log("source", source.status, source.payload?.error?.code || source.payload?.data?.article?.title || source.payload?.data?.title);

  const classify = await jsonFetch(`${AI_URL}/api/v1/internal/relevance/classify`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": key("t02") },
    body: scopedBody({ article_id: articleId, locale: LOCALE }),
  });
  log("T02 classify", classify.status, {
    relevance: classify.payload?.data?.decision?.relevance,
    continue: classify.payload?.data?.should_continue,
    code: classify.payload?.error?.code,
  });
  if (classify.status >= 400) return { label, articleId, ok: false, stage: "T02", classify };
  if (!classify.payload?.data?.should_continue) {
    return { label, articleId, ok: true, relevant: false, decision: classify.payload.data.decision };
  }

  const decisionId = classify.payload.data.decision.decision_id;
  const rationale = await jsonFetch(`${AI_URL}/api/v1/internal/relevance/rationale`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": key("t03") },
    body: scopedBody({ decision_id: decisionId }),
  });
  log("T03 rationale", rationale.status, { code: rationale.payload?.error?.code });

  const match = await jsonFetch(`${AI_URL}/api/v1/internal/issues/match`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": key("t04") },
    body: scopedBody({ relevance_decision_id: decisionId }),
  });
  log("T04 match", match.status, { code: match.payload?.error?.code, match: match.payload?.data?.match?.action || match.payload?.data?.match });
  if (match.status >= 400) return { label, articleId, ok: false, stage: "T04", match };

  const form = await jsonFetch(`${AI_URL}/api/v1/internal/issues/form`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": key("form") },
    body: scopedBody({
      match_decision_id: match.payload.data.match.match_decision_id || match.payload.data.match.matchDecisionId,
    }),
  });
  log("form", form.status, form.payload?.data?.mutation || form.payload?.error?.code);
  if (form.status >= 400) return { label, articleId, ok: false, stage: "form", form };

  const issueId =
    form.payload?.data?.mutation?.issue_id ||
    form.payload?.data?.mutation?.issueId ||
    form.payload?.data?.mutation?.issue?.issue_id;

  if (!issueId) return { label, articleId, ok: false, stage: "form-no-issue", form };

  const title = await jsonFetch(`${AI_URL}/api/v1/internal/issues/${issueId}/title`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": key("t05") },
    body: scopedBody(),
  });
  log("T05 title", title.status, title.payload?.data?.title?.title || title.payload?.error?.code);

  const oneLiner = await jsonFetch(`${AI_URL}/api/v1/internal/issues/${issueId}/one-liner`, {
    method: "POST",
    headers: { ...auth, "Idempotency-Key": key("t06") },
    body: scopedBody(),
  });
  log("T06 one-liner", oneLiner.status, oneLiner.payload?.data?.one_liner?.one_liner || oneLiner.payload?.error?.code);

  return {
    label,
    articleId,
    ok: true,
    relevant: true,
    issueId,
    title: title.payload?.data?.title?.title || title.payload?.data?.issue?.title,
    oneLiner: oneLiner.payload?.data?.one_liner?.one_liner || oneLiner.payload?.data?.issue?.one_liner,
    decision: classify.payload.data.decision,
  };
}

async function main() {
  console.log("Waiting for AI backend...", AI_URL);
  if (!(await waitHttp(`${AI_URL}/health/live`, { attempts: 20, delayMs: 1000 }))) {
    throw new Error("AI backend not reachable on /health/live");
  }
  console.log("Waiting for CMS...", CMS_URL);
  const cmsUp = await waitHttp(`${CMS_URL}/api/v1/articles?lang=id&status=published&limit=1`, { attempts: 30, delayMs: 2000 });
  if (!cmsUp) console.warn("CMS HTTP may be down; will try DB article pick + AI source gate still needs CMS.");

  const cmsDb = new pg.Client({ connectionString: env.SOURCE_DATABASE_URL });
  const aiDb = new pg.Client({ connectionString: env.AI_DATABASE_URL });
  await cmsDb.connect();
  await aiDb.connect();

  const company = await aiDb.query(`SELECT id, tenant_id, name FROM ai.companies WHERE id=$1`, [COMPANY_ID]);
  if (!company.rows[0]) throw new Error(`Company ${COMPANY_ID} not found in ai.companies`);
  const tenantId = company.rows[0].tenant_id;
  console.log("Company", company.rows[0].name, "tenant", tenantId);

  const ctx = await aiDb.query(
    `SELECT version, status FROM ai.company_contexts WHERE company_id=$1 AND status='effective' ORDER BY version DESC LIMIT 1`,
    [COMPANY_ID],
  );
  console.log("Effective context", ctx.rows[0] || "MISSING");
  if (!ctx.rows[0]) throw new Error("No effective company context — activate context before issue pipeline");

  const worker = await ensureWorkerMembership({ aiDb, tenantId, companyId: COMPANY_ID });
  const token = mintWorkerToken({ tenantId, companyId: COMPANY_ID, userId: worker.userId });

  const picked = await pickArticles(cmsDb);
  console.log("Sample titles:", picked.sample.map((r) => r.title));
  console.log(
    "Picked relevant:",
    picked.relevant.map((r) => ({ id: r.id, title: r.title })),
  );
  console.log(
    "Picked irrelevant:",
    picked.irrelevant.map((r) => ({ id: r.id, title: r.title })),
  );

  const jobs = [
    ...picked.relevant.map((r, i) => ({ articleId: r.id, label: `relevant-${i + 1}`, title: r.title })),
    ...picked.irrelevant.map((r, i) => ({ articleId: r.id, label: `irrelevant-${i + 1}`, title: r.title })),
  ];

  const results = [];
  for (const job of jobs) {
    console.log("\n===", job.label, job.title, job.articleId, "===");
    results.push(await runArticlePipeline({ token, tenantId, companyId: COMPANY_ID, articleId: job.articleId, label: job.label }));
  }

  // Owner-visible issues list
  const login = await jsonFetch(`${AI_URL}/api/v1/auth/login`, {
    method: "POST",
    body: { email: "donny.landscape@gmail.com", password: process.env.DONNY_PASSWORD || "Donny123!" },
  });
  let issues = null;
  if (login.status === 200 && login.payload?.data?.access_token) {
    // try switch-context to company
    const switched = await jsonFetch(`${AI_URL}/api/v1/auth/switch-context`, {
      method: "POST",
      headers: { Authorization: `Bearer ${login.payload.data.access_token}`, "Idempotency-Key": key("switch") },
      body: { company_id: COMPANY_ID },
    });
    const ownerToken = switched.payload?.data?.access_token || login.payload.data.access_token;
    issues = await jsonFetch(`${AI_URL}/api/v1/issues?page=1&limit=20`, {
      headers: { Authorization: `Bearer ${ownerToken}`, "X-Tenant-Id": tenantId, "X-Company-Id": COMPANY_ID },
    });
    // Prefer JWT-scoped session if switch worked
    if (switched.status === 200) {
      issues = await jsonFetch(`${AI_URL}/api/v1/issues?page=1&limit=20`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
    }
  } else {
    console.warn("Donny login failed; listing issues via DB instead", login.payload?.error || login.status);
  }

  const dbIssues = await aiDb.query(
    `SELECT id, title, one_liner, status, current_priority, created_at
     FROM ai.issues WHERE company_id=$1 ORDER BY created_at DESC LIMIT 20`,
    [COMPANY_ID],
  );

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ results, apiIssues: issues?.payload?.data || issues?.status, dbIssues: dbIssues.rows }, null, 2));

  await cmsDb.end();
  await aiDb.end();
}

main().catch((error) => {
  console.error("SMOKE_FAILED", error);
  process.exit(1);
});
