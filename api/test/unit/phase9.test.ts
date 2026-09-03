import { describe, expect, it } from "vitest";
import { fingerprintOrderRequest } from "../../src/commerce/idempotency.js";
import { RESERVATION_TTL_MS, KENYA_COUNTIES } from "../../src/orders/model.js";
import {
  DeliveryAddressSchema,
  DispatchInputSchema,
  FulfillmentConfigInputSchema,
  FulfillmentIssueInputSchema,
  LiveInventoryInputSchema,
  OrderCreateSchema,
} from "../../src/orders/validation.js";

const address = {
  recipientName: "Test Recipient",
  phone: "0712345678",
  county: "Nairobi",
  town: "Nairobi",
  addressLine: "Test delivery address",
};

describe("Phase 9 request trust boundaries", () => {
  it("uses a server-controlled 30 minute reservation TTL", () => {
    expect(RESERVATION_TTL_MS).toBe(30 * 60 * 1_000);
  });

  it("uses the exact 47 Kenya counties", () => {
    expect(KENYA_COUNTIES).toHaveLength(47);
    expect(new Set(KENYA_COUNTIES).size).toBe(47);
  });

  it("normalizes Kenyan delivery phone numbers", () => {
    expect(DeliveryAddressSchema.parse(address).phone).toBe("+254712345678");
  });

  it.each([
    { ...address, county: "Not a county" },
    { ...address, recipientName: "<b>Test</b>" },
    { ...address, town: "Safe\u202eunsafe" },
    { ...address, phone: "123" },
  ])("rejects invalid delivery data", (input) => {
    expect(() => DeliveryAddressSchema.parse(input)).toThrow();
  });

  it("rejects browser-authoritative order and inventory fields", () => {
    expect(() =>
      OrderCreateSchema.parse({
        items: [{ productId: "product", quantity: 1 }],
        deliveryAddress: address,
        status: "PAID",
      }),
    ).toThrow();
    expect(() =>
      LiveInventoryInputSchema.parse({ quantityOnHand: 5, quantityReserved: 0 }),
    ).toThrow();
  });

  it.each([-1, 1.5, 1_000_001])("rejects unsafe inventory value %s", (quantityOnHand) => {
    expect(() => LiveInventoryInputSchema.parse({ quantityOnHand })).toThrow();
  });

  it("requires explicit current fulfillment terms consent", () => {
    expect(FulfillmentConfigInputSchema.parse({ termsAccepted: true })).toEqual({
      termsAccepted: true,
    });
    expect(() => FulfillmentConfigInputSchema.parse({ termsAccepted: false })).toThrow();
  });

  it("rejects arbitrary status fields and tracking URLs", () => {
    expect(() => DispatchInputSchema.parse({ carrier: "Courier", status: "DELIVERED" })).toThrow();
    expect(() => DispatchInputSchema.parse({ carrier: "https://tracker.example" })).toThrow();
  });

  it("allows only centralized fulfillment issue reasons", () => {
    expect(FulfillmentIssueInputSchema.parse({ reason: "OUT_OF_STOCK" })).toEqual({
      reason: "OUT_OF_STOCK",
    });
    expect(() => FulfillmentIssueInputSchema.parse({ reason: "REFUND_NOW" })).toThrow();
  });

  it("includes normalized delivery data in the idempotency fingerprint", () => {
    const request = OrderCreateSchema.parse({
      items: [{ productId: "product", quantity: 1 }],
      deliveryAddress: address,
    });
    const reordered = OrderCreateSchema.parse({
      items: [{ productId: "product", quantity: 1 }],
      deliveryAddress: { ...address, phone: "+254712345678" },
    });
    const changed = OrderCreateSchema.parse({
      items: [{ productId: "product", quantity: 1 }],
      deliveryAddress: { ...address, town: "Kiambu" },
    });
    expect(fingerprintOrderRequest(request)).toBe(fingerprintOrderRequest(reordered));
    expect(fingerprintOrderRequest(request)).not.toBe(fingerprintOrderRequest(changed));
  });
});
