# Postmortem: March 2026 payment failures

Root cause: a config change lowered the gateway timeout to 1500ms. Gateway p99 was 3.1s, so ~8% of charges timed out and returned 500.
Resolution: timeout restored to 10s; added an alert on PaymentGatewayTimeout rate.
Lesson: timeouts must be set above observed p99 latency, and changes to them need review.
