# Payment service runbook

## Architecture
payment-service calls the card gateway through stripe-proxy. Each charge holds a Postgres connection while waiting for the gateway, so gateway latency directly consumes DB pool capacity.

## Known failure: gateway timeouts
Symptoms: `PaymentGatewayTimeout` errors and HTTP 500 on POST /v1/charges.
Typical p99 gateway latency is 2.5–4s during EU business hours. Timeouts below 5s cause spurious failures.

## Known failure: connection pool exhaustion
Symptoms: "DB connection pool exhausted" warnings. Pool max must be at least 2× peak concurrent charges (≈40 at peak).

## Safe mitigations
1. Roll back to the previous release with `deployctl rollback payment-service`.
2. Raise `GATEWAY_TIMEOUT_MS` via the config service (no deploy required).
3. Never retry charges without an idempotency key.
