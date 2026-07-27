/**
 * Minimal CMS stand-in for local AI pipeline smoke when egi-media-backend won't boot.
 * Serves GET /api/v1/articles and GET /api/v1/articles/:id?lang=... from SOURCE_DATABASE_URL.
 */
const http = require("http");
const { Client } = require("pg");

const PORT = Number(process.env.MOCK_CMS_PORT || 5002);
const DATABASE_URL =
  process.env.SOURCE_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5435/egi_media_cms";

const ARTICLE_SELECT = `
  SELECT id::text AS id, title, summary, content, status::text AS status,
         published_at, updated_at, deleted_at, featured_image
  FROM public.articles
`;

async function withClient(fn) {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function getArticle(id) {
  return withClient(async (client) => {
    const result = await client.query(`${ARTICLE_SELECT} WHERE id=$1::uuid`, [id]);
    return result.rows[0] || null;
  });
}

async function listPublished({ limit = 20, cursor = null } = {}) {
  const pageLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return withClient(async (client) => {
    const params = [];
    let sql = `${ARTICLE_SELECT}
      WHERE status::text = 'published'
        AND deleted_at IS NULL`;
    if (cursor) {
      params.push(cursor);
      sql += ` AND published_at < $${params.length}::timestamptz`;
    }
    params.push(pageLimit + 1);
    sql += ` ORDER BY published_at DESC NULLS LAST, id DESC LIMIT $${params.length}`;
    const result = await client.query(sql, params);
    const rows = result.rows;
    const hasMore = rows.length > pageLimit;
    const page = rows.slice(0, pageLimit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => mapArticle(row, "id")),
      next_cursor: hasMore && last?.published_at
        ? new Date(last.published_at).toISOString()
        : null,
    };
  });
}

function mapArticle(row, locale = "id") {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    content: row.content,
    status: row.status,
    published_at: row.published_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    featured_image: row.featured_image || null,
    locale,
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health/live")) {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: { status: "alive", service: "mock-cms" } }));
    return;
  }

  const match = url.pathname.match(/^\/api\/v1\/articles\/([0-9a-f-]{36})$/i);
  if (req.method === "GET" && match) {
    try {
      const row = await getArticle(match[1]);
      if (!row) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, message: "not found" }));
        return;
      }
      const lang = url.searchParams.get("lang") || "id";
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: mapArticle(row, lang) }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/articles") {
    try {
      const page = await listPublished({
        limit: url.searchParams.get("limit"),
        cursor: url.searchParams.get("cursor"),
      });
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, data: page }));
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, message: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock CMS listening on http://127.0.0.1:${PORT}`);
});
