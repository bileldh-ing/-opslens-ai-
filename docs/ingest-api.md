# HTTP log ingestion API

Ship logs to OpsLens from any collector or app over HTTPS. Ingested lines go through the same
pipeline as file uploads: normalisation → error fingerprinting → error groups → automatic
incidents with deployment correlation → webhook notifications.

## Authentication

Create a key in **Settings → Ingest API keys** (admins and owners). Keys are scoped to one
project, look like `olk_AbCd1234_<secret>`, are shown **once**, and are stored as a SHA-256
hash. Revoking a key takes effect on the next request.

```
Authorization: Bearer olk_AbCd1234_...
```

## Endpoint

`POST /api/v1/logs[?service=<default-service-name>]`

| Content | `Content-Type` | Example |
|---|---|---|
| JSON lines (NDJSON) | `application/x-ndjson` or `text/plain` | one JSON object per line |
| Plain text lines | `text/plain` | `2026-10-20T14:05:00Z ERROR [payment-service] Gateway timeout` |
| JSON array | `application/json` | `[{"message":"…"}, …]` or `{"logs":[…]}` |
| OTLP logs (JSON encoding) | `application/json` | `{"resourceLogs":[…]}` (ExportLogsServiceRequest) |

Recognised JSON fields: `timestamp`/`time`/`@timestamp` (ISO-8601 or epoch ms), `level`/`severity`
(names or pino numeric levels), `service`, `message`/`msg`, `trace_id`/`traceId`, `file`, `line`.
Every other field is kept as an attribute.

OTLP mapping: resource `service.name` → service, `timeUnixNano` (fallback `observedTimeUnixNano`)
→ timestamp, `severityText` or `severityNumber` → level, `body` (string, or structured → JSON) →
message, `traceId`/`spanId` and record attributes → attributes. Protobuf encoding is not
supported; configure the collector exporter with `encoding: json`.

Limits: 5 MB per request, 120 requests per minute per key (HTTP 429 with `Retry-After`).

## Responses

| Status | Meaning |
|---|---|
| `200` | Processed inline (no Redis): `{ jobId, mode: "inline", format, accepted, rejected, errorGroups, incidents }` |
| `202` | Queued to the BullMQ worker (Redis configured): `{ jobId, mode: "queued", format }` |
| `400` | Empty body, malformed OTLP, or no records |
| `401` | Missing, malformed, unknown or revoked key |
| `413` | Body over 5 MB |
| `429` | Rate limited |

## Examples

```bash
# NDJSON file
curl -X POST https://opslens.example.com/api/v1/logs \
  -H "Authorization: Bearer $OPSLENS_KEY" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @app.log.jsonl

# Single event
curl -X POST https://opslens.example.com/api/v1/logs?service=billing \
  -H "Authorization: Bearer $OPSLENS_KEY" -H "Content-Type: application/json" \
  -d '{"level":"error","message":"invoice render failed","trace_id":"4bf92f35"}'
```

OpenTelemetry Collector:

```yaml
exporters:
  otlphttp/opslens:
    logs_endpoint: https://opslens.example.com/api/v1/logs
    encoding: json
    headers:
      Authorization: "Bearer ${env:OPSLENS_KEY}"
service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp/opslens]
```

Vector:

```toml
[sinks.opslens]
type = "http"
inputs = ["app_logs"]
uri = "https://opslens.example.com/api/v1/logs"
encoding.codec = "json"
framing.method = "newline_delimited"
request.headers.Authorization = "Bearer ${OPSLENS_KEY}"
```
