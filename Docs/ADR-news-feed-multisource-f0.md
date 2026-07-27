# ADR — News Feed / Multi-Source Pipeline (Phase 0 Contract)

| | |
|---|---|
| **Status** | **LOCKED (F0)** |
| **Date** | 2026-07-26 |
| **Owner** | F0-Contract |
| **Code SoT (crawl adapters)** | `egi-media-crawl/src/adapters/index.js` → `ADAPTER_MODULES` / `listAdapterIds()` |
| **Code SoT (crawl fields)** | `egi-media-crawl/docs/N5_CONTRACT_LOCKED.md` (`n5.v1`), `docs/EGI_READ_DTO.md`, `src/dto/egiArticleRead.js` |
| **Code SoT (CMS gate)** | `egi-media-ai-backend/src/cms/cms-source-gate.js` |

**Hard rules (non-negotiable):**

1. Crawl DB is separate. **Never** INSERT/UPDATE crawl rows into editorial CMS `articles`.
2. Crawl field names follow N5 / `toEgiArticleRead` — do not invent parallel crawl schemas.
3. Viral is a News Feed channel only — **not** an issue-pipeline source.
4. Issue sources = EGI Media CMS + the **17** registered crawl adapters only (no Kompas/Antara unless registered in `ADAPTER_MODULES`).

---

## 1. Context & decision

### Problem

Product currently leans on CMS-only news for the AI “All Issues” surface. Leadership prefers external crawl sources. The crawl stack already registers **17** media adapters under N5; the AI backend still gates issue ingest via `CmsSourceGate` on **bare CMS UUIDs** only.

### Decision (two paths)

| Path | Purpose | Sources | Layout |
|---|---|---|---|
| **A — News Feed** | Replace “All Issues” nav/list UX with a multi-channel feed | All **19** channels (Viral + EGI Media + 17 crawl) | Viral = text list; others = card (thumbnail + summary) |
| **B — Issue pipeline** | AI issue ingest / analysis / citations | EGI Media CMS + **17** crawl media only | N/A (backend pipeline) |

**Viral is out of Path B.** Viral = X API later; text list like current All Issues; `feeds_issues = false`. Do not pass Viral items into `CmsSourceGate`, ingest workers, or issue-source ID minting.

**CMS remains read-only for crawl.** Path A/B may *read* crawl DB (or a crawl read API) and *read* CMS articles; they must never write crawl content into editorial `articles`.

### Product decisions resolved after F0 audit

1. The default News Feed channel is **`egi_media`**.
2. The **Viral tab remains visible** before X integration. It returns/displays a **“Coming soon” empty state**; it is not hidden.
3. Crawl feed order is `COALESCE(published_at, collected_at) DESC`, then crawl `article_id DESC` as the deterministic tie-breaker. Pagination uses an opaque keyset cursor containing that effective timestamp and article id; the next page applies the exclusive tuple boundary `(effective_timestamp, article_id) < (cursor timestamp, cursor article id)`.

### Phase 4 ID extension (preview — locked format)

Today `CmsSourceGate.requirePublishedArticle` rejects non-UUID `articleId` (`UUID_PATTERN`). Phase 4 **extends** identity without breaking CMS:

- Keep accepting **legacy bare UUID** as CMS (compat).
- Prefer prefixed forms below for all new writes.
- Route by prefix: `cms:` → existing CMS client/gate; `crawl:` → crawl resolver (new); reject `viral:` / bare non-UUID.

Details in §5.

---

## 2. Channel registry (locked)

Stable API id = `channel` slug. Nav order is **left → right, EXACT** product order (1–19).

| # | `channel` | `label` | `layout` | `provider` | `crawl_source_id` | `feeds_issues` |
|---|---|---|---|---|---|---|
| 1 | `viral` | Viral | `text` | `viral_x` | `null` | `false` |
| 2 | `egi_media` | EGI Media | `card` | `cms` | `null` | `true` |
| 3 | `detik` | Detik | `card` | `crawl` | `detik` | `true` |
| 4 | `viva` | VIVA | `card` | `crawl` | `viva` | `true` |
| 5 | `suara` | Suara | `card` | `crawl` | `suara` | `true` |
| 6 | `cnn_indonesia` | CNN Indonesia | `card` | `crawl` | `cnn_indonesia` | `true` |
| 7 | `liputan6` | Liputan6 | `card` | `crawl` | `liputan6` | `true` |
| 8 | `tirto` | Tirto | `card` | `crawl` | `tirto` | `true` |
| 9 | `tempo` | Tempo | `card` | `crawl` | `tempo` | `true` |
| 10 | `kumparan` | Kumparan | `card` | `crawl` | `kumparan` | `true` |
| 11 | `jawa_pos` | Jawa Pos | `card` | `crawl` | `jawa_pos` | `true` |
| 12 | `okezone` | Okezone | `card` | `crawl` | `okezone` | `true` |
| 13 | `sindonews` | SINDOnews | `card` | `crawl` | `sindonews` | `true` |
| 14 | `idn_times` | IDN Times | `card` | `crawl` | `idn_times` | `true` |
| 15 | `republika` | Republika | `card` | `crawl` | `republika` | `true` |
| 16 | `media_indonesia` | Media Indonesia | `card` | `crawl` | `media_indonesia` | `true` |
| 17 | `merdeka` | Merdeka | `card` | `crawl` | `merdeka` | `true` |
| 18 | `beritasatu` | BeritaSatu | `card` | `crawl` | `beritasatu` | `true` |
| 19 | `tribunnews` | Tribunnews | `card` | `crawl` | `tribunnews` | `true` |

