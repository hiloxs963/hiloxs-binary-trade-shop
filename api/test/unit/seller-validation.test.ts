import { describe, expect, it } from "vitest";
import { SELLER_TERMS_VERSION, SELLER_TYPES } from "../../src/sellers/model.js";
import {
  SellerDraftSchema,
  SellerSubmissionConsentSchema,
  SellerSubmissionFieldsSchema,
} from "../../src/sellers/validation.js";

describe("seller application validation", () => {
  it.each(SELLER_TYPES)("accepts the centralized %s seller type", (sellerType) => {
    const input = draftFor(sellerType);
    expect(SellerSubmissionFieldsSchema.parse(input).sellerType).toBe(sellerType);
  });

  it("allows incomplete drafts but requires type-specific submission fields", () => {
    const incomplete = { sellerType: "COMPANY", legalName: "Example Limited" };
    expect(SellerDraftSchema.safeParse(incomplete).success).toBe(true);
    expect(SellerSubmissionFieldsSchema.safeParse(incomplete).success).toBe(false);
    expect(
      SellerSubmissionFieldsSchema.safeParse({
        sellerType: "REGISTERED_BUSINESS",
        legalName: "Example Traders",
        kraPin: "A123456789Z",
      }).success,
    ).toBe(false);
  });

  it("does not collect a registration number for sole proprietors", () => {
    expect(
      SellerDraftSchema.safeParse({
        ...draftFor("SOLE_PROPRIETOR"),
        registrationNumber: "BN-12345",
      }).success,
    ).toBe(false);
    expect(SellerSubmissionFieldsSchema.safeParse(draftFor("SOLE_PROPRIETOR")).success).toBe(true);
  });

  it("validates only the documented KRA PIN structure and seller-type prefix", () => {
    expect(
      SellerDraftSchema.safeParse({ ...draftFor("COMPANY"), kraPin: "A123456789Z" }).success,
    ).toBe(false);
    expect(
      SellerDraftSchema.safeParse({ ...draftFor("SOLE_PROPRIETOR"), kraPin: "P123456789Z" })
        .success,
    ).toBe(false);
    expect(SellerDraftSchema.safeParse({ ...draftFor("COMPANY"), kraPin: "P12345" }).success).toBe(
      false,
    );
    expect(
      SellerSubmissionFieldsSchema.safeParse({
        ...draftFor("REGISTERED_BUSINESS"),
        kraPin: "A123456789Z",
      }).success,
    ).toBe(true);
  });

  it("normalizes names, registration numbers, and KRA PIN casing", () => {
    expect(
      SellerDraftSchema.parse({
        sellerType: "COMPANY",
        legalName: "  Example   Holdings Limited  ",
        tradingName: "  Example   Market ",
        registrationNumber: " pvt-abc/123 ",
        kraPin: "p123456789z",
      }),
    ).toEqual({
      sellerType: "COMPANY",
      legalName: "Example Holdings Limited",
      tradingName: "Example Market",
      registrationNumber: "PVT-ABC/123",
      kraPin: "P123456789Z",
    });
  });

  it("accepts bounded registration identifiers without pretending to verify a provider format", () => {
    expect(
      SellerDraftSchema.parse({
        ...draftFor("COMPANY"),
        registrationNumber: " cpr (kenya) #123/2026 ",
      }).registrationNumber,
    ).toBe("CPR (KENYA) #123/2026");
  });

  it("rejects markup, control characters, and oversized values", () => {
    expect(
      SellerDraftSchema.safeParse({
        ...draftFor("COMPANY"),
        legalName: "<script>alert(1)</script>",
      }).success,
    ).toBe(false);
    expect(
      SellerDraftSchema.safeParse({ ...draftFor("COMPANY"), tradingName: "Bad\u0000Name" }).success,
    ).toBe(false);
    expect(
      SellerDraftSchema.safeParse({ ...draftFor("COMPANY"), tradingName: "javascript:alert(1)" })
        .success,
    ).toBe(false);
    expect(
      SellerDraftSchema.safeParse({ ...draftFor("COMPANY"), legalName: "x".repeat(161) }).success,
    ).toBe(false);
    expect(
      SellerDraftSchema.safeParse({
        ...draftFor("COMPANY"),
        registrationNumber: "BN-123\n456",
      }).success,
    ).toBe(false);
    expect(
      SellerDraftSchema.safeParse({
        ...draftFor("COMPANY"),
        registrationNumber: "BN-123\u202E456",
      }).success,
    ).toBe(false);
  });

  it("rejects browser-owned identity, status, reviewer, and unknown fields", () => {
    for (const field of ["userId", "status", "reviewReason", "reviewedAt", "sellerProfileId"]) {
      expect(
        SellerDraftSchema.safeParse({ ...draftFor("COMPANY"), [field]: "injected" }).success,
      ).toBe(false);
    }
  });

  it("requires explicit current-version consent without extra fields", () => {
    expect(
      SellerSubmissionConsentSchema.parse({
        termsAccepted: true,
        termsVersion: SELLER_TERMS_VERSION,
      }),
    ).toEqual({ termsAccepted: true, termsVersion: SELLER_TERMS_VERSION });
    expect(
      SellerSubmissionConsentSchema.safeParse({
        termsAccepted: false,
        termsVersion: SELLER_TERMS_VERSION,
      }).success,
    ).toBe(false);
    expect(
      SellerSubmissionConsentSchema.safeParse({
        termsAccepted: true,
        termsVersion: "old-terms",
      }).success,
    ).toBe(false);
    expect(
      SellerSubmissionConsentSchema.safeParse({
        termsAccepted: true,
        termsVersion: SELLER_TERMS_VERSION,
        status: "APPROVED",
      }).success,
    ).toBe(false);
  });
});

function draftFor(sellerType: (typeof SELLER_TYPES)[number]) {
  return {
    sellerType,
    legalName: sellerType === "SOLE_PROPRIETOR" ? "Jane Wanjiku" : "Example Enterprise",
    tradingName: "Example Shop",
    ...(sellerType === "SOLE_PROPRIETOR" ? {} : { registrationNumber: "BN-12345" }),
    kraPin: sellerType === "SOLE_PROPRIETOR" ? "A123456789Z" : "P123456789Z",
  };
}
