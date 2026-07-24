# S31 — Product Contract Gap Register

Status: working contract for S32–S39

## Company Context

The primary product input is a company-profile PDF. A URL remains an allowed alternative. Pasted text is retained only as a controlled fallback for internal testing and migration; it is not the primary UI path.

### Current state

| Capability | Current state | Required state | Classification |
|---|---|---|---|
| Effective context read | Backend and frontend implemented | Keep read-only | Implemented |
| Draft/review/approve lifecycle | Backend and frontend implemented | Keep human-gated | Implemented |
| URL source | Backend and frontend implemented | Keep as alternative | Implemented |
| Pasted text source | Backend and frontend implemented | Keep as fallback only | Implemented, product-secondary |
| PDF upload | Not implemented | Multipart upload with validation | Missing |
| PDF extraction | Not implemented | Safe text extraction with explicit failure states | Missing |
| PDF-to-T01 | T01 accepts sanitized text only | Extraction output must feed T01 Mini | Missing |
| File metadata/provenance | Text/url fingerprints only | File metadata and extraction provenance | Missing |
| Context field rendering | Arrays rendered as JSON | Lists/tags and missing-field states | Incomplete |

## Contract rules to preserve

- Tenant and company scope come from trusted authentication context, never from an arbitrary form field.
- Uploads are human-initiated and require a human actor with `company_context.draft` permission.
- The AI may generate a draft only. It cannot review, approve, or activate an effective context.
- Effective context remains read-only and versioned.
- The source database remains read-only.
- File content is never exposed through a public URL.
- The raw file is not sent to downstream business logic; the extraction service produces bounded, sanitized text.
- T01 remains a single objective: produce a structured draft using only supplied source text.
- Every AI field must retain source provenance through a stable source locator.

## S32–S39 acceptance contract

1. A valid PDF can be uploaded by an authorized human actor for the active company.
2. Invalid type, invalid signature, oversized, empty, encrypted, corrupted, and scan-only PDFs fail closed with a typed error.
3. Successful extraction is bounded by configured page and character limits and produces normalized text.
4. The extracted source is passed to T01 Mini and the structured result is validated before persistence.
5. Draft creation is tenant/company isolated and idempotent.
6. Review, approval, version checks, and effective refresh remain human-controlled.
7. The UI makes PDF upload the primary path, preserves URL as an alternative, and never presents an approved effective context as editable.
8. End-to-end tests use a real PDF fixture and fail if the result is hard-coded or sourced from the clean test context.