**Counts (locked):** 19 channels total; 1 viral + 1 cms + 17 crawl; 18 `feeds_issues=true` candidates excluding Viral.

**Forbidden in F0 registry:** Kompas, Antara, or any id not present in `listAdapterIds()` — inventing adapters is a FAIL.

---

## 3. News Feed item DTO (locked sketch)

Envelope (illustrative):

```json
{
  "items": [ /* NewsFeedItem */ ],
  "next_cursor": "opaque-or-null"
}
```

### `NewsFeedItem`

| Field | Req | Type | Notes |
|---|---|---|---|
| `id` | required | string | Feed-row id (opaque). May equal issue-source id when `feeds_issues` channel; Viral uses provider-native id later. |
| `channel` | required | string | Registry `channel` slug |
| `provider` | required | string | `viral_x` \| `cms` \| `crawl` |
| `layout` | required | string | `card` \| `text` (must match registry for that channel) |
| `title` | required | string | |
| `summary` | optional | string \| null | Preferred for card channels; may be null |
| `published_at` | optional | string \| null | ISO 8601 |
| `source_url` | optional | string \| null | Canonical/outbound URL when available |
| `thumbnail_url` | **required key** | string \| null | **Always present on the object.** Nullable. See image mapping below. |
| `crawl_source_id` | optional | string \| null | Echo of crawl adapter id when `provider=crawl`; else null/omit |
| `issue_source_id` | optional | string \| null | Prefixed id (§5) when channel `feeds_issues`; **omit / null for Viral** |

### Image field mapping (crawl → feed DTO)

| Layer | Field | Rule |
|---|---|---|
| Crawl N5 / crawl DB | `thumbnail_url` | SoT optional image URL (`N5_CONTRACT_LOCKED.md`) |
| `toEgiArticleRead` | `featured_image` | Alias of crawl `thumbnail_url` (read convenience only) |
| News Feed DTO | `thumbnail_url` | **Always include the key.** Value = crawl `thumbnail_url` when present; else `null`. Consumers may also accept CMS `featured_image` mapped into this same key. |
| Viral | `thumbnail_url` | May always be `null` (text layout) |

**Do not** drop the key when absent — FE card layout relies on a stable nullable `thumbnail_url`.

### CMS card mapping (spot-check)

CMS published articles expose editorial `featured_image` / `summary` / `title` / `id` (UUID). Feed mapper: `thumbnail_url ← featured_image || null`.

---

## 4. Proposed API (sketch only — not implemented in F0)

```
GET /api/v1/news-feed?channel=<slug>&cursor=<opaque>&limit=<1..100>
```

| Query | Rules |
|---|---|
| `channel` | Optional; defaults to `egi_media`. When supplied, must be a registry slug (§2). |
| `cursor` | Optional opaque pagination token; omit for first page. |
| `limit` | Optional; default e.g. 20; clamp 1–100. |

For crawl channels, rows are ordered by `COALESCE(published_at, collected_at) DESC, article_id DESC`. The cursor is exclusive and carries both values, so equal timestamps neither duplicate nor skip rows across pages. `published_at` remains nullable in the response; `collected_at` is only the ordering fallback.

**Auth note only:** Same auth posture as existing AI backend authenticated CMS/issue list routes (tenant session / bearer as already used by All Issues). F0 does **not** invent a new public unauthenticated surface.

**Response (sketch):** `{ "success": true, "data": { "items": NewsFeedItem[], "next_cursor": string | null } }` aligned with existing AI API envelope conventions where practical.

**Out of F0:** No route registration, no OpenAPI change, no FE calls.

---

## 5. Issue source ID format (Phase 4 lock)

| Provider | Format | Example |
|---|---|---|
| CMS | `cms:<uuid>` | `cms:550e8400-e29b-41d4-a716-446655440000` |
| Crawl | `crawl:<source_id>:<key>` | `crawl:detik:a1b2c3…` |
| Legacy CMS | bare `<uuid>` | Still accepted by gate for backward compat |

### `<key>` definition (locked preference)

**`<key>` = crawl `content_hash`** (N5 required, pipeline-guaranteed via `computeContentHash`).

**Justification:**

