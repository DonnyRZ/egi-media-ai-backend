/**
 * Minimal CMS stand-in for local AI pipeline smoke when egi-media-backend won't boot.
 * Serves GET /api/v1/articles/:id?lang=... from SOURCE_DATABASE_URL.
 */
const http = require("http");
const { Client } = require("pg");

const PORT = Number(process.env.MOCK_CMS_PORT || 5002);
const DATABASE_URL =
  process.env.SOURCE_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5435/egi_media_cms";

async function getArticle(id) {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id::text AS id, title, summary, content, status::text AS status,
              published_at, updated_at, deleted_at
       FROM public.articles WHERE id=$1::uuid`,
      [id],
    );
    return result.rows[0] || null;
  } finally {
    await client.end();
  }
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
      res.end(
        JSON.stringify({
          success: true,
          data: {
            id: row.id,
            title: row.title,
            summary: row.summary,
            content: row.content,
            status: row.status,
            published_at: row.published_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            locale: lang,
          },
        }),
      );
    } catch (error) {
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/v1/articles") {
    res.writeHead(200);
    res.end(JSON.stringify({ success: true, data: { items: [], next_cursor: null } }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ success: false, message: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock CMS listening on http://127.0.0.1:${PORT}`);
});
