# ADR 0003: Server-Authoritative Commerce

## Status

Proposed for Phase 3.

## Decision

PostgreSQL is authoritative for active products, prices, checkout totals, and orders. The browser
sends only stable product catalog keys and integer quantities. It cannot provide an authoritative
user ID, price, subtotal, total, currency, or order status.

KES amounts are stored as PostgreSQL `bigint` minor units. API responses serialize those integers
as decimal strings, such as `"7850000"` for KSh 78,500.00. This avoids floating-point arithmetic
and avoids silently coercing PostgreSQL 64-bit values into JavaScript numbers.

The Phase 3 migration seeds exactly the 44 products approved in the frontend catalog. Public API
IDs remain the existing catalog keys, while internal product and order relationships use UUIDs.
The static frontend catalog remains temporarily available for SEO, product presentation, and cart
labels. The authenticated quote and order APIs always reload active products and prices from
PostgreSQL.

Order creation uses a database transaction and a unique `(user_id, idempotency_key)` index. Each
order also persists a SHA-256 fingerprint of the validated cart, canonicalized by sorting catalog
keys and including quantities but no prices. Exact retries return the existing order; reusing a key
for a different cart returns HTTP 409. Duplicate product lines are rejected during validation.
Order items snapshot product name, slug, unit price, quantity, and line total. Phase 3 creates only
`PENDING_PAYMENT`; customers may only cancel that state. Payment-controlled transitions are not
exposed.

The anonymous cart remains in localStorage. Legacy prototype orders are removed during local-state
hydration, and authenticated order history is loaded only from the API. The cart is cleared only
after the server confirms order creation; a failed request leaves it intact.

Order creation and cancellation use an in-memory fixed-window limiter. This is intentionally a
single-instance safeguard for Phase 3. A shared limiter can replace it when horizontal API scaling
requires coordinated limits.

## Consequences

- Product price changes do not rewrite historical orders.
- A quote does not reserve a price. Order creation reloads PostgreSQL prices and returns the actual
  total stored on the new order.
- Retried or concurrent order requests produce one logical order per user and idempotency key.
- M-Pesa can attach to a stable pending order in a later phase without trusting browser totals.
- No inventory, seller, payment, wallet, referral, or trading authority is introduced here.
