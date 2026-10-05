# ADR 0010: Email OTP as an alternative second factor

## Status

Accepted for implementation. Shipped disabled: `EMAIL_OTP_ENABLED` defaults to `false`.

## Decision

Users who already have a verified TOTP factor may additionally opt in to receive a one-time code by email at the second-factor step of login. TOTP stays the baseline; email OTP is never a replacement and never the only factor.

**Eligibility.** Email OTP is offered only to accounts that are not staff, have a verified email, and have a verified TOTP enrollment. There is no password-only enrollment path. Staff (any membership row with status `ACTIVE`) are TOTP-only, hard-coded, with no configuration toggle:

- enrollment and verification are refused for active staff;
- creating a staff membership disables the user's email OTP in the same transaction;
- sessions carry `mfa_method`, and `requireStaffPermission` / `requireStaffProfile` reject `email-otp` sessions.

**Implementation.** Email OTP is a small local better-auth plugin plus its own tables, not better-auth's built-in `twoFactor({ otpOptions })`. The built-in flow stores codes in plaintext or as an unkeyed hash, does not invalidate earlier codes on resend, has no resend cooldown, reports success when delivery fails, and advertises `otp` to every 2FA user. Its `/two-factor/send-otp` and `/two-factor/verify-otp` routes are explicitly answered with 404 at the Fastify layer so they can never become reachable by configuration drift.

**Challenge rules.**

- 6 digits from `crypto.randomInt`, valid for 10 minutes, single use.
- Stored only as `HMAC-SHA256(EMAIL_OTP_HMAC_KEY, challengeId | userId | code)`. The key is separate from `BETTER_AUTH_SECRET` and `RATE_LIMIT_HMAC_KEY`. Compared with `timingSafeEqual`.
- Bound to the user and to the specific pending login (an HMAC of the signed `two_factor` cookie's identifier). A code from one login cannot complete another.
- At most 5 verification attempts per challenge. Failures also feed the existing per-account two-factor lock (`two_factor.failed_verification_count` / `locked_until`).
- Sending a new code invalidates the previous one. At most one live challenge exists per pending login (partial unique index).
- 60 second resend cooldown, 5 sends per hour per account and 20 per hour per IP. These are counted from the challenge table, so they are exact rather than fixed-window.
- Exactly one session is issued per pending login. The single-use claim is an atomic `UPDATE … WHERE consumed_at IS NULL … RETURNING` on the challenge row, followed by better-auth's atomic consume of the pending verification row.

**Recovery rule.** A password reset arrives through the mailbox, so a mailbox-only attacker could otherwise reset the password and then pass an email challenge. After a password reset, `require_totp_next_login` is set for enrolled users; email OTP is refused (and not offered) until the user completes a TOTP or backup-code login, which clears the flag. The user is told by email that their password was reset. Email therefore never becomes the only factor after an email-based recovery. An attacker who already knows the password _and_ controls the mailbox can still pass an email challenge; that residual risk is inherent to the feature and is why TOTP enrollment is mandatory.

**Failure behaviour.** If the provider fails, the challenge is invalidated and the API answers `503 EMAIL_OTP_SEND_FAILED`; the pending login remains valid so the user can continue with TOTP or a backup code. No path skips or relaxes the second factor. A failed send counts toward the hourly caps but does not start the cooldown.

**Backup codes.** The existing `verify-backup-code` route is exposed in the login UI for every 2FA user, including staff, with rate limiting (per IP and per pending login) and audit events.

**Audit.** A new append-only `auth_security_events` table records send, send failure, success, failure, lockout, enrollment changes, refusals, and backup-code outcomes. It never stores codes; IPs are stored as keyed digests.

**Email content.** The code, its 10 minute lifetime, and "if this wasn't you" guidance. No login link and no code in the subject. Enrollment, disablement, and password-reset notices are sent to the account email.

## Consequences

Migration 0012 adds `email_otp_enrollments`, `email_otp_challenges`, `auth_security_events`, and `session.mfa_method`. With the flag off, endpoints answer 404, the login response never lists `email-otp`, and existing enrollments are dormant while TOTP is untouched. Enabling in production requires `EMAIL_OTP_HMAC_KEY` and verified Resend delivery for `mail.hiloxs.co.ke`; the deployment check in `docs/operations/production-readiness.md` applies.

Out of scope: SMS, trusted devices, email OTP for staff, email-OTP-only accounts, and an admin toggle for any of these.
