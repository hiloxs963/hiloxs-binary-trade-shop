import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, count, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import type { Response as InjectResponse } from "light-my-request";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { createAuthService, type AuthService } from "../../src/auth/auth.js";
import { InMemoryAuthEmailSender } from "../../src/auth/email.js";
import { priceCart } from "../../src/commerce/pricing.js";
import {
  activateSellerProduct,
  deactivateSellerProduct,
  getActivationReadiness,
} from "../../src/catalog/activation-service.js";
import {
  assertSafeTestDatabaseUrl,
  parseEnv,
  requireDatabaseUrl,
  resolveAuthRuntimeConfig,
  resolveMediaRuntimeConfig,
} from "../../src/config/env.js";
import { createDatabaseClient, type DatabaseClient } from "../../src/db/client.js";
import { session, twoFactor, user } from "../../src/db/schema/auth.js";
import { orders, products } from "../../src/db/schema/commerce.js";
import {
  productInventory,
  productMedia,
  productMediaVariants,
  sellerProductActivations,
  sellerProductInventory,
  sellerProductMedia,
  sellerProductMediaVariants,
} from "../../src/db/schema/media.js";
import { sellerProductSubmissions } from "../../src/db/schema/seller-products.js";
import { sellerApplications } from "../../src/db/schema/sellers.js";
import {
  staffAuditEvents,
  staffMemberships,
  staffPermissionGrants,
} from "../../src/db/schema/staff.js";
import type { StaffAuthorization } from "../../src/staff/model.js";
import {
  MAX_ACTIVE_MEDIA_PER_SUBMISSION,
  MEDIA_PROCESSING_RETRY_BASE_MS,
  MEDIA_VARIANTS,
  QUARANTINE_RETENTION_MS,
  SELLER_MEDIA_RIGHTS_VERSION,
} from "../../src/media/model.js";
import { S3MediaStorage } from "../../src/media/s3-storage.js";
import type { MediaStorage } from "../../src/media/storage.js";
import { readStoredObject, sha256Hex } from "../../src/media/storage.js";
import { processNextMedia } from "../../src/media/worker-service.js";
import { restoreInitialCatalog } from "./helpers.js";

const ORIGIN = "http://localhost:8080";
const PASSWORD = "StrongPassword!42";
const env = parseEnv(process.env);
const databaseUrl = requireDatabaseUrl(env);
assertSafeTestDatabaseUrl(databaseUrl, env.NODE_ENV);
const mediaConfig = resolveMediaRuntimeConfig(env).storage;
if (!mediaConfig) throw new Error("Phase 8 integration tests require disposable MinIO config");
const mediaBucket = mediaConfig.bucket;

let app: FastifyInstance;
let auth: AuthService;
let database: DatabaseClient;
let storage: S3MediaStorage;
let minio: S3Client;
let fixtureImage: Buffer;
let requestCounter = 0;
const emailSender = new InMemoryAuthEmailSender();

beforeAll(async () => {
  database = createDatabaseClient(databaseUrl);
  await migrate(database.db, { migrationsFolder: resolve("src/db/migrations") });
  minio = new S3Client({
    endpoint: mediaConfig.endpoint,
    region: mediaConfig.region,
    forcePathStyle: mediaConfig.forcePathStyle,
    credentials: {
      accessKeyId: mediaConfig.accessKeyId,
      secretAccessKey: mediaConfig.secretAccessKey,
    },
  });
  try {
    await minio.send(new CreateBucketCommand({ Bucket: mediaConfig.bucket }));
  } catch (error) {
    if (!isBucketExists(error)) throw error;
  }
  storage = new S3MediaStorage(mediaConfig);
  fixtureImage = await sharp({
    create: { width: 720, height: 680, channels: 3, background: "#246b56" },
  })
    .jpeg()
    .toBuffer();
  const runtime = resolveAuthRuntimeConfig(env);
  auth = createAuthService({ database, emailSender, runtime });
  app = await buildApp({
    database,
    auth,
    authRuntime: runtime,
    allowedOrigins: runtime.trustedOrigins,
    staffReviewEnabled: true,
    media: { storage, uploadEnabled: true, catalogActivationEnabled: true },
  });
});

beforeEach(async () => {
  await emptyTestBucket();
  await database.pool.query(`
    truncate table
      "staff_audit_events", "seller_product_activations", "product_media_variants",
      "product_media", "product_inventory", "seller_product_media_variants",
      "seller_product_media", "seller_product_inventory", "staff_permission_grants",
      "staff_memberships", "seller_product_submissions", "seller_applications",
      "verification", "two_factor", "session", "account", "user"
    cascade
  `);
  await database.pool.query(`delete from "products" where "source" = 'SELLER'`);
  await restoreInitialCatalog(database);
  emailSender.messages.length = 0;
});

afterAll(async () => {
  await emptyTestBucket();
  minio.destroy();
  await app.close();
});

