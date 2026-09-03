import { z } from "zod";
import {
  ALLOWED_MEDIA_MIME_TYPES,
  MAX_ACTIVE_MEDIA_PER_SUBMISSION,
  MAX_INVENTORY_QUANTITY,
  MAX_MEDIA_INPUT_BYTES,
  PUBLIC_MEDIA_VARIANTS,
} from "./model.js";

export const MediaIdSchema = z.uuid();
export const UploadIntentSchema = z
  .object({
    declaredMime: z.enum(ALLOWED_MEDIA_MIME_TYPES),
    declaredSize: z.number().int().min(1).max(MAX_MEDIA_INPUT_BYTES),
    rightsAccepted: z.literal(true),
  })
  .strict();

export const MediaArrangementSchema = z
  .object({
    orderedMediaIds: z.array(MediaIdSchema).max(MAX_ACTIVE_MEDIA_PER_SUBMISSION),
    selectedMediaIds: z.array(MediaIdSchema).max(MAX_ACTIVE_MEDIA_PER_SUBMISSION),
  })
  .strict()
  .superRefine((value, context) => {
    const ordered = new Set(value.orderedMediaIds);
    const selected = new Set(value.selectedMediaIds);
    if (ordered.size !== value.orderedMediaIds.length) {
      context.addIssue({ code: "custom", message: "Media ordering cannot contain duplicates" });
    }
    if (selected.size !== value.selectedMediaIds.length) {
      context.addIssue({ code: "custom", message: "Media selection cannot contain duplicates" });
    }
    if ([...selected].some((id) => !ordered.has(id))) {
      context.addIssue({ code: "custom", message: "Selected media must be in the ordering" });
    }
  });

export const InventoryInputSchema = z
  .object({ quantityAvailable: z.number().int().min(0).max(MAX_INVENTORY_QUANTITY) })
  .strict();
export const PublicMediaVariantSchema = z.enum(PUBLIC_MEDIA_VARIANTS);
export const MediaRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export const EmptyMediaBodySchema = z.object({}).strict();
