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
5. Verify migration journal integrity and exactly 44 platform products.
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

## Backup disposal

Destroy temporary plaintext dumps, test restore volumes, and short-lived credentials after the drill.
Deletion of encrypted retained backups follows the owner/legal-approved schedule, not an application
job.
