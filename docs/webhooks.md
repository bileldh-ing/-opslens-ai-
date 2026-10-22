# Webhooks & Slack notifications

Configure in **Settings → Notifications & webhooks** (admins and owners).

## Events

| Event | When |
|---|---|
| `incident.created` | Ingestion opens a new incident (file upload, HTTP ingest, or worker job) |
| `incident.status_changed` | Someone acknowledges, mitigates, resolves or reopens an incident |
| `webhook.test` | The **Test** button |

## Formats

**Generic JSON**

```json
{
  "id": "4f0c…",                       // delivery id, also in X-OpsLens-Delivery
  "event": "incident.created",
  "occurredAt": "2026-10-20T14:05:12.000Z",
  "data": {
    "id": "…", "title": "PaymentGatewayTimeout: gateway timeout after <n>ms",
    "severity": "sev2", "status": "open", "service": "payment-service",
    "project": "Production", "url": "https://opslens.example.com/acme/incidents/…",
    "previousStatus": "open", "changedBy": "Demo Engineer"   // status changes only
  }
}
```

**Slack-compatible**: `{ "text": "...", "blocks": [...] }`, accepted by Slack incoming webhooks
(and by Mattermost / Discord's `/slack` endpoint).

## Verifying signatures

Every delivery carries:

```
X-OpsLens-Event: incident.created
X-OpsLens-Delivery: <uuid>
X-OpsLens-Timestamp: <unix seconds>
X-OpsLens-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
```

The signing secret (`whsec_…`) is shown once when the webhook is created. Reject requests whose
timestamp is more than 5 minutes old, and compare in constant time:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret: string, ts: string, rawBody: string, signature: string) {
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

`npm run webhook:receiver` starts a local receiver on :4000 that prints and verifies deliveries.

## Delivery semantics

- POST with a 5 s timeout, redirects are not followed; any non-2xx counts as a failure.
- Every attempt is recorded in the delivery log (status code, latency, error) shown in Settings.
- Failures never block ingestion or status changes. There are no automatic retries yet.
- SSRF protection: only http(s); hosts resolving to loopback, private, link-local or CGNAT
  ranges are refused at creation **and** re-checked at send time. `ALLOW_PRIVATE_WEBHOOK_TARGETS=true`
  lifts this for local demos and is rejected at startup on a public production `APP_URL`.
