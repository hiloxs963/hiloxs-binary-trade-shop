import type { FastifyReply } from "fastify";
import { MediaStorageUnavailableError } from "../lib/errors.js";
import { PUBLIC_MEDIA_CACHE_SECONDS } from "./model.js";
import type { MediaStorage } from "./storage.js";
import { readStoredObject, sha256Hex } from "./storage.js";

type DeliverableVariant = {
  objectKey: string;
  mime: string;
  byteSize: number;
  sha256: string;
};

export async function sendMediaVariant(
  reply: FastifyReply,
  storage: MediaStorage | undefined,
  variant: DeliverableVariant,
  visibility: "private" | "public",
) {
  if (!storage) throw new MediaStorageUnavailableError();
  const object = await storage.get(variant.objectKey);
  const body = await readStoredObject(object, variant.byteSize);
  if (
    object.byteSize !== variant.byteSize ||
    variant.mime !== "image/webp" ||
    sha256Hex(body) !== variant.sha256
  ) {
    throw new MediaStorageUnavailableError();
  }
  // @fastify/helmet defaults Cross-Origin-Resource-Policy to same-origin on every response, which
  // stops the browser rendering these bytes: the frontend is hiloxs.co.ke and the API is
  // api.hiloxs.co.ke. It is overridden for image responses only — JSON endpoints keep the stricter
  // global default. Authorization is unaffected: private variants still require a session and stay
  // no-store.
  return reply
    .type("image/webp")
    .header("X-Content-Type-Options", "nosniff")
    .header("Cross-Origin-Resource-Policy", "cross-origin")
    .header("Content-Length", String(body.byteLength))
    .header("ETag", `"sha256-${variant.sha256}"`)
    .header(
      "Cache-Control",
      visibility === "public"
        ? `public, max-age=${PUBLIC_MEDIA_CACHE_SECONDS}, must-revalidate`
        : "private, no-store",
    )
    .send(body);
}
