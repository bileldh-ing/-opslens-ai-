# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ security fixes |
| < 1.0 | ❌ |

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/bileldh-ing/-opslens-ai-/security/advisories/new)
or by email to dhahribilel1807@gmail.com with "OpsLens security" in the subject.

Include affected version/commit, reproduction steps, and impact. You will get an acknowledgement
within 72 hours and a remediation plan within 7 days for confirmed issues. Coordinated disclosure
is appreciated; reporters are credited in the release notes unless they prefer otherwise.

## Security model (summary)

- **Sessions**: opaque 256-bit tokens in `httpOnly`, `SameSite=Lax`, `Secure` (production) cookies; only SHA-256 hashes are stored.
- **Passwords**: bcrypt (cost 12). Sign-in is protected by three sliding windows (IP+account, IP, account) that count failures only; Redis-backed when `REDIS_URL` is set.
- **Tenancy**: every query is scoped by organization; non-members receive 404. AI agent tools are constructed per project.
- **RBAC**: owner / admin / member / viewer with server-side checks on every write path.
- **API keys**: project-scoped, shown once, stored as SHA-256, instantly revocable, rate limited.
- **Webhooks**: HMAC-SHA256 signatures with timestamps, SSRF guard on creation and at send time, no redirects followed.
- **Headers**: CSP (`frame-ancestors 'none'`, `object-src 'none'`, same-origin defaults), HSTS on HTTPS, `X-Frame-Options: DENY`, `nosniff`, strict referrer and permissions policies. `script-src` keeps `'unsafe-inline'` because the Next.js App Router injects inline bootstrap scripts.
- **Audit log**: sign-ins, project/member changes, incident status changes and exports, investigations, remediation reviews, API key and webhook lifecycle, eval runs (with actor and IP).
- **Exports**: CSV output neutralises spreadsheet formula injection.
- **Supply chain**: Dependabot, CodeQL, Trivy image scanning, SBOM and build provenance attestations on published images.
- **AI safety**: remediations are proposals that require human approval; citations are verified against tool output before display.
