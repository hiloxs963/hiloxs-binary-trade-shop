# ADR 0011: Staff step-up re-verification instead of session age

## Status

Accepted for implementation (migration 0013). Supersedes the "session no more than 30 minutes old" rule in ADR 0007.

## Context

Staff review mutations required `session.createdAt` to be within 30 minutes, so staff repeated the full password + TOTP sign-in every half hour. Reads had no freshness requirement at all, and a session's creation time says nothing about when the second factor was last proven.

## Decision

Each session records `last_mfa_verified_at`: set when a TOTP or backup code completes sign-in, and refreshed by a **step-up**. It is never set for email-OTP sessions (staff are TOTP-only; `assertStaffSessionMfaMethod` still rejects them first).

`requireStaffPermission` checks that timestamp instead of the session age, in two tiers (constants in `staff/model.ts`, no configuration):

| Tier   | Window     | Applies to                                                                                                                                                 |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| normal | 8 hours    | every read, and `start-review`                                                                                                                             |
| high   | 30 minutes | every approval, every rejection (application, product, media), activation, deactivation, enable/pause commerce, and future takedowns and permission grants |

Routes pass `{ stepUp: "normal" | "high" }`. The chosen tier travels in `StaffAuthorization` and is re-checked inside the write transaction (`lockAuthorizedActor`), next to the existing membership and grant checks.

`POST /api/v1/staff/step-up` (`{ method: "totp" | "backup-code", code }`) re-verifies the second factor for the **current** session: no password and no new session. It uses better-auth's session-mode verification, which has no attempt counter, so the endpoint counts failures itself:

- a rate limit of 5 attempts per 10 minutes per user;
- a per-session failure counter; **five consecutive failures delete the session**;
- every failure also increments the shared account counter (`two_factor.failed_verification_count`), which locks the account for 15 minutes at 10, exactly as sign-in and email-OTP verification do;
- every outcome writes an `auth_security_events` row (`STAFF_STEP_UP_SUCCEEDED`, `_FAILED`, `_SESSION_REVOKED`, `_REFUSED`) with a keyed IP digest and never a code.

Unchanged: the session must postdate the membership and each grant (a step-up cannot revive an older session), email-OTP sessions are rejected, and `/api/v1/staff/me` is not gated so the console can read when to prompt (it now reports `stepUp.normalValidUntil` / `highValidUntil`).

## Consequences

- **Tradeoff of the shared account counter:** someone holding a stolen session cookie can burn the account's failure budget and lock the legitimate staff member out of TOTP sign-in for 15 minutes. That requires an already-compromised session, and the same attacker can already act within the open window, so the alternative (a per-session-only counter) would let repeated stolen sessions brute-force the code. The per-session revocation limits the damage to one session.
- **Reads are now gated.** A staff session idle for more than 8 hours needs one inline step-up before reading the queue.
- **Existing sessions** have a null timestamp and need one step-up after the API deploy, not a full sign-in.
- **Deploy order.** The frontend auto-deploys on merge to `main`; the API is deployed manually. The staff console therefore goes live first and handles both error codes: `STAFF_RECENT_AUTH_REQUIRED` (old API: it shows the existing "sign in again" message) and `STAFF_STEP_UP_REQUIRED` (new API: inline prompt, then one retry). The old API returns the old code until the new API is deployed.
- The takedown and permission-grant endpoints that do not exist yet must use `{ stepUp: "high" }` from day one.
