# ADR 0006: Seller product submission and review foundation

## Status

Accepted for Phase 6.

## Decision

HILOXS stores seller-authored listing drafts in `seller_product_submissions`, separate from the public `products` table. Every applicant route requires an ACTIVE authenticated user whose own seller application is `APPROVED`. Ownership comes from the session and seller-application relationship; browser payloads cannot choose a user or seller application.

An approved product submission is approved only for future catalog activation. Phase 6 never inserts into or updates `products`, creates a public slug, enables checkout, or grants inventory, fulfillment, payout, wallet, or order-management capabilities.

## Lifecycle

Applicants may create multiple submissions. `DRAFT` is editable and may become `SUBMITTED` or `WITHDRAWN`. `SUBMITTED` is immutable and may become `WITHDRAWN`. Internal services, which have no HTTP route, provide `SUBMITTED -> UNDER_REVIEW -> APPROVED|REJECTED`. `UNDER_REVIEW`, `APPROVED`, and `REJECTED` are immutable to applicants. `APPROVED`, `REJECTED`, and `WITHDRAWN` are terminal for an individual submission, while rejected and withdrawn history does not prevent a new draft.

Repeated submission of `SUBMITTED` and repeated withdrawal of `WITHDRAWN` return the unchanged record. Applicant and review transitions use PostgreSQL row locks, giving races one valid serialized outcome.

## Listing data and money

The table stores only name, existing catalog category, plain-text description, bigint minor-unit price, fixed `KES` currency, lifecycle metadata, and an applicant-safe rejection reason. It does not copy account contact details, KRA PIN, business registration number, media, stock, shipping, payment, or payout data.

The API accepts and returns `priceMinor` as a decimal integer string. Browser-facing KSh decimal input is converted without floating-point arithmetic. Prices must be positive and no more than `1000000000` minor units (KSh 10,000,000). This ceiling is a HILOXS application safety limit, not a legal, KRA, BRS, or payment-provider limit.

## Consent and review privacy

Submission requires an explicit, non-prechecked acknowledgment of server-controlled `seller-product-terms-v1`. The server records its current version and acceptance timestamp. The terms cover listing accuracy, authority to sell, prohibited and counterfeit goods, non-automatic approval, non-public approval, possible later information requests, future media licensing, and separate payout functionality.

`review_reason` is applicant-facing only. Confidential staff notes, reviewer identity, risk evidence, provider responses, and future moderation evidence require separate private storage and real staff authorization.

## Categories, media, and rate limits

The backend category tuple is shared by the public catalog validator and seller-product validator so Phase 6 cannot invent categories or change existing product data.

Product media is deliberately absent. A future media phase must establish seller-provided media ownership or licensing, secure object storage, file validation, malware and content processing, moderation, and controlled catalog activation before media can appear publicly.

Create, edit, submit, and withdraw routes use the existing in-memory fixed-window limiter. This provides single-instance abuse resistance only; database authorization, constraints, and row locks remain authoritative. A distributed limiter may replace it when the API runs across multiple instances.