describe("private S3-compatible media storage", () => {
  it("enforces the exact server key, MIME, size, metadata, and short POST expiry", async () => {
    const key = `quarantine/test/${randomUUID()}`;
    const mediaId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const grant = await storage.createUploadGrant({
      objectKey: key,
      declaredMime: "image/jpeg",
      exactByteSize: fixtureImage.byteLength,
      mediaId,
      expiresAt,
    });
    const policy = JSON.parse(
      Buffer.from(grant.fields["policy"] ?? grant.fields["Policy"] ?? "", "base64").toString(
        "utf8",
      ),
    ) as { expiration: string; conditions: unknown[] };

    expect(grant.method).toBe("POST");
    expect(grant.expiresAt).toEqual(expiresAt);
    expect(Math.abs(new Date(policy.expiration).getTime() - expiresAt.getTime())).toBeLessThan(
      2_000,
    );
    expect(policy.conditions).toContainEqual({ bucket: mediaConfig.bucket });
    expect(policy.conditions).toContainEqual(["eq", "$key", key]);
    expect(policy.conditions).toContainEqual(["eq", "$Content-Type", "image/jpeg"]);
    expect(policy.conditions).toContainEqual(["eq", "$x-amz-meta-hiloxs-media-id", mediaId]);
    expect(policy.conditions).toContainEqual([
      "content-length-range",
      fixtureImage.byteLength,
      fixtureImage.byteLength,
    ]);
    expect(grant.fields).not.toHaveProperty("acl");

    expect(await uploadGrant(grant, fixtureImage, "image/jpeg")).toBe(204);
    const head = await storage.head(key);
    expect(head).toMatchObject({
      byteSize: fixtureImage.byteLength,
      contentType: "image/jpeg",
      mediaId,
    });
    expect(await readStoredObject(await storage.get(key), fixtureImage.byteLength)).toEqual(
      fixtureImage,
    );
    await storage.deleteQuarantine(key);
    expect(await storage.head(key)).toBeNull();
  });

  it("rejects browser changes to upload key, ACL, metadata, MIME, or byte size", async () => {
    const grant = await storage.createUploadGrant({
      objectKey: `quarantine/test/${randomUUID()}`,
      declaredMime: "image/jpeg",
      exactByteSize: fixtureImage.byteLength,
      mediaId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(
      await uploadGrant(grant, Buffer.concat([fixtureImage, Buffer.from([0])]), "image/jpeg"),
    ).toBeGreaterThanOrEqual(400);
    expect(await uploadGrant(grant, fixtureImage, "image/png")).toBeGreaterThanOrEqual(400);
    expect(
      await uploadGrant(grant, fixtureImage, "image/jpeg", {
        key: `quarantine/browser-chosen/${randomUUID()}`,
      }),
    ).toBeGreaterThanOrEqual(400);
    expect(
      await uploadGrant(grant, fixtureImage, "image/jpeg", { "x-amz-acl": "public-read" }),
    ).toBeGreaterThanOrEqual(400);
    expect(
      await uploadGrant(grant, fixtureImage, "image/jpeg", {
        "x-amz-meta-browser-field": "untrusted",
      }),
    ).toBeGreaterThanOrEqual(400);
  });

  it("allows an identical immutable retry but rejects a canonical overwrite", async () => {
    const key = `canonical/test/${randomUUID()}.webp`;
    const body = await sharp(fixtureImage).webp().toBuffer();
    const sha256 = sha256Hex(body);

    await storage.putImmutable({ objectKey: key, body, contentType: "image/webp", sha256 });
    await expect(
      storage.putImmutable({ objectKey: key, body, contentType: "image/webp", sha256 }),
    ).resolves.toBeUndefined();
    const changed = Buffer.concat([body, Buffer.from([0])]);
    await expect(
      storage.putImmutable({
        objectKey: key,
        body: changed,
        contentType: "image/webp",
        sha256: sha256Hex(changed),
      }),
    ).rejects.toMatchObject({ code: "MEDIA_STORAGE_UNAVAILABLE" });
    await expect(storage.deleteQuarantine(key)).rejects.toMatchObject({
      code: "MEDIA_STORAGE_UNAVAILABLE",
    });
  });
});

describe("seller upload, inventory, and worker boundaries", () => {
  it("keeps ownership server-side and finalization idempotent", async () => {
    const owner = await approvedSeller("phase8-owner@example.com");
    const foreign = await approvedSeller("phase8-foreign@example.com");
    const injection = await post(
      `/api/v1/seller/products/${owner.submissionId}/media/upload-intents`,
      {
        declaredMime: "image/jpeg",
        declaredSize: fixtureImage.byteLength,
        rightsAccepted: true,
        key: "browser-key",
      },
      owner.cookie,
    );
    const foreignAttempt = await post(
      `/api/v1/seller/products/${owner.submissionId}/media/upload-intents`,
      { declaredMime: "image/jpeg", declaredSize: fixtureImage.byteLength, rightsAccepted: true },
      foreign.cookie,
    );
    const intent = await createIntent(owner.cookie, owner.submissionId);

    expect(injection.statusCode).toBe(400);
    expect(foreignAttempt.statusCode).toBe(404);
    expect(intent.upload.fields).not.toHaveProperty("acl");
    expect(intent.media).not.toHaveProperty("quarantineObjectKey");
    expect(intent.media.rightsTermsVersion).toBe(SELLER_MEDIA_RIGHTS_VERSION);
    expect(await uploadGrant(intent.upload, fixtureImage, "image/jpeg")).toBe(204);

    const path = `/api/v1/seller/products/${owner.submissionId}/media/${intent.media.id}/finalize`;
    const first = await post(path, {}, owner.cookie);
    const duplicate = await post(path, {}, owner.cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json<{ media: { status: string } }>().media.status).toBe("UPLOADED");
    expect(duplicate.json()).toEqual(first.json());
  });

  it("enforces the six-image cap transactionally", async () => {
    const owner = await approvedSeller("phase8-cap@example.com");
    const responses = await Promise.all(
      Array.from({ length: MAX_ACTIVE_MEDIA_PER_SUBMISSION + 1 }, () =>
        post(
          `/api/v1/seller/products/${owner.submissionId}/media/upload-intents`,
          {
            declaredMime: "image/jpeg",
            declaredSize: fixtureImage.byteLength,
            rightsAccepted: true,
          },
          owner.cookie,
        ),
      ),
    );

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(6);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(1);
  });

  it("validates inventory, hides foreign submissions, and rejects browser authority fields", async () => {
    const owner = await approvedSeller("phase8-inventory@example.com");
    const foreign = await approvedSeller("phase8-inventory-foreign@example.com");
    const path = `/api/v1/seller/products/${owner.submissionId}/inventory`;
    const accepted = await put(path, { quantityAvailable: 0 }, owner.cookie);
    const invalid = await Promise.all([
      put(path, { quantityAvailable: -1 }, owner.cookie),
      put(path, { quantityAvailable: 1.5 }, owner.cookie),
      put(path, { quantityAvailable: 1_000_001 }, owner.cookie),
      put(path, { quantityAvailable: 1, productId: randomUUID() }, owner.cookie),
      put(path, { quantityAvailable: 1, source: "PLATFORM" }, owner.cookie),
      put(path, { quantityAvailable: 1, sellerApplicationId: foreign.applicationId }, owner.cookie),
    ]);
    const foreignRead = await get(path, foreign.cookie);

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ inventory: { quantityAvailable: 0, version: 1 } });
    expect(invalid.every((response) => response.statusCode === 400)).toBe(true);
    expect(foreignRead.statusCode).toBe(404);
  });

  it("processes two jobs concurrently without duplicate variants and never serves quarantine", async () => {
    const owner = await approvedSeller("phase8-worker@example.com");
    const mediaIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const intent = await createIntent(owner.cookie, owner.submissionId);
      expect(await uploadGrant(intent.upload, fixtureImage, "image/jpeg")).toBe(204);
      await post(
        `/api/v1/seller/products/${owner.submissionId}/media/${intent.media.id}/finalize`,
        {},
        owner.cookie,
      );
      mediaIds.push(intent.media.id);
    }

    await Promise.all([processNextMedia(database, storage), processNextMedia(database, storage)]);
    const rows = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.sellerProductSubmissionId, owner.submissionId));
    const variants = await database.db
      .select()
      .from(sellerProductMediaVariants)
      .where(and(eq(sellerProductMediaVariants.sellerMediaId, mediaIds[0]!)));

    expect(rows.map((row) => row.status)).toEqual(["READY_FOR_REVIEW", "READY_FOR_REVIEW"]);
    expect(variants).toHaveLength(MEDIA_VARIANTS.length);
    expect(new Set(variants.map((variant) => variant.variant)).size).toBe(MEDIA_VARIANTS.length);
    const privatePreview = await get(
      `/api/v1/seller/products/${owner.submissionId}/media/${mediaIds[0]}/preview/MEDIUM`,
      owner.cookie,
    );
    expect(privatePreview.statusCode).toBe(200);
    expect(privatePreview.headers).toMatchObject({
      "content-type": "image/webp",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    expect(privatePreview.body).not.toContain("JFIF");
    const publicGuess = await app.inject({
      method: "GET",
      url: `/api/v1/products/not-a-product/media/${mediaIds[0]}/MEDIUM`,
    });
    expect(publicGuess.statusCode).toBe(404);
  });

  it("detects an object changed after finalize and safely retries transient failures", async () => {
    const fixture = await directUploadedMedia();
    const replacement = Buffer.from(fixtureImage);
    replacement[replacement.length - 1] = (replacement.at(-1) ?? 0) ^ 1;
    const replacementGrant = await storage.createUploadGrant({
      objectKey: fixture.objectKey,
      declaredMime: "image/jpeg",
      exactByteSize: replacement.byteLength,
      mediaId: fixture.mediaId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await uploadGrant(replacementGrant, replacement, "image/jpeg")).toBe(204);
    await processNextMedia(database, storage);
    const [changed] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, fixture.mediaId));
    expect(changed).toMatchObject({
      status: "PROCESSING_FAILED",
      lastProcessingErrorCode: "QUARANTINE_CHANGED",
    });

    const retryFixture = await directUploadedMedia();
    let failOnce = true;
    const transientStorage: MediaStorage = {
      ...delegatedStorage(storage),
      async get(key, options) {
        if (failOnce) {
          failOnce = false;
          throw new Error("disposable storage interruption");
        }
        return storage.get(key, options);
      },
    };
    const failedAt = new Date();
    await processNextMedia(database, transientStorage, failedAt);
    const deferred = await processNextMedia(
      database,
      transientStorage,
      new Date(failedAt.getTime() + MEDIA_PROCESSING_RETRY_BASE_MS - 1),
    );
    expect(deferred).toBeNull();
    await processNextMedia(
      database,
      transientStorage,
      new Date(failedAt.getTime() + MEDIA_PROCESSING_RETRY_BASE_MS + 1),
    );
    const [retried] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, retryFixture.mediaId));
    expect(retried?.status).toBe("READY_FOR_REVIEW");
    expect(retried?.processingAttempts).toBe(2);
  });

  it("keeps sanitized media valid when quarantine deletion temporarily fails", async () => {
    const fixture = await directUploadedMedia();
    const deleteFailing: MediaStorage = {
      ...delegatedStorage(storage),
      deleteQuarantine: () => Promise.reject(new Error("disposable delete interruption")),
    };
    await processNextMedia(database, deleteFailing);
    const [row] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, fixture.mediaId));

    expect(row).toMatchObject({ status: "READY_FOR_REVIEW", quarantineDeletePending: true });
    await processNextMedia(database, storage);
    const [cleaned] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, fixture.mediaId));
    expect(cleaned).toMatchObject({ status: "READY_FOR_REVIEW", quarantineDeletePending: false });
    expect(await storage.head(fixture.objectKey)).toBeNull();
  });

  it("cleans only expired or abandoned quarantine objects", async () => {
    const seller = await approvedSeller(`phase8-cleanup-${randomUUID()}@example.com`);
    const now = new Date();
    const expiredId = randomUUID();
    const freshId = randomUUID();
    const expiredKey = `quarantine/cleanup/${expiredId}`;
    const freshKey = `quarantine/cleanup/${freshId}`;
    for (const [mediaId, objectKey] of [
      [expiredId, expiredKey],
      [freshId, freshKey],
    ] as const) {
      const grant = await storage.createUploadGrant({
        objectKey,
        declaredMime: "image/jpeg",
        exactByteSize: fixtureImage.byteLength,
        mediaId,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      expect(await uploadGrant(grant, fixtureImage, "image/jpeg")).toBe(204);
    }
    await database.db.insert(sellerProductMedia).values([
      {
        id: expiredId,
        sellerProductSubmissionId: seller.submissionId,
        quarantineObjectKey: expiredKey,
        declaredMime: "image/jpeg",
        declaredByteSize: fixtureImage.byteLength,
        sortOrder: 0,
        rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
        rightsAcceptedAt: now,
        uploadExpiresAt: new Date(now.getTime() - QUARANTINE_RETENTION_MS),
        createdAt: new Date(now.getTime() - QUARANTINE_RETENTION_MS - 1),
      },
      {
        id: freshId,
        sellerProductSubmissionId: seller.submissionId,
        quarantineObjectKey: freshKey,
        declaredMime: "image/jpeg",
        declaredByteSize: fixtureImage.byteLength,
        sortOrder: 1,
        rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
        rightsAcceptedAt: now,
        uploadExpiresAt: new Date(now.getTime() + 60_000),
      },
    ]);

    await processNextMedia(database, storage, now);
    const rows = await database.db
      .select({ id: sellerProductMedia.id, status: sellerProductMedia.status })
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.sellerProductSubmissionId, seller.submissionId));
    expect(rows.find((row) => row.id === expiredId)?.status).toBe("ABANDONED");
    expect(rows.find((row) => row.id === freshId)?.status).toBe("PENDING_UPLOAD");
    expect(await storage.head(expiredKey)).toBeNull();
    expect(await storage.head(freshKey)).not.toBeNull();
  });

  it("recovers expired leases and safely resumes partial canonical writes", async () => {
    const expired = await directUploadedMedia();
    const activeLeaseUntil = new Date(Date.now() + 60_000);
    await database.db
      .update(sellerProductMedia)
      .set({
        status: "PROCESSING",
        processingAttempts: 1,
        processingLeaseUntil: activeLeaseUntil,
      })
      .where(eq(sellerProductMedia.id, expired.mediaId));
    expect(await processNextMedia(database, storage, new Date())).toBeNull();
    const [stillLeased] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, expired.mediaId));
    expect(stillLeased).toMatchObject({
      status: "PROCESSING",
      processingAttempts: 1,
      processingLeaseUntil: activeLeaseUntil,
    });
    await database.db
      .update(sellerProductMedia)
      .set({ processingLeaseUntil: new Date(Date.now() - 60_000) })
      .where(eq(sellerProductMedia.id, expired.mediaId));
    await processNextMedia(database, storage);
    const [recovered] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, expired.mediaId));
    expect(recovered).toMatchObject({ status: "READY_FOR_REVIEW", processingAttempts: 2 });

    const partial = await directUploadedMedia();
    let writes = 0;
    const partialStorage: MediaStorage = {
      ...delegatedStorage(storage),
      putImmutable(input) {
        writes += 1;
        return writes === 2
          ? Promise.reject(new Error("disposable partial-write interruption"))
          : storage.putImmutable(input);
      },
    };
    const partialFailedAt = new Date();
    await processNextMedia(database, partialStorage, partialFailedAt);
    await processNextMedia(
      database,
      storage,
      new Date(partialFailedAt.getTime() + MEDIA_PROCESSING_RETRY_BASE_MS + 1),
    );
    const [completed] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, partial.mediaId));
    const variants = await database.db
      .select()
      .from(sellerProductMediaVariants)
      .where(eq(sellerProductMediaVariants.sellerMediaId, partial.mediaId));
    expect(completed).toMatchObject({ status: "READY_FOR_REVIEW", processingAttempts: 2 });
    expect(variants).toHaveLength(MEDIA_VARIANTS.length);
  });

  it("does not retry a permanently invalid image", async () => {
    const seller = await approvedSeller(`phase8-invalid-worker-${randomUUID()}@example.com`);
    const invalid = Buffer.from("not an image");
    const intentResponse = await post(
      `/api/v1/seller/products/${seller.submissionId}/media/upload-intents`,
      { declaredMime: "image/jpeg", declaredSize: invalid.byteLength, rightsAccepted: true },
      seller.cookie,
    );
    const intent = intentResponse.json<{
      media: { id: string };
      upload: { url: string; fields: Record<string, string> };
    }>();
    expect(await uploadGrant(intent.upload, invalid, "image/jpeg")).toBe(204);
    expect(
      (
        await post(
          `/api/v1/seller/products/${seller.submissionId}/media/${intent.media.id}/finalize`,
          {},
          seller.cookie,
        )
      ).statusCode,
    ).toBe(200);
    await processNextMedia(database, storage);
    const [failed] = await database.db
      .select()
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.id, intent.media.id));
    expect(failed).toMatchObject({
      status: "PROCESSING_FAILED",
      processingAttempts: 3,
      lastProcessingErrorCode: "INVALID_IMAGE",
    });
    expect(await processNextMedia(database, storage)).toBeNull();
  });
});

