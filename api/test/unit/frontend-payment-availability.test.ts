import { describe, expect, it } from "vitest";
import { mpesaAvailabilityForOrder } from "../../../src/lib/mpesa-availability.js";

describe("frontend M-Pesa availability", () => {
  it("fails closed before configuration loads or when it is unavailable", () => {
    expect(mpesaAvailabilityForOrder(undefined, "HX-0123456789ABCDEF")).toEqual({
      canInitiate: false,
      sandboxTest: false,
    });
    expect(
      mpesaAvailabilityForOrder(
        { mpesa: { available: false, mode: "production" } },
        "HX-0123456789ABCDEF",
      ),
    ).toEqual({ canInitiate: false, sandboxTest: false });
  });

  it("allows ordinary orders only when production capability is enabled", () => {
    expect(
      mpesaAvailabilityForOrder(
        { mpesa: { available: true, mode: "production" } },
        "HX-0123456789ABCDEF",
      ),
    ).toEqual({ canInitiate: true, sandboxTest: false });
  });

  it("allows only clearly identified test orders in sandbox mode", () => {
    const sandboxConfig = { mpesa: { available: false, mode: "sandbox" as const } };

    expect(mpesaAvailabilityForOrder(sandboxConfig, "HX-SBX-0123456789ABCDEF")).toEqual({
      canInitiate: true,
      sandboxTest: true,
    });
    expect(mpesaAvailabilityForOrder(sandboxConfig, "HX-0123456789ABCDEF")).toEqual({
      canInitiate: false,
      sandboxTest: false,
    });
  });

  it("does not trust an impossible sandbox available response for ordinary orders", () => {
    expect(
      mpesaAvailabilityForOrder(
        { mpesa: { available: true, mode: "sandbox" } },
        "HX-0123456789ABCDEF",
      ),
    ).toEqual({ canInitiate: false, sandboxTest: false });
  });
});
