import { describe, expect, it } from "vitest";
import {
  RegistrationSchema,
  normalizeEmail,
  normalizePhone,
  validateTrustedRedirect,
} from "../../src/auth/validation.js";

describe("authentication input validation", () => {
  it("normalizes email and Kenyan phone formats", () => {
    expect(normalizeEmail("  Customer@Example.COM ")).toBe("customer@example.com");
    expect(normalizePhone("0712 345 678")).toBe("+254712345678");
    expect(normalizePhone("254-712-345-678")).toBe("+254712345678");
    expect(normalizePhone("+1 (202) 555-0147")).toBe("+12025550147");
  });

  it("rejects invalid phone numbers and weak passwords", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(() =>
      RegistrationSchema.parse({
        name: "Test User",
        email: "test@example.com",
        phone: "0712345678",
        password: "alllowercase",
      }),
    ).toThrow();
  });

  it("accepts only absolute redirects on trusted origins", () => {
    const trusted = ["http://localhost:8080", "https://hiloxs.co.ke"];
    expect(validateTrustedRedirect("http://localhost:8080/reset-password", trusted)).toBe(true);
    expect(validateTrustedRedirect("https://attacker.example/reset-password", trusted)).toBe(false);
    expect(validateTrustedRedirect("//attacker.example/reset-password", trusted)).toBe(false);
  });
});
