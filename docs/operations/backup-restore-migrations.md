# Backup, Restore, and Migration Runbook

## Backup verification

Railway backup configuration is **unverified and a launch blocker**. In the provider console, an
authorized operator must record the database/service, backup type, schedule, retention, encryption,
latest successful completion, and restore capability without copying credentials into tickets or
logs.

For an independent backup, use a short-lived least-privilege credential supplied through a protected
environment variable and an encrypted operator-controlled destination. Run the provider-compatible
`pg_dump` custom format, compute SHA-256 locally, encrypt before durable transfer, record only object
name/checksum/size/date, then unset the credential. Never place URLs/passwords in shell history or
repository files. Retention is **PROPOSED - REQUIRES OWNER/LEGAL APPROVAL**.

## Isolated restore drill

1. Create a new non-production PostgreSQL target with no route from public services.
2. Disable email, M-Pesa, S3/media, seller commerce, seller order actions, catalog activation, and
   staff review. Use no production provider credentials.
3. Verify the encrypted backup checksum, decrypt into temporary protected storage, and restore.
4. Run the production migration command against the isolated target.
5. Verify migration journal integrity (through `0011`) and that no seeded demo products remain:
   `refcheck-demo-products.sql` must report `products_matched = 0`. Migration `0011` removed the 44
   products seeded by `0002`; it aborts instead of deleting if anything still references them.
6. Verify representative counts/relationships for auth, orders, payments, seller applications,
   seller submissions, staff memberships/grants/audit, media metadata, inventory reservations,
   fulfillments, and fulfillment events. Do not print PII or secrets.
7. Start an isolated API and run health/readiness plus read-only smoke tests.
8. Record timings and non-sensitive results, destroy plaintext backup material, and destroy the test
   database after approval.

Targets are **PROPOSED / NOT CONTRACTUAL / REQUIRES APPROVAL**: RPO <= 1 hour and RTO <= 4 hours.

## Migration safety

Migrations `0000` through `0009` are immutable and forward-only. CI validates Drizzle metadata and
both fresh and prior-schema upgrade paths. Production startup does not migrate. Before applying:

1. Require green CI and a verified backup.
2. Compare generated SQL/schema/snapshot/journal and review locks, table rewrites, defaults, and
   compatibility with the running version.
3. Deploy backward-compatible code if the migration requires it.
4. Run `npm run db:migrate:prod` once from the final production image.
5. Verify the migration journal, `/health`, `/ready`, and read-only smoke tests.

On failure, stop and preserve logs/request IDs. Do not edit migration history, run arbitrary direct
SQL, or automatically apply a down migration. Investigate and prepare a reviewed forward fix.

### Migration `0011` (removes the 44 seeded demo products)

`0011_remove_platform_demo_products` deletes rows, so a verified backup is required first. It counts
every table that references `products.id` and aborts, deleting nothing, if any row references a demo
product.

1. Take and verify a Railway Postgres backup before applying `0011`.
2. Run [`refcheck-demo-products.sql`](./refcheck-demo-products.sql) in the Railway query tab. It is
   SELECT-only and counts exactly what the migration checks. Expect `products_matched = 44` and `0`
   in every other row.
3. If any other row is non-zero, do not apply `0011` and do not improvise `DELETE`s. Record the table
   and count, then prepare a reviewed forward migration (for example deactivating a product that has
   order history instead of deleting it).
4. Apply the migration as above, then re-run the refcheck: `products_matched` must be `0`.

Rollback is forward-only: re-insert the 44 products from the `INSERT INTO "products"` statement in
`0002_chubby_scarlet_spider.sql` through a reviewed migration, or restore the backup into an isolated
target and copy the rows across.

### Combined rollout: migrations `0011` + `0012` (demo-product removal and email OTP)

Use this when both migrations are pending in one release. `0011` deletes rows; `0012` is additive
(three new tables and `session.mfa_method text not null default 'none'`). The currently deployed API
(before email OTP) was run against a database already at `0012` in the integration suite (55 auth and
staff tests pass), so the schema can be migrated **before** the new API is deployed. The reverse is not
safe: the new API reads and writes `session.mfa_method`, so it must never serve traffic before `0012`.

1. **Prerequisites.** The client-IP fix is merged and its production check passed (see
   `production-readiness.md`, "Client address resolution"). Frontend and API CI are green. Railway
   Auto Deploy stays disabled. `EMAIL_OTP_ENABLED` is unset or `false` and stays that way until step 10.
2. **One verified backup** taken immediately before step 4, covering both migrations (the rollback for
   `0011` is a restore or a reviewed forward re-insert, so do not rely on an older backup). Record the
   object name, checksum, size, and date only.
3. **Refcheck.** Run [`refcheck-demo-products.sql`](./refcheck-demo-products.sql) in the Railway query
   tab. Expect `products_matched = 44` and `0` in every other row. If anything else is non-zero, stop:
   do not apply either migration, and prepare a reviewed forward fix as described under `0011` above.
4. **Migrate once, in order, from the final image.** Build the production image that contains `0012` and
   the new API, and run `npm run db:migrate:prod` from that image against production. Drizzle applies
   `0011` then `0012` in journal order; it stops at the first failure. Do not run it twice or from a
   different image.
5. **Verify the schema.** Journal has 13 entries (`0000`–`0012`); re-run the refcheck and expect
   `products_matched = 0`; confirm `session.mfa_method`, `email_otp_enrollments`,
   `email_otp_challenges`, and `auth_security_events` exist. The still-running old API must keep
   answering `/health`, `/ready`, and sign-in. If it does not, stop and investigate before deploying.
6. **Deploy the API** from the same image with `EMAIL_OTP_ENABLED=false` (and no `EMAIL_OTP_HMAC_KEY`
   required yet). Verify `/health`, `/ready`, an existing user's password + TOTP sign-in, and a staff
   permission check. Email OTP endpoints must answer 404 and sign-in responses must list only `totp`.
7. **Deploy the static frontend** artifact from the matching commit (it handles the removed products in
   existing carts and the new second-factor step). The email option stays hidden while the flag is off.
8. **Monitor** errors, latency, sign-in success, and the audit table for `BACKUP_CODE_LOGIN_*` events.
9. **Delivery check** for `auth@mail.hiloxs.co.ke` to Gmail, Outlook, and Yahoo (SPF/DKIM/DMARC alignment
   and a real inbox test), then generate `EMAIL_OTP_HMAC_KEY` (32+ chars, independent of the other
   secrets) in the secret manager.
10. **Enable** `EMAIL_OTP_ENABLED=true` only after step 9 and the client-IP check. Run the manual checklist
    in the UI pull request with a non-staff TOTP-enrolled test account and confirm a staff account never sees
    the email option. Turning the flag off again is the rollback; it needs no data change.

Rollback: forward-only for the schema. Code can be rolled back to the previous API image at any point
after step 4 because `0012` is additive; do not drop the new tables or column. `0011` follows its own
rollback note above.

## Backup disposal

Destroy temporary plaintext dumps, test restore volumes, and short-lived credentials after the drill.
Deletion of encrypted retained backups follows the owner/legal-approved schedule, not an application
job.
