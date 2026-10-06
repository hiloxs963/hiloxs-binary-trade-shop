# Staff bootstrap

The API can grant staff access to named users at startup. It is opt-in and idempotent.

## Configuration

| Variable                      | Value                                                           |
| ----------------------------- | --------------------------------------------------------------- |
| `STAFF_BOOTSTRAP_USER_ID`     | One user id, or several separated by commas: `id1,id2`          |
| `STAFF_BOOTSTRAP_PERMISSIONS` | Comma-separated permissions: `SELLER_REVIEW,PRODUCT_REVIEW,...` |

Both must be set; otherwise the bootstrap does nothing. Whitespace and duplicates are ignored. A
single id keeps working exactly as before.

For each listed user the API:

1. creates a `staff_memberships` row (role `STAFF`) with every listed permission if the user has no
   membership, or
2. adds any listed permission the member does not yet hold.

Every change writes `staff_audit_events` rows with actor `SYSTEM_BOOTSTRAP`
(`STAFF_BOOTSTRAPPED`, `STAFF_PERMISSION_GRANTED`). A run that finds nothing to change writes nothing
and does not touch sessions. A **new** membership or grant deletes that user's existing sessions, by
design: staff authority requires a session created after the grant, so the user must log in again
(with their authenticator).

### Eligibility and failure behavior

The user must exist, be `ACTIVE`, have a verified email, and have a verified authenticator
(`twoFactorEnabled`). Email-OTP enrollment is removed when a membership is created, because staff are
TOTP-only (ADR 0010).

Bootstrap **never prevents the API from starting**. A missing user, a malformed id, an ineligible
account, an unknown permission name, or any failed grant is logged as a `warn` line
(`Staff bootstrap: skipped <id>: <reason>`) and skipped; the other users are still processed. After a
deploy, search the logs for `Staff bootstrap:` and confirm there is a `granted`, `created membership`
or `already active` line for every id you listed. A typo therefore shows up as a warning, not an
outage, and as an absence of access, never as extra access.

Revoking access is not done through this variable. Removing an id from the list does not revoke
anything.

## Find a user id by email (read-only)

Run in a read-only SQL session. This is a single `SELECT` and changes nothing.

```sql
SELECT id,
       email,
       email_verified,
       two_factor_enabled,
       status
FROM "user"
WHERE lower(email) = lower('person@example.com');
```

The user is eligible for bootstrap when `email_verified` and `two_factor_enabled` are true and
`status` is `ACTIVE`. Copy the `id` value into `STAFF_BOOTSTRAP_USER_ID`.

To see the current staff state afterwards (also read-only):

```sql
SELECT u.id, u.email, m.role, m.status, g.permission, g.revoked_at
FROM staff_memberships m
JOIN "user" u ON u.id = m.user_id
LEFT JOIN staff_permission_grants g ON g.staff_user_id = m.user_id
ORDER BY u.email, g.permission;
```
