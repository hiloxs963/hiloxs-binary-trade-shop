# ADR 0011: Authenticator replacement and backup-code management

## Status

Accepted. Requires migration 0013; no feature flag.

## Context

Users with two-factor authentication could not replace their authenticator app or see, regenerate or
download their backup codes. A company account holding staff permissions has to be handed to another
person remotely, which needs both. Better-auth 1.7.2 has no safe primitive for it:

- `/two-factor/enable` on an enrolled account overwrites the secret and backup codes immediately,
  keeps the factor `verified`, and needs only the password. The old app dies before the new one is
  proven, and a stolen session plus the password can take the account over.
- `/two-factor/disable` followed by `enable` leaves no second factor in between. Staff
  authorization requires `twoFactorEnabled` and a verified factor, so staff would lose access.
- `/two-factor/generate-backup-codes` needs only the password and neither emails nor audits.

Those three raw routes are closed at the Fastify layer in a separate change, so this feature is the only supported way to change those secrets.

## Decision

Dedicated routes under `/api/v1/account/security`, for signed-in users who already have a verified
authenticator. The live `two_factor` row and `user.two_factor_enabled` are never cleared or written
as disabled.

| Route                            | Effect                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/v1/account/security`   | `{ enrolled, backupCodesRemaining }`                                    |
| `POST …/authenticator/start`     | password + current TOTP **or** unused backup code → pending secret + QR |
| `POST …/authenticator/confirm`   | code from the new app → atomic swap                                     |
| `POST …/backup-codes/regenerate` | password + current TOTP or backup code → new codes, shown once          |

**Re-authentication.** The password is checked first, so a wrong password never spends a backup code.
A backup code that authorizes a change is consumed. One generic `403 REAUTHENTICATION_FAILED` answers
a wrong password or a wrong code. This has its own limiter (`accountSecurityReauth`, 5 per 10 minutes
per user) and does **not** use or modify the login lockout (`failed_verification_count`,
`locked_until`), so a stolen session cannot lock the real user out of signing in.

**Pending secret.** `start` stores the new secret, encrypted with the auth secret, as a row in
better-auth's `verification` table (`authenticator-replace:<userId>`), bound to the starting session
and expiring after 10 minutes. No new table. Starting again replaces it. Five wrong confirmation
codes discard it.

**Swap.** `confirm` verifies a code against the pending secret and then, in one transaction under an
advisory lock and a row lock on `two_factor`: replaces the secret, replaces the backup codes with a
fresh set (returned once), resets the login failure counter, deletes every other session of the user,
deletes the pending row, and writes the audit row. Confirmation must come from the session that
started the change. The notification email is sent after commit and is best effort; the audit row is
the guaranteed record.

**Audit and notice.** New `auth_security_events` types: `AUTHENTICATOR_REPLACE_STARTED`,
`AUTHENTICATOR_REPLACE_FAILED`, `AUTHENTICATOR_REPLACED`, `BACKUP_CODES_REGENERATED`,
`BACKUP_CODES_REGENERATE_FAILED`. Rows hold the user id, a keyed IP digest and a truncated user agent;
never a code. Migration 0013 only widens the type CHECK constraint, which is a superset, so an API
that predates it keeps working against the migrated database.

**Staff.** Replacement is available to staff too and never interrupts their access. Other sessions
are revoked; the session that performed the swap keeps its staff standing.

**Frontend.** The security page asks `GET /api/v1/account/security` and shows the new sections only
when it succeeds. Any failure, including the `404` of an API that predates this change, hides them, so
the frontend (which deploys on merge) can ship before the API (which deploys manually).

## Rollout

1. Run migration 0013.
2. Deploy the API.
3. Merge the frontend (or merge it first; the controls stay hidden until the API answers).

## Consequences

Known limits: a TOTP code can be reused inside its 30 second window, as everywhere else in this
system; and if the mailbox is the compromised element the notification email does not help.
