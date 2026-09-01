# ADR 0002: Authentication trust model

- Status: Accepted
- Date: 2026-08-30

## Context

The frontend previously displayed authentication-ready forms without a production identity source.
Identity, account state, and permission cannot be established by browser state. HILOXS needs a small
authentication boundary before any customer-owned backend resource can be introduced.

## Decision

Better Auth backed by PostgreSQL is the sole authority for customer identity and sessions. The
following rules apply:

- The server normalizes registration identity fields and owns account status. Clients cannot assign
  roles or status.
- Email verification is required before a session can be created.
- Sessions use opaque HttpOnly cookies. Authentication tokens and session records are not stored in
  frontend localStorage.
- Production cookies are Secure and SameSite=Lax. Credentialed CORS and trusted-origin validation
  use exact origins and never a wildcard.
- Registration, login, reset request, and verification resend are rate limited. Phase 2's in-memory
  store is suitable for one process only; horizontal scaling requires a shared rate-limit store.
  Railway's edge-set `X-Real-IP` header is the only accepted production client-IP header.
- Registration duplicates, invalid credentials, and password-reset requests use responses that do
  not disclose whether an email address is registered.
- Password-reset tokens are single use, expire, and revoke the user's existing sessions after a
  successful password change.
- Email-verification tokens are paired with hashed, expiring, single-use database records and are
  removed atomically before verification.
- Only active accounts may create or retain sessions. Suspended or disabled status is server-owned.
- `/api/v1/users/me` returns the minimum frontend profile and no credentials, tokens, session rows,
  or internal authorization data.
- Authentication emails are delivered through a provider-neutral adapter. Development uses an
  ignored local sink, tests use an in-memory sender, and production uses Resend's HTTPS API with a
  sending-only key restricted to the verified `mail.hiloxs.co.ke` domain.
- Production requires `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, and `FRONTEND_URL` and fails startup when
  any are absent. The expected sender is `HILOXS <auth@mail.hiloxs.co.ke>`; the secret is never
  committed or logged.
- Verification callbacks and reset action destinations are rebuilt from the validated canonical
  `FRONTEND_URL`; request Host, Origin, forwarded-host headers, and arbitrary callback paths cannot
  choose email destinations. Reset tokens travel in a frontend URL fragment, are captured only in
  browser memory, and are removed from the address bar before submission to the API.
- Resend calls use a bounded timeout. Authorization is carried only in the HTTPS header, provider
  response bodies are discarded on failure, and verification/reset tokens and full URLs are not
  logged.
- Registration reports a safe failure if its verification email cannot be accepted by Resend. The
  account remains unverified and can use the rate-limited resend flow. Password-reset responses stay
  generic for both known and unknown accounts even when delivery fails, preserving enumeration
  resistance.

## Consequences

Phase 2 establishes identity but grants no commerce, financial, seller, trading, or administrative
authority. Every later protected resource must derive its owner from the validated server session
and enforce its own server-side authorization. A successful browser login does not make existing
prototype localStorage records trustworthy.
