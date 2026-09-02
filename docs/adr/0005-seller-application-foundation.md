# ADR 0005: Seller application and verification foundation

## Status

Accepted for Phase 5.

## Decision

HILOXS stores one server-authoritative `seller_applications` row per authenticated user. An application is not a seller role. Future seller-only capabilities must require an `APPROVED` application; Phase 5 creates no seller profile, catalog authority, payout account, or product-publishing route.

The applicant state machine is:

- `DRAFT` is editable and may be submitted or withdrawn.
- `SUBMITTED` is immutable and may be withdrawn.
- `UNDER_REVIEW`, `APPROVED`, and `REJECTED` are reachable only through internal review services that are not exposed as HTTP routes.
- `WITHDRAWN` is terminal in Phase 5.
- `REJECTED` is terminal in Phase 5; reopening and second applications are not available.

Repeated submission of an already submitted application and repeated withdrawal of an already withdrawn application return the current state. Other invalid transitions return a conflict.

## Data minimization

The application reuses account email and phone instead of copying them. It stores seller type, legal name, optional trading name, a registration number only for companies and registered businesses, and a structurally validated KRA PIN required at submission. Sole proprietors use the individual KRA PIN form and do not provide a registration number in this phase. Registered businesses may use an individual or non-individual PIN form.

No identity documents, certificates, images, bank details, cards, payout phones, or public business identifiers are collected. The applicant can view their own identifiers, but API responses never include `user_id`, reviewer identity, session data, or internal database metadata.

Registration numbers are trimmed, bounded to 80 characters, normalized to uppercase, and rejected when they contain markup or Unicode control/format characters. Phase 5 intentionally does not impose an unverified BRS identifier pattern or claim that this local validation proves authenticity.

`review_reason` is exclusively an applicant-facing rejection message. It must not contain confidential staff notes, fraud or risk analysis, verification evidence, reviewer identity, or provider responses. Future internal reviewer notes require separate non-applicant storage and authorization.

Structural checks do not prove authenticity. HILOXS does not call or claim live Kenya BRS or KRA verification in Phase 5.

## Consent

Submission requires an explicit, non-prechecked acknowledgment of `seller-terms-v1`. The server stores the accepted version and timestamp. The disclosures state that information must be accurate, approval is not automatic, later verification may be requested, prohibited goods are forbidden, product publishing is unavailable until approval and Phase 6, and payouts are outside Phase 5.

## Future verification and review

Internal review services provide only `SUBMITTED -> UNDER_REVIEW -> APPROVED|REJECTED`. They are intentionally not registered as routes because no dedicated server-side administrator authorization model exists yet.

Future BRS and KRA adapters must sit behind an authenticated internal review boundary, use provider-issued credentials from deployment secrets, record only necessary verification outcomes, redact identifiers from logs, and fail without changing applicant status automatically. Provider availability and authenticity must never be inferred from structural validation.
