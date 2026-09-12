# Data Map and Privacy Operations

This map is derived from the current PostgreSQL schema and browser code. Retention periods are not
implemented. Every proposed period below requires owner/legal approval.

| Data category                                                   | Purpose                                           | Access                                                                               | Storage and deletion constraints                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Account identity/contact, verification state                    | Authentication and account communication          | Account owner; narrowly authorized operations                                        | PostgreSQL auth tables; correction requires reverification; preserve security evidence where legally required         |
| Password credential material, sessions, MFA secret/backup codes | Authentication and recovery                       | Better Auth/server only                                                              | PostgreSQL; never browser storage/logs; sessions can be revoked; credential records follow approved account lifecycle |
| Rate-limit identifier digests                                   | Abuse prevention                                  | API/security operations                                                              | PostgreSQL HMAC digests only; expired windows are bounded-cleaned; no raw identifier                                  |
| Cart product IDs and quantities                                 | Browser shopping continuity                       | Browser user                                                                         | `hiloxs.cart.v1` localStorage only; no address, payment, auth, referral, or MFA data                                  |
| Orders, items, addresses                                        | Contract/fulfillment and support                  | Owning customer; relevant seller gets only its fulfillment scope; authorized support | PostgreSQL; do not hard-delete before accounting/legal policy approval                                                |
| Payment attempts/events/provider evidence                       | Payment reconciliation and fraud/support evidence | Owning customer gets safe status; privileged server/support scopes                   | PostgreSQL; encrypted transport/storage controls; do not automatically delete                                         |
| Seller applications/legal identifiers                           | Seller onboarding and review                      | Applicant; explicitly permissioned staff                                             | PostgreSQL; sensitive identifiers never logs/metrics; retention requires legal approval                               |
| Seller submissions/media metadata/inventory                     | Catalog review and seller operations              | Owning approved seller; explicitly permissioned staff; active public subset          | PostgreSQL and future configured object storage; production object storage remains parked                             |
| Reservations/fulfillments/events                                | Stock correctness and order delivery              | Scoped customer/seller/staff/system                                                  | PostgreSQL; preserve ordering/accounting history                                                                      |
| Staff memberships, grants, audit events                         | Privileged authorization and accountability       | MFA-authenticated least-privilege staff/system                                       | PostgreSQL; audit evidence is append-oriented and not automatically deleted                                           |
| Operational logs                                                | Reliability/security diagnosis                    | Restricted operations                                                                | Structured stdout/platform logs; values are redacted and labels bounded; provider retention must be approved          |

## Proposed retention decisions

The owner/legal reviewer must set actual values before launch. Suggested decision categories, all
`PROPOSED - REQUIRES OWNER/LEGAL APPROVAL`, are: expired sessions and verification challenges;
expired rate-limit windows; application logs; rejected/withdrawn seller applications; inactive media;
orders and payment evidence; delivery addresses; staff audit events; and object-storage versions.

No deletion job is introduced by Phase 11. Orders, payment evidence, staff audit, seller legal data,
reservations, and fulfillment history must not be automatically deleted without approved policy.

## Future account privacy operations

- **Export:** require a recent authenticated session and MFA where enabled; create a bounded export of
  user-owned data without other users', staff-only notes, provider secrets, or internal fraud signals.
- **Deletion request:** authenticate and record the request; classify records into deletable,
  anonymizable/tombstoned, and legally retained; require a reviewed asynchronous operation and audit.
- **Contact correction:** require ownership proof, uniqueness checks, reverification, session
  revocation where risk changes, and notification to the old contact when possible.
- **Tombstone/anonymization:** remove direct contact identifiers only where allowed while preserving
  referential, accounting, payment, security, and audit integrity.

No destructive account deletion endpoint is approved or implemented.

## Browser storage migration

The current frontend persists only a sanitized map of product IDs to quantities under
`hiloxs.cart.v1`. On first hydration it may recover only that cart shape from the exact obsolete key
`hiloxs.state.v2`; it then removes `hiloxs.state.v2` whether parsing succeeds or fails. Referral,
wallet, payout-account, trading, seller, payment, address, authentication, MFA, and backup-code state
is never written by this store.