describe("controlled catalog activation", () => {
  it("reports explicit readiness checks and denies activation without prerequisites", async () => {
    const fixture = await activationFixture({ media: false, inventory: false });
    const readiness = await getActivationReadiness(database, fixture.submissionId, true);

    expect(readiness).toMatchObject({
      ready: false,
      checks: { inventoryConfigured: false, approvedSelectedMedia: false, completeVariants: false },
    });
    await expect(
      activateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
    ).rejects.toThrow("Inventory must be configured");
  });

  it("requires an explicit active CATALOG_ACTIVATE grant and post-grant fresh MFA session", async () => {
    const fixture = await activationFixture();
    await database.db
      .update(session)
      .set({ createdAt: fixture.grantedAt })
      .where(eq(session.id, fixture.authorization.sessionId));
    await expect(
      activateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
    ).rejects.toMatchObject({ code: "STAFF_REAUTH_REQUIRED" });

    await database.db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(session.id, fixture.authorization.sessionId));
    await database.db
      .update(staffPermissionGrants)
      .set({ revokedAt: new Date(), revokedByUserId: fixture.staffUserId })
      .where(eq(staffPermissionGrants.staffUserId, fixture.staffUserId));
    await expect(
      activateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
    ).rejects.toMatchObject({ code: "STAFF_PERMISSION_REQUIRED" });
  });

  it("serializes concurrent activation into one non-purchasable product and immutable snapshots", async () => {
    const fixture = await activationFixture();
    const readiness = await getActivationReadiness(database, fixture.submissionId, true);
    expect(readiness.ready).toBe(true);
    const results = await Promise.all([
      activateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
      activateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
    ]);
    const [productCount] = await database.db
      .select({ value: count() })
      .from(products)
      .where(eq(products.source, "SELLER"));
    const [activationCount] = await database.db
      .select({ value: count() })
      .from(sellerProductActivations);
    const [inventoryCount] = await database.db.select({ value: count() }).from(productInventory);
    const [mediaCount] = await database.db.select({ value: count() }).from(productMedia);
    const [auditCount] = await database.db
      .select({ value: count() })
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "CATALOG_ACTIVATED"));

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.product.id))).toEqual(
      new Set([results[0].product.id]),
    );
    expect(productCount?.value).toBe(1);
    expect(activationCount?.value).toBe(1);
    expect(inventoryCount?.value).toBe(1);
    const [inventorySnapshot] = await database.db.select().from(productInventory);
    expect(inventorySnapshot?.quantityOnHand).toBe(5);
    expect(mediaCount?.value).toBe(1);
    expect(auditCount?.value).toBe(1);
    const [sellerProduct] = await database.db
      .select()
      .from(products)
      .where(eq(products.source, "SELLER"));
    expect(sellerProduct).toMatchObject({ isActive: true, isPurchasable: false });
    await expect(
      priceCart(database.db, {
        items: [{ productId: sellerProduct!.catalogKey, quantity: 1 }],
      }),
    ).rejects.toThrow("One or more products are unavailable");
    await expect(
      priceCart(database.db, { items: [{ productId: "lp-01", quantity: 1 }] }),
    ).resolves.toMatchObject({ totalMinor: 7_850_000n });
    const sellerCart = { items: [{ productId: sellerProduct!.catalogKey, quantity: 1 }] };
    const quote = await app.inject({
      method: "POST",
      url: "/api/v1/checkout/quote",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: fixture.sellerCookie },
      payload: sellerCart,
    });
    const order = await app.inject({
      method: "POST",
      url: "/api/v1/orders",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        cookie: fixture.sellerCookie,
        "idempotency-key": randomUUID(),
      },
      payload: sellerCart,
    });
    const [orderCount] = await database.db.select({ value: count() }).from(orders);
    expect(quote.statusCode).toBe(400);
    expect(order.statusCode).toBe(400);
    expect(orderCount?.value).toBe(0);

    const publicList = await app.inject({ method: "GET", url: "/api/v1/products" });
    const body = publicList.json<{ products: Array<Record<string, unknown>> }>();
    expect(body.products).toHaveLength(45);
    const publicSeller = body.products.find((product) => product["slug"] === sellerProduct?.slug);
    expect(publicSeller).toMatchObject({ isPurchasable: false });
    expect(JSON.stringify(publicSeller)).not.toMatch(
      /sellerApplicationId|sellerProductSubmissionId|userId|kraPin|registrationNumber|email|phone/,
    );

    const mediaPath = (
      publicSeller?.["media"] as Array<{ variants: { MEDIUM: { path: string } } }>
    )[0]?.variants.MEDIUM.path;
    expect(mediaPath).toBeDefined();
    const delivered = await app.inject({ method: "GET", url: mediaPath ?? "/invalid" });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers).toMatchObject({
      "content-type": "image/webp",
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=600, must-revalidate",
    });
    expect(Number(delivered.headers["content-length"])).toBe(delivered.rawPayload.byteLength);
    expect(delivered.headers.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    const ranged = await app.inject({
      method: "GET",
      url: mediaPath ?? "/invalid",
      headers: { range: "bytes=0-9" },
    });
    expect(ranged.statusCode).toBe(200);
    expect(ranged.rawPayload).toEqual(delivered.rawPayload);

    const [mappedVariant] = await database.db
      .select({ id: productMediaVariants.id })
      .from(productMediaVariants)
      .innerJoin(productMedia, eq(productMedia.id, productMediaVariants.productMediaId))
      .where(
        and(
          eq(productMedia.productId, sellerProduct!.id),
          eq(productMediaVariants.variant, "MEDIUM"),
        ),
      )
      .limit(1);
    if (!mappedVariant) throw new Error("Expected a disposable mapped media variant");
    await database.db
      .update(productMediaVariants)
      .set({ objectKey: `canonical/missing/${randomUUID()}.webp` })
      .where(eq(productMediaVariants.id, mappedVariant.id));
    const unavailable = await app.inject({ method: "GET", url: mediaPath ?? "/invalid" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json<{ error: { code: string } }>().error.code).toBe(
      "MEDIA_STORAGE_UNAVAILABLE",
    );
    expect(unavailable.body).not.toMatch(/bucket|object|canonical|key/i);

    const inventoryEdit = await put(
      `/api/v1/seller/products/${fixture.submissionId}/inventory`,
      { quantityAvailable: 7 },
      fixture.sellerCookie,
    );
    expect(inventoryEdit.statusCode).toBe(409);
  });

  it("serializes seller preparation edits with activation into coherent snapshots", async () => {
    const inventoryFixture = await activationFixture();
    const [inventoryActivation, inventoryEdit] = await Promise.all([
      activateSellerProduct(
        database,
        inventoryFixture.authorization,
        inventoryFixture.submissionId,
        randomUUID(),
      ),
      put(
        `/api/v1/seller/products/${inventoryFixture.submissionId}/inventory`,
        { quantityAvailable: 7 },
        inventoryFixture.sellerCookie,
      ),
    ]);
    const [inventorySnapshot] = await database.db
      .select()
      .from(productInventory)
      .where(eq(productInventory.productId, inventoryActivation.product.id));
    expect([200, 409]).toContain(inventoryEdit.statusCode);
    expect(inventorySnapshot?.quantityOnHand).toBe(inventoryEdit.statusCode === 200 ? 7 : 5);

    const mediaFixture = await activationFixture();
    const secondMedia = await insertApprovedMedia(mediaFixture.submissionId);
    const approvedMedia = await database.db
      .select({ id: sellerProductMedia.id })
      .from(sellerProductMedia)
      .where(eq(sellerProductMedia.sellerProductSubmissionId, mediaFixture.submissionId));
    const orderedMediaIds = approvedMedia.map((media) => media.id).reverse();
    const [mediaActivation, arrangement] = await Promise.all([
      activateSellerProduct(
        database,
        mediaFixture.authorization,
        mediaFixture.submissionId,
        randomUUID(),
      ),
      post(
        `/api/v1/seller/products/${mediaFixture.submissionId}/media/arrange`,
        { orderedMediaIds, selectedMediaIds: [secondMedia.id] },
        mediaFixture.sellerCookie,
      ),
    ]);
    const snapshots = await database.db
      .select({ sourceSellerMediaId: productMedia.sourceSellerMediaId })
      .from(productMedia)
      .where(eq(productMedia.productId, mediaActivation.product.id));
    expect([200, 409]).toContain(arrangement.statusCode);
    if (arrangement.statusCode === 200) {
      expect(snapshots).toEqual([{ sourceSellerMediaId: secondMedia.id }]);
    } else {
      expect(snapshots).toHaveLength(2);
    }
  });

  it("deactivates only the seller snapshot, audits once, and immediately removes public access", async () => {
    const fixture = await activationFixture();
    const activated = await activateSellerProduct(
      database,
      fixture.authorization,
      fixture.submissionId,
      randomUUID(),
    );
    const canonicalObjects = await database.db
      .select({ objectKey: productMediaVariants.objectKey })
      .from(productMediaVariants)
      .innerJoin(productMedia, eq(productMedia.id, productMediaVariants.productMediaId))
      .where(eq(productMedia.productId, activated.product.id));
    const first = await deactivateSellerProduct(
      database,
      fixture.authorization,
      fixture.submissionId,
      randomUUID(),
    );
    const duplicate = await deactivateSellerProduct(
      database,
      fixture.authorization,
      fixture.submissionId,
      randomUUID(),
    );
    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/products/${activated.product.slug}`,
    });
    const [retainedActivation] = await database.db
      .select({ value: count() })
      .from(sellerProductActivations);
    const [retainedMedia] = await database.db.select({ value: count() }).from(productMediaVariants);
    const [auditCount] = await database.db
      .select({ value: count() })
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "CATALOG_DEACTIVATED"));

    expect(first.changed).toBe(true);
    expect(duplicate.changed).toBe(false);
    expect(detail.statusCode).toBe(404);
    expect(retainedActivation?.value).toBe(1);
    expect(retainedMedia?.value).toBe(3);
    expect(auditCount?.value).toBe(1);
    for (const canonical of canonicalObjects) {
      expect(await storage.head(canonical.objectKey)).not.toBeNull();
    }

    const cleanupMediaId = randomUUID();
    const quarantineKey = `quarantine/cleanup/${cleanupMediaId}`;
    const cleanupGrant = await storage.createUploadGrant({
      objectKey: quarantineKey,
      declaredMime: "image/jpeg",
      exactByteSize: fixtureImage.byteLength,
      mediaId: cleanupMediaId,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await uploadGrant(cleanupGrant, fixtureImage, "image/jpeg")).toBe(204);
    await database.db.insert(sellerProductMedia).values({
      id: cleanupMediaId,
      sellerProductSubmissionId: fixture.submissionId,
      status: "ABANDONED",
      quarantineObjectKey: quarantineKey,
      declaredMime: "image/jpeg",
      declaredByteSize: fixtureImage.byteLength,
      sortOrder: 99,
      rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
      rightsAcceptedAt: new Date(),
      uploadExpiresAt: new Date(Date.now() - 60_000),
      quarantineDeletePending: true,
    });
    await processNextMedia(database, storage);
    expect(await storage.head(quarantineKey)).toBeNull();
    for (const canonical of canonicalObjects) {
      expect(await storage.head(canonical.objectKey)).not.toBeNull();
    }
  });

  it("keeps activation and deactivation races idempotent without orphan snapshots", async () => {
    const fixture = await activationFixture();
    const raced = await Promise.allSettled([
      activateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
      deactivateSellerProduct(database, fixture.authorization, fixture.submissionId, randomUUID()),
    ]);
    expect(raced[0].status).toBe("fulfilled");
    const [productCount] = await database.db
      .select({ value: count() })
      .from(products)
      .where(eq(products.source, "SELLER"));
    const [activationCount] = await database.db
      .select({ value: count() })
      .from(sellerProductActivations);
    const [inventoryCount] = await database.db.select({ value: count() }).from(productInventory);
    const [mediaCount] = await database.db.select({ value: count() }).from(productMedia);
    expect(productCount?.value).toBe(1);
    expect(activationCount?.value).toBe(1);
    expect(inventoryCount?.value).toBe(1);
    expect(mediaCount?.value).toBe(1);

    const [product] = await database.db
      .select({ active: products.isActive })
      .from(products)
      .where(eq(products.source, "SELLER"));
    expect(typeof product?.active).toBe("boolean");
    const deactivationAudits = await database.db
      .select()
      .from(staffAuditEvents)
      .where(eq(staffAuditEvents.action, "CATALOG_DEACTIVATED"));
    expect(deactivationAudits).toHaveLength(product?.active ? 0 : 1);

    if (product?.active) {
      const deactivations = await Promise.all([
        deactivateSellerProduct(
          database,
          fixture.authorization,
          fixture.submissionId,
          randomUUID(),
        ),
        deactivateSellerProduct(
          database,
          fixture.authorization,
          fixture.submissionId,
          randomUUID(),
        ),
      ]);
      expect(deactivations.filter((result) => result.changed)).toHaveLength(1);
    }
  });
});

async function approvedSeller(email: string) {
  const registration = await post("/api/auth/sign-up/email", {
    name: "Phase Eight Seller",
    email,
    phone: "0712345678",
    password: PASSWORD,
    callbackURL: `${ORIGIN}/verify-email`,
  });
  expect(registration.statusCode).toBe(200);
  const message = emailSender.messages.find((candidate) => candidate.recipient === email);
  const token = new URLSearchParams(new URL(message?.url ?? "").hash.slice(1)).get("token") ?? "";
  expect((await post("/api/v1/auth/verify-email", { token })).statusCode).toBe(200);
  const login = await post("/api/auth/sign-in/email", { email, password: PASSWORD });
  const cookie = sessionCookie(login);
  const [owner] = await database.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  const now = new Date();
  const [application] = await database.db
    .insert(sellerApplications)
    .values({
      userId: owner!.id,
      sellerType: "COMPANY",
      legalName: "Phase Eight Test Seller Limited",
      registrationNumber: `TEST-${randomUUID()}`,
      kraPin: "P123456789Z",
      status: "APPROVED",
      termsVersion: "seller-terms-v1",
      termsAcceptedAt: now,
      submittedAt: now,
      reviewedAt: now,
    })
    .returning();
  const [submission] = await database.db
    .insert(sellerProductSubmissions)
    .values({
      sellerApplicationId: application!.id,
      status: "APPROVED",
      name: "Phase Eight Controlled Product",
      category: "Accessories",
      description: "Controlled Phase Eight integration product for media review.",
      priceMinor: 1_000n,
      termsVersion: "seller-product-terms-v1",
      termsAcceptedAt: now,
      submittedAt: now,
      reviewStartedAt: now,
      reviewedAt: now,
    })
    .returning();
  return { cookie, applicationId: application!.id, submissionId: submission!.id };
}

async function activationFixture(options: { media?: boolean; inventory?: boolean } = {}) {
  const seller = await approvedSeller(`phase8-activation-${randomUUID()}@example.com`);
  if (options.inventory !== false) {
    await database.db.insert(sellerProductInventory).values({
      sellerProductSubmissionId: seller.submissionId,
      quantityAvailable: 5,
    });
  }
  if (options.media !== false) await insertApprovedMedia(seller.submissionId);

  const staffUserId = randomUUID();
  const membershipCreatedAt = new Date(Date.now() - 10 * 60_000);
  const grantedAt = new Date(Date.now() - 5 * 60_000);
  const sessionCreatedAt = new Date(Date.now() - 60_000);
  const sessionId = randomUUID();
  await database.db.insert(user).values({
    id: staffUserId,
    name: "Phase Eight Staff",
    email: `${staffUserId}@example.com`,
    phone: "0712345678",
    emailVerified: true,
    twoFactorEnabled: true,
  });
  await database.db.insert(twoFactor).values({
    id: randomUUID(),
    userId: staffUserId,
    secret: "encrypted-test-factor-placeholder",
    backupCodes: "encrypted-test-backup-placeholder",
    verified: true,
  });
  await database.db.insert(staffMemberships).values({
    userId: staffUserId,
    role: "STAFF",
    createdAt: membershipCreatedAt,
  });
  await database.db.insert(staffPermissionGrants).values({
    staffUserId,
    permission: "CATALOG_ACTIVATE",
    grantSource: "BOOTSTRAP",
    grantedAt,
  });
  await database.db.insert(session).values({
    id: sessionId,
    userId: staffUserId,
    token: randomUUID(),
    createdAt: sessionCreatedAt,
    updatedAt: sessionCreatedAt,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  const authorization: StaffAuthorization = {
    actor: { userId: staffUserId, role: "STAFF", permission: "CATALOG_ACTIVATE" },
    sessionId,
  };
  return {
    ...seller,
    sellerCookie: seller.cookie,
    staffUserId,
    grantedAt,
    authorization,
  };
}

async function insertApprovedMedia(submissionId: string) {
  const mediaId = randomUUID();
  const now = new Date();
  const [media] = await database.db
    .insert(sellerProductMedia)
    .values({
      id: mediaId,
      sellerProductSubmissionId: submissionId,
      status: "APPROVED",
      quarantineObjectKey: `quarantine/fixture/${mediaId}`,
      canonicalObjectKey: `canonical/fixture/${mediaId}/master.webp`,
      declaredMime: "image/jpeg",
      detectedMime: "image/jpeg",
      canonicalMime: "image/webp",
      declaredByteSize: fixtureImage.byteLength,
      inputByteSize: fixtureImage.byteLength,
      canonicalByteSize: 1,
      width: 720,
      height: 680,
      sha256: sha256Hex(fixtureImage),
      sortOrder: 0,
      selectedForActivation: true,
      rightsTermsVersion: SELLER_MEDIA_RIGHTS_VERSION,
      rightsAcceptedAt: now,
      uploadExpiresAt: new Date(now.getTime() + 60_000),
      uploadedAt: now,
      processingStartedAt: now,
      processedAt: now,
      reviewedAt: now,
    })
    .returning();
  for (const [index, variant] of MEDIA_VARIANTS.entries()) {
    const width = [2400, 320, 960, 1600][index]!;
    const body = await sharp(fixtureImage)
      .resize({ width, fit: "inside", withoutEnlargement: true })
      .webp()
      .toBuffer();
    const objectKey = `canonical/fixture/${mediaId}/${variant.toLowerCase()}.webp`;
    await storage.putImmutable({
      objectKey,
      body,
      contentType: "image/webp",
      sha256: sha256Hex(body),
    });
    await database.db.insert(sellerProductMediaVariants).values({
      sellerMediaId: mediaId,
      variant,
      objectKey,
      mime: "image/webp",
      width: Math.min(width, 720),
      height: Math.round((Math.min(width, 720) / 720) * 680),
      byteSize: body.byteLength,
      sha256: sha256Hex(body),
    });
  }
  return media!;
}

async function directUploadedMedia() {
  const seller = await approvedSeller(`phase8-worker-${randomUUID()}@example.com`);
  const intent = await createIntent(seller.cookie, seller.submissionId);
  expect(await uploadGrant(intent.upload, fixtureImage, "image/jpeg")).toBe(204);
  const finalized = await post(
    `/api/v1/seller/products/${seller.submissionId}/media/${intent.media.id}/finalize`,
    {},
    seller.cookie,
  );
  expect(finalized.statusCode).toBe(200);
  const [row] = await database.db
    .select({ objectKey: sellerProductMedia.quarantineObjectKey })
    .from(sellerProductMedia)
    .where(eq(sellerProductMedia.id, intent.media.id));
  return { mediaId: intent.media.id, objectKey: row!.objectKey };
}

async function createIntent(cookie: string, submissionId: string) {
  const response = await post(
    `/api/v1/seller/products/${submissionId}/media/upload-intents`,
    { declaredMime: "image/jpeg", declaredSize: fixtureImage.byteLength, rightsAccepted: true },
    cookie,
  );
  expect(response.statusCode).toBe(201);
  return response.json<{
    media: { id: string; rightsTermsVersion: string } & Record<string, unknown>;
    upload: { method: "POST"; url: string; fields: Record<string, string>; expiresAt: string };
  }>();
}

async function uploadGrant(
  grant: { url: string; fields: Record<string, string> },
  body: Buffer,
  mime: string,
  overrides: Record<string, string> = {},
): Promise<number> {
  const form = new FormData();
  for (const [name, value] of Object.entries(grant.fields)) form.append(name, value);
  form.set("Content-Type", mime);
  for (const [name, value] of Object.entries(overrides)) form.set(name, value);
  form.append("file", new Blob([body], { type: mime }));
  return (await fetch(grant.url, { method: "POST", body: form })).status;
}

async function emptyTestBucket(): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const listed = await minio.send(
      new ListObjectsV2Command({
        Bucket: mediaBucket,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
      }),
    );
    const objects = (listed.Contents ?? []).flatMap((object) =>
      object.Key ? [{ Key: object.Key }] : [],
    );
    if (objects.length > 0) {
      await minio.send(
        new DeleteObjectsCommand({ Bucket: mediaBucket, Delete: { Objects: objects } }),
      );
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
}

function delegatedStorage(target: MediaStorage): MediaStorage {
  return {
    createUploadGrant: (input) => target.createUploadGrant(input),
    head: (key) => target.head(key),
    get: (key, options) => target.get(key, options),
    putImmutable: (input) => target.putImmutable(input),
    deleteQuarantine: (key) => target.deleteQuarantine(key),
  };
}

function post(url: string, payload: Record<string, unknown>, cookie?: string) {
  return inject("POST", url, payload, cookie);
}

function put(url: string, payload: Record<string, unknown>, cookie?: string) {
  return inject("PUT", url, payload, cookie);
}

function inject(
  method: "POST" | "PUT",
  url: string,
  payload: Record<string, unknown>,
  cookie?: string,
) {
  requestCounter += 1;
  return app.inject({
    method,
    url,
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-real-ip": `203.0.113.${requestCounter % 250}`,
      ...(cookie ? { cookie } : {}),
    },
    payload,
  });
}

function get(url: string, cookie?: string) {
  return app.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
}

function sessionCookie(response: InjectResponse): string {
  const header = response.headers["set-cookie"];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = values.find((value) => value.includes("session_token"))?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  return cookie ?? "";
}

function isBucketExists(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    ["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(String(error.name)),
  );
}
