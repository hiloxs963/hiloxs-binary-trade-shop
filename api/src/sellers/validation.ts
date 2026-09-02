import { z } from "zod";
import { SELLER_TERMS_VERSION, SELLER_TYPES } from "./model.js";

const noMarkup = (value: string) =>
  !/[<>\p{C}]/u.test(value) && !/(?:javascript|data):/i.test(value);

const NameSchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .refine(noMarkup, "Markup and control characters are not allowed")
  .transform((value) => value.replace(/\s+/g, " "));

const OptionalNameSchema = z.preprocess(emptyStringToUndefined, NameSchema.optional());

const RegistrationNumberSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .min(2)
    .max(80)
    .refine(noMarkup, "Markup and control characters are not allowed")
    .transform((value) => value.replace(/\s+/g, " ").toUpperCase())
    .optional(),
);

const KraPinSchema = z.preprocess(
  emptyStringToUndefined,
  z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[AP][0-9]{9}[A-Z]$/))
    .optional(),
);

export const SellerDraftSchema = z
  .object({
    sellerType: z.enum(SELLER_TYPES),
    legalName: NameSchema,
    tradingName: OptionalNameSchema,
    registrationNumber: RegistrationNumberSchema,
    kraPin: KraPinSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sellerType === "SOLE_PROPRIETOR" && value.registrationNumber) {
      context.addIssue({
        code: "custom",
        path: ["registrationNumber"],
        message: "A registration number is not collected for sole proprietors",
      });
    }
    if (value.sellerType === "COMPANY" && value.kraPin?.startsWith("A")) {
      context.addIssue({
        code: "custom",
        path: ["kraPin"],
        message: "A company KRA PIN must use the non-individual format",
      });
    }
    if (value.sellerType === "SOLE_PROPRIETOR" && value.kraPin?.startsWith("P")) {
      context.addIssue({
        code: "custom",
        path: ["kraPin"],
        message: "A sole proprietor KRA PIN must use the individual format",
      });
    }
  });

export const SellerSubmissionFieldsSchema = SellerDraftSchema.superRefine((value, context) => {
  if (
    (value.sellerType === "COMPANY" || value.sellerType === "REGISTERED_BUSINESS") &&
    !value.registrationNumber
  ) {
    context.addIssue({
      code: "custom",
      path: ["registrationNumber"],
      message: "A registration number is required for this seller type",
    });
  }
  if (!value.kraPin) {
    context.addIssue({
      code: "custom",
      path: ["kraPin"],
      message: "A structurally valid KRA PIN is required before submission",
    });
  }
});

export const SellerSubmissionConsentSchema = z
  .object({
    termsAccepted: z.literal(true),
    termsVersion: z.literal(SELLER_TERMS_VERSION),
  })
  .strict();

export const SellerEmptyBodySchema = z.object({}).strict();
export const SellerApplicationIdSchema = z.uuid();

export const SellerApplicantReviewReasonSchema = z
  .string()
  .trim()
  .min(3)
  .max(500)
  .refine(noMarkup, "Markup and control characters are not allowed")
  .transform((value) => value.replace(/\s+/g, " "));

export type SellerDraftInput = z.infer<typeof SellerDraftSchema>;

function emptyStringToUndefined(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? undefined : value;
}
