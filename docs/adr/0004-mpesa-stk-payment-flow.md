# ADR 0004: M-Pesa STK payment flow

- Status: Accepted
- Date: 2026-08-31

## Context

Phase 3 creates server-authoritative orders with KES totals stored as bigint minor units. Phase 4
needs to initiate asynchronous M-Pesa Express payments without allowing the browser, an untrusted
callback, or an ambiguous network response to decide that an order has been paid.

## Decision

The API loads the authenticated customer's `PENDING_PAYMENT` order and derives the M-Pesa amount
from its stored total. The browser supplies only the order identifier and payment phone. The total
must be positive KES, exactly divisible into whole shillings, and within the configured application
limit. No floating-point conversion is used.

Each outbound request has a durable payment attempt with an explicit state:

- `INITIATING`: the attempt exists before the external request starts.
- `PENDING`: Daraja accepted the STK Push.
- `CONFIRMING`: a successful callback was stored and requires provider reconciliation.
- `SUCCEEDED`: a server-to-server query confirmed success and the order was atomically marked paid.
- `FAILED`: the authenticated initiation response definitively rejected the attempt.
- `UNKNOWN`: the initiation outcome is ambiguous and blind retry is blocked.
- `REVIEW_REQUIRED`: identifiers, amounts, receipts, order state, or provider results contradict.

A PostgreSQL partial unique index allows only one active, unknown, or review-required attempt per
order. Initiation also locks the order and binds `Idempotency-Key` to the order and normalized phone.
Cancellation locks the same order and is rejected while a blocking payment attempt exists.
Transactions that touch both records always lock the order row before payment-attempt rows.
Receipt-bearing callbacks take their receipt advisory lock only after those row locks. This ordering
serializes payment, cancellation, and receipt-conflict decisions without inverse lock dependencies.

Each attempt receives a random 256-bit callback token. Only its SHA-256 hash is stored. The raw
token appears only in the configured HTTPS callback URL sent to Daraja; it is neither returned to
the browser nor logged. Callback payloads are validated defensively, reduced to necessary fields,
and represented by canonical hashes in a durable event table. A uniqueness constraint makes replay
processing idempotent even when metadata arrives in a different order. The token is defense in
depth and is not described as a Safaricom signature.
Application logs redact callback-token paths, but reverse proxies and hosting platforms may retain
request paths independently. Token secrecy is therefore not the basis for authorizing payment.

A callback records evidence and moves an unresolved attempt to `CONFIRMING`, regardless of whether
it reports success or failure. A public failure callback cannot unlock a retry. A callback is not
browser proof and does not mark the order paid. The authenticated refresh endpoint loads the stored
`CheckoutRequestID` and performs an STK status query. Only result code zero for the stored attempt,
with matching order, KES currency, amount snapshot, pending order state, and no contradictory prior
success, can atomically move the attempt to `SUCCEEDED` and the order to `PAID`.

If query confirmation arrives before a receipt-bearing callback, success may be recorded with a
temporarily null receipt. A later matching callback may fill the receipt. Receipt numbers are unique
when present. Conflicts, duplicate successful attempts, or success against a cancelled order require
manual review; Phase 4 does not implement refunds or reversals.

Daraja access is behind a provider interface. OAuth tokens are cached only in process memory until
shortly before expiry. Passwords and timestamps are freshly generated server-side for STK
initiation and query. Sandbox and production hosts, merchant identifiers, credentials, transaction
type, callback origin, amount limit, and request timeout are validated server configuration. No
Daraja secret is present in the frontend.

STK initiation and manual reconciliation use the existing fixed-window in-memory limiter. This is a
single-instance safeguard; horizontally scaled API processes will require a shared limiter. Provider
callbacks are not subjected to that user limiter.

## Consequences

Ambiguous transport failures remain blocked until callback evidence or manual reconciliation
resolves them. Failed attempts remain as audit history and permit a new attempt. The frontend polls
only HILOXS and treats PostgreSQL as payment authority. Moving from sandbox to production requires
validated production environment variables and an HTTPS callback base URL. No real Daraja call,
credential configuration, Railway deployment, or frontend deployment is part of this change.
