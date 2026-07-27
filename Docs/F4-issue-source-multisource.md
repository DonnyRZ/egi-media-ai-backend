# F4 — Issue pipeline multi-source (CMS + 17 crawl media)

| | |
|---|---|
| **Status** | Implemented (F4) |
| **Depends on** | ADR `Docs/ADR-news-feed-multisource-f0.md` §5, F1 registry/reader, F2 news feed |
| **Scope** | Issue pipeline source resolution only. No FE changes, no X/Viral integration. |

## 1. Issue source ID formats

| Input | Route | Notes |
|---|---|---|
| `<uuid>` (bare) | CMS gate | Legacy compat, unchanged behavior |
| `cms:<uuid>` | CMS gate | Prefix stripped, same CMS path |
| `crawl:<source_id>:<content_hash>` | Crawl gate | `source_id` ∈ 17 registered `feeds_issues` channels; key = crawl `content_hash` (ADR §5) |
| `viral:…` / `viral_x:…` | **rejected** | `ISSUE_SOURCE_VIRAL_REJECTED` |
| anything else | **rejected** | `ISSUE_SOURCE_ID_INVALID` / `ISSUE_SOURCE_CRAWL_CHANNEL_INVALID` |

Helpers live in `src/cms/issue-source-id.js` (`parseIssueSourceId`, `formatCmsIssueSourceId`,
`formatCrawlIssueSourceId`).

## 2. Resolution layer

`src/source/issue-source-resolver.js` exposes `requirePublishedArticle({ articleId, locale })`,
the same signature as `CmsSourceGate`, so it drops into the existing `cmsSourceGate` DI slot for
T02–T07, the citation analysis gate, the ingest worker, and the source routes.

Normalized (frozen) source shape, identical for both providers:

```
sourceArticleId, requestedLocale, contentLocale, canonicalUrl,
provider, issueSourceId, metadata { provider, crawl_source_id, content_hash, thumbnail_url, … },
article { id, title, summary, content, status, publishedAt, updatedAt }
```

- CMS: `canonicalUrl` remains the locale-aware portal URL; `metadata.thumbnail_url` ← CMS `featured_image`.
- Crawl: `canonicalUrl` is the **original media URL** (`canonical_url` → `normalized_url` fallback),
  never a portal URL; `contentLocale` is `id`; `publishedAt` falls back to `collected_at`;
  `updatedAt` is `null` because `content_hash` already pins the content snapshot.

## 3. Persistence identity (no migration)

`ai.article_snapshots.source_article_id` is `text`, so crawl snapshots store the prefixed id
`crawl:<source_id>:<content_hash>` while CMS snapshots keep the bare UUID for backward
compatibility. The provider is therefore derivable from the stored id (`parseIssueSourceId`),
and no schema change was required.

## 4. How crawl articles enter the pipeline

| Path | Mode | Automatic in F4? |
|---|---|---|
| Single crawl article | `POST /api/v1/internal/pipeline/ingest` with `mode=article`, `article_id=crawl:<source_id>:<content_hash>` | Manual trigger |
| Per-media backfill/poll | `POST /api/v1/internal/pipeline/ingest` with `mode=crawl-poll`, `crawl_source_id=<id>` | Manual trigger; the queued job runs `CrawlIngestService.pollSource` on the ingest worker |
| CMS poll | `mode=poll` | Unchanged, scheduled by `MultiTenantIngestScheduler` |

`CrawlIngestService` (`src/source/crawl-ingest.service.js`) reads new valid rows since the stored
watermark (`source_watermarks.source_name = crawl:<source_id>`), snapshots them through the
resolver, and enqueues the same `relevance` stage job as CMS ingest.

**Not automatic in F4:** the scheduler does not yet fan out `crawl-poll` per media. Enabling that
is a follow-on change to `MultiTenantIngestScheduler` / `PollEnqueueService`.

## 5. Guarantees

- Crawl DB access is read-only (`assertCrawlReadOnlyQuery`; only `SELECT` statements are issued).
- No crawl content is ever written into editorial CMS `articles`.
- Viral can never mint or resolve an issue source.
- Existing CMS callers (bare UUID payloads, stored decisions, smoke script) are unaffected.
