# ADR 0007: Secure staff review operations

## Status

Accepted for Phase 7 implementation.

## Decision

Staff authority is resolved on every request from an authenticated Better Auth session, an ACTIVE
`staff_memberships` row, and an active grant for the exact review permission. Roles do not imply
permissions, including the ADMIN role. Nonstaff and ineligible staff receive the same safe
`STAFF_PERMISSION_REQUIRED` response.

Better Auth 1.7.2's official two-factor plugin owns TOTP secrets, verification, lockout, and backup
codes. HILOXS does not implement TOTP cryptography or store factor material in custom tables. Staff
access requires a verified TOTP enrollment. The trusted-device duration is disabled so credential
sign-in always completes the second-factor challenge before a normal session is issued.

Every staff endpoint requires a session created strictly after the staff membership. Bootstrap
deletes the target user's existing sessions in the same transaction as membership, grants, and
audit events, forcing a fresh credential sign-in and second-factor challenge. Review mutations
additionally require that session to be no more than 30 minutes old. `STAFF_REVIEW_ENABLED`
defaults off and blocks every review mutation with `STAFF_REVIEW_DISABLED` while leaving authorized
reads available.

Every review mutation repeats authorization inside the same PostgreSQL transaction as the state
transition and audit insert. All review and permission-revocation code uses this lock order:

1. Staff membership
2. Active exact permission grant
3. Review target
4. Append-only audit insert

Audit events contain only actor ID, role and permission snapshots, action, one review target,
status transition, request ID, and server timestamp. Rejection reasons remain only on the
applicant-facing record. An audit failure rolls back the review transition.

Seller-product approval remains review approval only. It does not create a public product, slug,
inventory record, or checkout identity.

## API surface

- `GET /api/v1/staff/me`
- `GET /api/v1/staff/seller-applications`
- `GET /api/v1/staff/seller-applications/:applicationId`
- `POST /api/v1/staff/seller-applications/:applicationId/start-review`
- `POST /api/v1/staff/seller-applications/:applicationId/approve`
- `POST /api/v1/staff/seller-applications/:applicationId/reject`
- `GET /api/v1/staff/seller-products`
- `GET /api/v1/staff/seller-products/:submissionId`
- `POST /api/v1/staff/seller-products/:submissionId/start-review`
- `POST /api/v1/staff/seller-products/:submissionId/approve`
- `POST /api/v1/staff/seller-products/:submissionId/reject`

There is no staff-provisioning HTTP API. Initial provisioning uses the internal bootstrap service
with an immutable user ID and produces `SYSTEM_BOOTSTRAP` audit events without attributing the
operation to the provisioned account.
