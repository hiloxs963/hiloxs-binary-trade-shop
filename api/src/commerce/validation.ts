import { z } from "zod";
import { CATALOG_CATEGORIES } from "../catalog/initial-catalog.js";

export const MAX_CART_LINES = 20;
export const MAX_ITEM_QUANTITY = 20;

const CartItemSchema = z
  .object({
    productId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
  })
  .strict();

export const CartSchema = z
  .object({
    items: z.array(CartItemSchema).min(1).max(MAX_CART_LINES),
  })
  .strict()
  .superRefine(({ items }, context) => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.productId)) {
        context.addIssue({
          code: "custom",
          path: ["items"],
          message: "Duplicate products are not allowed",
        });
      }
      seen.add(item.productId);
    }
  });

export const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(6)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);

export const EmptyBodySchema = z.object({}).strict();

export const ProductListQuerySchema = z
  .object({
    category: z.enum(CATALOG_CATEGORIES).optional(),
  })
  .strict();

export const ProductSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9-]+$/);
export const OrderIdSchema = z.uuid();

export type CartInput = z.infer<typeof CartSchema>;
