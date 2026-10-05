# Production Readiness and Feature Controls

This document describes repository behavior. It does not assert that Railway, cPanel, DNS, email,
storage, or payment-provider settings have been verified in production.

## Launch blockers

- Railway backup configuration and one isolated restore drill must be verified.
- The owner and legal reviewer must approve privacy retention and all customer-facing policies.
- Monitoring provider, alert destinations, and named on-call owners must be selected and tested.
- SPF, DKIM, DMARC reporting/alignment, bounce handling, and Gmail/Outlook/Yahoo delivery must be
  verified for `auth@mail.hiloxs.co.ke` without logging tokenized links.
- Apex/API TLS coverage, renewal, HTTP-to-HTTPS and `www` redirects, DNS, HSTS, and Search Console
  verification must be tested. Preserve the existing Search Console TXT record.
- Operational Phase 8 remains parked: no production S3 bucket/credentials, media worker deployment,
  media upload enablement, or catalog activation is performed here.
- Phase 10 remains parked: no production Daraja credentials, shortcode/till switch, or live payment.
- Staff review, seller commerce, seller order actions, media, catalog activation, and public M-Pesa
  must remain disabled until their individual launch reviews pass.

## Feature flags

All booleans default to false. Changing repository defaults does not change production values.

| Flag                           | Blocks when false                                              | Intentionally does not block                                                                                 |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `STAFF_REVIEW_ENABLED`         | Staff seller/product review mutations                          | Authenticated, permission-checked staff reads                                                                |
| `EMAIL_OTP_ENABLED`            | Offering, sending, and verifying emailed sign-in codes         | Password, TOTP, and backup-code sign-in; existing enrollments stay dormant (ADR 0010)                        |
| `MEDIA_UPLOAD_ENABLED`         | New seller media upload preparation/finalization               | Existing media reads and safe processing/reconciliation                                                      |
| `CATALOG_ACTIVATION_ENABLED`   | New staff catalog activation mutations                         | Existing public product reads                                                                                |
| `SELLER_COMMERCE_ENABLED`      | New seller-commerce enablement and new seller-product commerce | Settlement, reservation expiry/release, cancellation, and fulfillment safety for existing orders             |
| `SELLER_ORDER_ACTIONS_ENABLED` | Seller accept/prepare/dispatch/issue mutations                 | Required system reconciliation and customer delivery confirmation paths                                      |
| `MPESA_PUBLIC_ENABLED`         | Ordinary public STK initiation                                 | Existing callback/query reconciliation; sandbox `HX-SBX-*` test-order controls remain separately constrained |

Do not stop workers or callbacks needed to safely reconcile existing payments and orders merely to
pause new commerce.

## Deployment order

1. Require green API and frontend CI.
2. Verify a current backup and its checksum.
3. Review the forward-only migration and compatibility window.
4. Confirm kill switches remain in the intended safe state.
5. Manually deploy the backward-compatible API with Railway Auto Deploy still disabled.
6. Run `npm run db:migrate:prod` explicitly from the reviewed production image.
7. Verify `/health`, then `/ready`, then authenticated read-only smoke tests.
8. Deploy the validated static frontend artifact.
9. Monitor errors, latency, workers, payments, and fulfillment queues.

When `0011` and `0012` ship together, follow the combined rollout in
[`backup-restore-migrations.md`](./backup-restore-migrations.md): that release migrates **before** deploying
the API, because the new API requires `session.mfa_method`.

If migration fails, halt and investigate. Do not run destructive down migrations or improvise direct
production SQL. Application startup never runs migrations.

## Runtime sizing and shutdown

Each process has its own bounded PostgreSQL pool. The current defaults budget up to 10 API
connections, 2 media-worker connections, and 2 reservation-worker connections per deployed replica
(14 total), plus migration/administrative headroom. Verify this total against the provider limit
before scaling replicas.

The API and workers handle `SIGTERM`/`SIGINT`, stop accepting new work, finish or release current
work, close PostgreSQL, and enforce a 25-second upper bound. A second signal exits immediately.
Runtime filesystem writes are not required outside platform-provided temporary space; validate a
read-only root filesystem separately before enabling it.

## Client address resolution

Rate limits key on `request.ip`. Fastify trusts `X-Forwarded-For` only from `TRUSTED_PROXY_CIDRS`
(production default `100.64.0.0/10`, Railway's proxy range per community reports; see ADR 0002 for the
rule and why it does not depend on hop count). The Railway evidence is inconsistent, so verify it once
after deploying:

