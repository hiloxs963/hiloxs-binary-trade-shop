# ADR 0009: Seller commerce, inventory reservation, and fulfillment

## Status

Accepted for Phase 9 implementation.

## Decision

Marketplace v1 seller prices include the seller's delivery economics for the supported delivery area. HILOXS adds a shipping charge of KSh 0. Seller commerce and seller order actions are independently disabled by default.

Seller products use integer on-hand and reserved inventory. Checkout quotes are advisory and do not reserve stock. Creating a seller order atomically locks inventory, snapshots the delivery address, creates one fulfillment per seller, and reserves stock for 30 minutes. Mixed platform and multi-seller orders remain one HILOXS order and one order-level payment.

Only trusted provider confirmation may settle payment. Valid reservations commit atomically and release seller fulfillments. Late payment after release or expiry preserves payment evidence and enters `PAYMENT_REVIEW_REQUIRED`; it does not recreate stock, start fulfillment, or refund automatically.

The independent `reservations:worker:prod` process expires unpaid reservations in bounded, restart-safe batches. The API does not start this worker. Fulfillment and inventory events are append-only audit sources. A future transactional outbox may consume these events for notifications; email delivery is not part of Phase 9 correctness.

Seller fulfillment requires explicit acceptance of `seller-fulfillment-terms-v1`. Customer delivery data is shown only to the owning seller while operationally necessary and is omitted after delivery or cancellation. `ORDER_SUPPORT` is read-only and `SELLER_COMMERCE_ACTIVATE` controls explicit readiness, enable, and pause commands; neither permission is granted by migration.

## Consequences

Existing platform products remain outside seller inventory, delivery-address, and fulfillment requirements. Pausing new seller commerce does not strand existing reservations or paid fulfillments. Seller payouts, commissions, refunds, earnings, escrow, shipping fees, and external verification remain out of scope.
