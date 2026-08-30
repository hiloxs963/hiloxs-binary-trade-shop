# ADR 0001: Backend trust boundary

- Status: Accepted
- Date: 2026-08-30

## Context

The existing HILOXS frontend contains prototype browser state used to demonstrate commerce,
referral, wallet, administration, and trading interfaces. Browser-controlled state can be changed by
the person operating the browser and cannot establish identity, permission, ownership, payment, or
financial truth.

## Decision

PostgreSQL-backed server records will become the authoritative source for production domain facts.
The Phase 1 API establishes infrastructure only and does not import or trust existing browser data.

The following boundaries apply to all future phases:

- localStorage is prototype-only and browser state is not authoritative.
- Existing localStorage financial facts will not be imported as trusted production records.
- Orders must be created server-side under an authenticated customer identity.
- Payments must be verified server-side before an order or balance changes state.
- Admin authorization and every privileged operation must be enforced server-side.
- Referral activation, tree placement, and bonus calculation must eventually execute server-side.
- Frontend visibility does not grant permission to perform an operation.
- Financial operations require transactional, durable server-side records and auditable state changes.
- Trading remains a demo/simulation. Browser outcomes and balances have no cash value.
- Real-money trading requires a separate, explicitly approved legal, regulatory, custody, risk, and
  settlement architecture. It is not an extension of the current demo.

## Consequences

Phase 1 contains no users, sessions, products, orders, payments, wallets, referrals, sellers, or
trading domain tables. Later phases must define unresolved business rules before adding those
records or connecting frontend flows to the API.