1. **Always present** at store gate (`REQUIRED_ARTICLE_FIELDS` includes `content_hash`) — unlike `external_article_id` (optional) or raw URLs (encoding / length pain in path-like ids).
2. **URL-safe compact token** — hex/hash string; no need to embed full `normalized_url` in the id.
3. **Content-snapshot semantics** fit AI ingest: when body changes, hash changes → new snapshot identity, which matches revision behavior (`article_revisions` on hash change).
4. **Stable within a snapshot**; pairs with `source_id` uniquely enough for issue linking without writing into CMS.

**Explicit non-choice for F0:** `normalized_url` (or sha256 of it) would be better for *URL-stable* identity across rewrites, but is longer/encoding-sensitive as a raw key. If product later needs URL-stable ids across content edits, bump a follow-on ADR; F0 locks **`content_hash`**.

**Crawl unique store note:** Upsert identity in crawl DB is `(source_id, canonical_url)`; `content_hash` versions content. Issue-source ids intentionally track **content snapshot**, not only URL row.

### Phase 4 gate extension (compat)

| Input | Behavior |
|---|---|
| Bare UUID | CMS path (today’s `CmsSourceGate`) — **unchanged** |
| `cms:<uuid>` | Strip prefix → same CMS path |
| `crawl:<source_id>:<content_hash>` | Validate `source_id ∈ listAdapterIds()`; resolve from crawl read path; **never** CMS write |
| Other / `viral:…` | Reject |

Viral must not mint `issue_source_id`.

---

## 6. Non-goals

### F1–F3 (News Feed delivery — after this ADR)

| In scope later | Still non-goal |
|---|---|
| News Feed API implementation behind §4 | Writing crawl → CMS `articles` |
| FE rename All Issues → News Feed + 19 tabs | Viral X API production integration (stub/empty OK) |
| Card UI for non-Viral; text list for Viral | Issue-pipeline / `CmsSourceGate` changes |
| Mapping crawl/CMS → `NewsFeedItem` incl. `thumbnail_url` | DB migrations for AI issue tables |

### F4–F5 (Issue multi-source — later)

| In scope later | Still non-goal |
|---|---|
| Prefixed issue-source ids (§5) | Merging crawl rows into editorial CMS |
| Extend gate/resolvers for `crawl:…` | Treating Viral as issue evidence |
| Ingest/poll crawl alongside CMS | Inventing unregistered adapters (Kompas/Antara/…) |

**F0 itself:** contract + self-audit only. No features, no routes, no FE, no migrations, no git commit.

---

## 7. F0 self-audit checklist

Audit date: **2026-07-26**. Codebase cross-check against `listAdapterIds()` runtime output and product nav list.

| # | Check | Result | Evidence |
|---|---|---|---|
| A1 | Exactly **17** crawl channels; each `crawl_source_id` ∈ `ADAPTER_MODULES` / `listAdapterIds()` | **PASS** | Runtime: `detik, viva, suara, cnn_indonesia, liputan6, tirto, tempo, kumparan, jawa_pos, okezone, sindonews, idn_times, republika, media_indonesia, merdeka, beritasatu, tribunnews` (count 17). Registry §2 matches 1:1. |
| A2 | No Kompas / Antara (or other unregistered) crawl channels | **PASS** | Absent from `ADAPTER_MODULES` and from §2. |
| A3 | Nav order matches product list (Viral → … → Tribunnews) | **PASS** | §2 rows 1–19 identical to product vision order and labels. |
| A4 | Viral `feeds_issues = false`; provider `viral_x`; layout `text` | **PASS** | §2 row 1. |
| A5 | Issue sources = CMS + 17 crawl only | **PASS** | `feeds_issues=true` for `egi_media` + 17 crawl; Viral false. |
| A6 | Image mapping crawl → DTO documented; feed always has `thumbnail_url` key | **PASS** | §3: N5 `thumbnail_url` → `toEgiArticleRead.featured_image` → feed `thumbnail_url` (nullable, key required). |
| A7 | Two-path decision (News Feed vs Issue); Viral out of issues | **PASS** | §1. |
| A8 | Phase 4 ID formats locked; CMS UUID path preserved | **PASS** | §5: `cms:<uuid>` + legacy bare UUID; `crawl:<source_id>:<content_hash>`. |
| A9 | Hard rule: no crawl writes into CMS `articles` | **PASS** | Header hard rules + §1 / §6. |
| A10 | Labels match product strings (incl. VIVA, CNN Indonesia, SINDOnews, BeritaSatu, etc.) | **PASS** | §2 `label` column vs product vision. |

**Checklist verdict: all PASS.**

---

## 8. Resolved product questions

All previously deferred product questions are resolved and locked:

1. Default channel: **`egi_media`**.
2. Pre–X Viral behavior: keep the tab visible and show a **“Coming soon” empty state**.
3. Crawl ordering/cursor: effective timestamp `COALESCE(published_at, collected_at)` descending, then `article_id` descending; opaque cursor and exclusive tuple comparison as defined in §1 and §4.

---

## Revision policy

- **F0 lock break** (channel order, adapter set, ID format, Viral `feeds_issues`, thumbnail key rule) requires a new ADR revision and explicit re-audit.
- Additive optional DTO fields are non-breaking under this document if required keys remain.
