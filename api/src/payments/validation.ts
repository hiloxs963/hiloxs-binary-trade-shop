import { z } from "zod";
import { normalizePhone } from "../auth/validation.js";

const NumericProviderResultCodeSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);

export const ProviderResultCodeSchema = z.union([
  NumericProviderResultCodeSchema,
  z
    .string()
    .regex(/^-?\d+$/)
    .transform(Number)
    .pipe(NumericProviderResultCodeSchema),
]);

export const MpesaInitiationSchema = z
  .object({
    phone: z.string().transform((value, context) => {
      const normalized = normalizeKenyanMpesaPhone(value);
      if (!normalized) {
        context.addIssue({ code: "custom", message: "Enter a valid Kenyan M-Pesa phone number" });
        return z.NEVER;
      }
      return normalized;
    }),
  })
  .strict();

export const MpesaCallbackTokenSchema = z
  .string()
  .min(40)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);

const CallbackMetadataItemSchema = z
  .object({
    Name: z.string().min(1).max(100),
    Value: z.unknown().optional(),
  })
  .passthrough();

export const MpesaCallbackSchema = z
  .object({
    Body: z
      .object({
        stkCallback: z
          .object({
            MerchantRequestID: z.string().min(1).max(200),
            CheckoutRequestID: z.string().min(1).max(200),
            ResultCode: ProviderResultCodeSchema,
            ResultDesc: z.string().max(1_000),
            CallbackMetadata: z
              .object({ Item: z.array(CallbackMetadataItemSchema).max(50) })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

export type ParsedMpesaCallback = z.infer<typeof MpesaCallbackSchema>["Body"]["stkCallback"];

export function normalizeKenyanMpesaPhone(value: string): string | null {
  const normalized = normalizePhone(value);
  return normalized && /^\+254(?:1|7)\d{8}$/.test(normalized) ? normalized : null;
}

export function callbackMetadata(callback: ParsedMpesaCallback, name: string): unknown {
  return callback.CallbackMetadata?.Item.find((item) => item.Name === name)?.Value;
}
