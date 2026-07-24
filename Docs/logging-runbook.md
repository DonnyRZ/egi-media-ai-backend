# Logging Runbook

The backend emits one JSON log entry per line. In local development, the process manager may redirect stdout/stderr to `logs/dev.out.log` and `logs/dev.err.log`. In Docker/VPS, collect stdout/stderr as container logs; do not write credentials or raw business payloads to files.

## Inspect a failing request

```powershell
npm run logs:inspect -- --event http_error_envelope --limit 50
npm run logs:inspect -- --request-id <request-id>
npm run logs:inspect -- --correlation-id <correlation-id>
npm run logs:inspect -- --error-code AI_PROVIDER_REJECTED
npm run logs:inspect -- --task T01_company_context_draft
```

Use the `request_id` returned in the API error envelope. Follow the same `correlation_id` across HTTP, AI, persistence, queue, and delivery events.

## PDF diagnosis

Expected sequence:

1. `pdf_upload_received`
2. `pdf_extraction_succeeded` or `pdf_upload_failed` with `PDF_*`
3. `ai_task_started` for T01
4. `ai_task_succeeded`, `ai_output_rejected`, or `ai_task_failed`
5. `http_request_completed` with the final status

`AI_PROVIDER_REJECTED` means the request reached the provider boundary. Use the same request ID to inspect the safe provider status/type/code and provider request ID. It does not mean the user lacked company permission.

## Redaction rules

Never add raw prompt, PDF text, company context, article content, token, password, API key, SMTP app password, recipient, or subject to a log field. Add a bounded hash or an opaque ID when correlation is required.

## Operator expectations

- `warn`: investigate if recurring, but the request may be safely rejected or retried.
- `error`: request/job/provider/persistence failed; use request or job identifiers to reconstruct the path.
- `fatal`: process-level intervention is required.
- Audit events remain the source of truth for authorization and human approval decisions.
