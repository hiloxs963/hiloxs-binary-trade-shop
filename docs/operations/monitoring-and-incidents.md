# Monitoring, Alerts, and Incident Runbooks

## Signals

Structured events and bounded fields must cover API 5xx/latency, auth denial spikes, checkout and
order-create failures, payment `UNKNOWN`/`REVIEW_REQUIRED`/`PAYMENT_REVIEW_REQUIRED`, fulfillment
issues, PostgreSQL connectivity/pool errors, and media/reservation worker start/heartbeat/failure/
backlog. Metrics labels must be low-cardinality enums or route templates, never email, phone, user ID,
order number, address, product text, provider response, or request body. Use request IDs to correlate
restricted logs.

Monitoring vendor, notification destination, thresholds, and named responders are owner/operations
decisions and launch blockers. Suggested severities: P1 for complete API/checkout/payment outage,
data loss, or security event; P2 for partial feature outage, DB degradation, or worker failure/backlog;
P3 for sustained latency/degradation trends.

## Common incident procedure

Every incident uses: detect and assign severity; contain with the narrowest accurate feature control;
preserve timestamps, request IDs, release manifest, audit events, and provider references without PII;
recover through reviewed configuration/artifact/forward fixes; verify health, readiness, and affected
business state; communicate factual status without guarantees; then complete a blameless review with
actions and owners.

## Scenario containment

| Scenario                        | Immediate containment and recovery focus                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API outage                      | Stop new frontend actions if needed; verify Railway process, `/health`, `/ready`, DB pool, release SHA; restore last schema-compatible API or forward-fix         |
| DB outage                       | Prevent new mutations; preserve connection errors; restore connectivity/provider capacity; do not start from a stale unverified backup                            |
| Payment ambiguity spike         | Disable new public M-Pesa initiation if appropriate, but keep callbacks/query reconciliation running; never tell users to pay again while unknown/review-required |
| Credential leak                 | Revoke/rotate the affected key, revoke relevant sessions, preserve access/audit evidence, deploy sanitized config; do not print the leaked value                  |
| Staff compromise                | Suspend membership/grants through approved internal operations, revoke all sessions, preserve audit evidence, require credential/MFA recovery and new session     |
| Seller-commerce emergency pause | Disable new seller commerce/order actions as appropriate; continue existing settlement, expiry/release, cancellation, and safe fulfillment paths                  |
| Bad deployment                  | Stop rollout; compare release SHA/manifest/checksums; switch to the previous schema-compatible artifact; monitor after verification                               |
| Data corruption                 | Freeze affected writes, capture scope/evidence, take a forensic backup, restore only into isolation, prepare reviewed repair/forward migration                    |
| Media-worker failure            | Keep uploads disabled or pause new work; preserve failed media IDs only in restricted logs; repair worker/storage then resume idempotent processing               |
| Reservation backlog             | Block new seller commerce if needed; keep expiry/release worker operating; inspect poison-item isolation and DB capacity; never bypass row locks                  |

For every scenario, customer/staff communication must distinguish confirmed facts from unknown state.
Payment ambiguity is not payment failure, and delivery timing is not guaranteed.
