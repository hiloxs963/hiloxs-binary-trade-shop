# ADR 0008: Secure product media and controlled catalog activation

## Status

Accepted for Phase 8 implementation.

## Decision

Seller uploads use a private AWS S3 bucket and five-minute presigned POST policies. Policies bind
the exact server-generated quarantine key, declared static raster MIME type, media record metadata,
and exact byte size up to 8 MiB. The bucket must not allow public ACLs or browser reads.

Production bucket CORS must allow only the HILOXS frontend to submit the signed form:

```json
[
  {
    "AllowedOrigins": ["https://hiloxs.co.ke"],
    "AllowedMethods": ["POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

This is documentation only. Infrastructure configuration and credentials remain outside the
repository. The IAM principal should be limited to the configured private bucket and the required
object operations.

Quarantine uploads are never served. A separate database-leased worker downloads the captured
object with its ETag, enforces byte and decoded-pixel limits, accepts only JPEG, PNG, or static WebP,
auto-orients, strips metadata, and re-encodes private WebP variants. Sanitized variants become
reviewable; only staff-approved, seller-selected variants can be copied into an immutable public
product snapshot.

`PRODUCT_REVIEW` authorizes media review. `CATALOG_ACTIVATE` is a separate explicit grant with no
role-based bypass. A staff session must postdate both membership and the exact permission grant.
Activation atomically creates an active but non-purchasable seller product, media and inventory
snapshots, a unique activation record, and an audit event. Phase 8 seller products cannot pass
checkout because authoritative pricing requires both `is_active` and `is_purchasable`.

`MEDIA_UPLOAD_ENABLED` and `CATALOG_ACTIVATION_ENABLED` default to false. Missing storage
configuration is startup-safe while both are false; partial configuration is always invalid.

## Operational boundaries

- The API streams mapped sanitized public variants from the private bucket with a ten-minute cache,
  mandatory revalidation after freshness expires, and a SHA-256 ETag. Deactivation immediately
  denies new mapped requests while retaining the private canonical object for a future explicit
  retirement workflow.
- The media worker is a separate `npm run media:worker:prod` process and is never started by the API.
- Transient worker failures use bounded exponential retry delays; permanent invalid media consumes
  the bounded attempt budget without a tight retry loop.
- Quarantine objects are retained for at most 24 hours and cleanup never removes an object still
  referenced by canonical or public media records. The storage deletion primitive accepts only
  keys in the `quarantine/` namespace.
- Inventory is an integer preparation snapshot only. Reservation, consumption, fulfillment, and
  seller order routing are deferred to Phase 9.