| Source                                                | What it says                                                                                                                                                                                                                       | Reliability                      |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Railway public-networking docs                        | `X-Real-IP` carries the client's remote IP; says nothing on `X-Forwarded-For` or hops                                                                                                                                              | Official, incomplete             |
| Railway staff, community threads (2024-08 to 2026-06) | Edge appends to `X-Forwarded-For` (client address leftmost) or strips client values; client can no longer set `X-Real-IP`; `X-Real-IP` reported wrong on some CDN routes; "typically 1" hop, "not officially documented as stable" | Unofficial, partly contradictory |
| `api.hiloxs.co.ke` DNS                                | CNAME straight to `*.up.railway.app`; no other CDN in front                                                                                                                                                                        | Checked 2026-10-06               |

Production check (never logs raw addresses; remove the variable afterwards):

1. Set `CLIENT_IP_DIAGNOSTIC=true` and redeploy. Confirm `RATE_LIMIT_HMAC_KEY` is set.
2. From your own network run `curl -s -H 'x-hiloxs-ip-check: 1' https://api.hiloxs.co.ke/health`, then
   once more adding `-H 'X-Forwarded-For: 1.2.3.4'`.
3. Compute your digest locally from a checkout, passing the key through the environment rather than
   the command line: `RATE_LIMIT_HMAC_KEY=<key> node api/scripts/client-ip-digest.mjs "$(curl -s https://api.ipify.org)"`
   (for example via `railway run`). The script is not shipped in the image.
4. In Railway logs find the two `client_ip_diagnostic` entries. Expected: `clientIpDigest` equals your
   digest in **both** (the spoofed header changed nothing), `clientIsPeer` is `false`, `socketPeerDigest`
   differs, and `forwardedForEntries` is at least 1 (more in the spoofed request).
5. If `clientIsPeer` is `true`, trust is not applying: read `socketPeerNetwork` (for example `100.64.*.*`
   or `10.12.*.*`), set `TRUSTED_PROXY_CIDRS` to the proxy block that contains it, and repeat. Do not use
   a catch-all range; it is rejected at startup.
6. Optionally corroborate with Railway's HTTP logs for the same request (field names unverified).
7. Remove `CLIENT_IP_DIAGNOSTIC` and redeploy.

Do not enable features whose limits assume per-client addresses (for example `EMAIL_OTP_ENABLED`) until
this check has passed.

## Email OTP key and rollout

`EMAIL_OTP_HMAC_KEY` is a manually generated production secret of at least 32 characters, independent
of `BETTER_AUTH_SECRET` and `RATE_LIMIT_HMAC_KEY`. It keys the stored code hashes and pending-login
digests. Enabling `EMAIL_OTP_ENABLED` without it fails startup.

Rotating it invalidates every outstanding code (they live at most 10 minutes) and nothing else.
Before enabling the flag, confirm Resend delivery for `auth@mail.hiloxs.co.ke` to Gmail, Outlook, and
Yahoo (see the launch blockers), because a code that never arrives only has TOTP as a fallback. Review
`auth_security_events` (`EMAIL_OTP_SEND_FAILED`, `EMAIL_OTP_LOCKED`) after enabling.

Per-IP send caps use the client IP the API sees. `EMAIL_OTP_ENABLED` must stay `false` until the client-IP
fix (`trustProxy` limited to Railway's proxy range) is deployed and its production check has passed;
without it every user shares one address and one per-IP cap.

## Rate-limit key operations

`RATE_LIMIT_HMAC_KEY` is a manually generated production secret of at least 32 characters. Store it
only in the platform secret manager. It HMACs normalized client identifiers before PostgreSQL storage;
the table must never receive raw IPs, emails, or user IDs.

Rotation changes every identifier digest, effectively opening fresh windows. Schedule rotation during
a low-risk period, retain edge rate limiting, monitor auth/checkout traffic, deploy all API replicas
with one new value, and securely destroy the old value after verification. The implementation does
not support dual-key overlap.

## Staff operations

Use unique accounts only. Password/MFA sharing is prohibited. Verified MFA, least privilege, explicit
permission grants, and a fresh post-grant session are mandatory. Revoke sessions after grants change
and immediately after suspected compromise. Review active memberships and grants periodically; the
owner must approve cadence and reviewers. Never use query parameters, browser admin modes, shared
keys, or hardcoded identities.

## Email and domain checklist

- Verify SPF, DKIM, DMARC reporting and From-domain alignment.
- Configure and test bounce/complaint handling without logging message bodies or tokenized links.
- Test Gmail, Outlook, and Yahoo delivery; record date and non-sensitive result.
- Rotate provider keys through the secret manager and revoke the old key after validation.
- Verify `https://hiloxs.co.ke`, `https://api.hiloxs.co.ke`, `www` redirect, HTTP redirect,
  certificate hostname coverage/expiry/renewal, DNS, HSTS, and Search Console ownership.
- Preserve the existing Search Console TXT record. Do not change DNS from this repository task.

## Rollback

Rollback application artifacts only when they remain schema-compatible. Prefer a forward fix after a
migration. The previous static release must remain available on cPanel for an atomic symlink rollback;
see `static-deployment.md`. Re-verify health, readiness, and read-only workflows after rollback.
