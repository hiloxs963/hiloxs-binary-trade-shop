import { describe, expect, it, vi } from "vitest";
import type { MpesaRuntimeConfig } from "../../src/config/env.js";
import { ValidationError } from "../../src/lib/errors.js";
import {
  DarajaClient,
  formatDarajaTimestamp,
  generateStkPassword,
} from "../../src/payments/daraja-client.js";
import { hashCanonical } from "../../src/payments/hash.js";
import { minorKesToWholeKes } from "../../src/payments/money.js";
import {
  accountReferenceForOrder,
  MPESA_TRANSACTION_DESCRIPTION,
} from "../../src/payments/provider.js";
import { canTransitionPayment, isActivePaymentStatus } from "../../src/payments/state.js";
import {
  normalizeKenyanMpesaPhone,
  ProviderResultCodeSchema,
} from "../../src/payments/validation.js";

const FIXED_DATE = new Date("2026-08-31T17:05:06.000Z");

describe("M-Pesa primitives", () => {
  it("formats Daraja timestamps and generates deterministic STK passwords", () => {
    const timestamp = formatDarajaTimestamp(FIXED_DATE);
    expect(timestamp).toBe("20260831200506");
    expect(generateStkPassword("174379", "test-passkey", timestamp)).toBe(
      Buffer.from(`174379test-passkey${timestamp}`).toString("base64"),
    );
  });

  it("converts minor units to whole KES without floating point", () => {
    expect(minorKesToWholeKes(7_850_000n, "KES", 100_000n)).toBe(78_500n);
    for (const [amount, currency, maximum] of [
      [0n, "KES", 100_000n],
      [-100n, "KES", 100_000n],
      [101n, "KES", 100_000n],
      [10_000_100n, "KES", 100_000n],
      [100n, "USD", 100_000n],
    ] as const) {
      expect(() => minorKesToWholeKes(amount, currency, maximum)).toThrow(ValidationError);
    }
  });

  it("normalizes only Kenyan mobile payment phones", () => {
    expect(normalizeKenyanMpesaPhone("0712 345 678")).toBe("+254712345678");
    expect(normalizeKenyanMpesaPhone("254112345678")).toBe("+254112345678");
    expect(normalizeKenyanMpesaPhone("+12025550123")).toBeNull();
    expect(normalizeKenyanMpesaPhone("0201234567")).toBeNull();
  });

  it("centralizes active states and forbids unsafe backwards transitions", () => {
    expect(isActivePaymentStatus("UNKNOWN")).toBe(true);
    expect(isActivePaymentStatus("FAILED")).toBe(false);
    expect(canTransitionPayment("PENDING", "SUCCEEDED")).toBe(true);
    expect(canTransitionPayment("SUCCEEDED", "PENDING")).toBe(false);
    expect(canTransitionPayment("FAILED", "SUCCEEDED")).toBe(false);
  });

  it("hashes reordered provider metadata identically", () => {
    const first = {
      CallbackMetadata: {
        Item: [
          { Name: "Amount", Value: 1 },
          { Name: "Phone", Value: 2 },
        ],
      },
    };
    const second = { CallbackMetadata: { Item: [...first.CallbackMetadata.Item].reverse() } };
    expect(hashCanonical(first)).toBe(hashCanonical(second));
  });

  it("accepts only strict numeric provider result codes", () => {
    expect(ProviderResultCodeSchema.parse(0)).toBe(0);
    expect(ProviderResultCodeSchema.parse("0")).toBe(0);
    expect(ProviderResultCodeSchema.parse(1032)).toBe(1032);
    expect(ProviderResultCodeSchema.parse("-1")).toBe(-1);
    for (const value of [undefined, null, "", false, "success", Number.NaN]) {
      expect(ProviderResultCodeSchema.safeParse(value).success).toBe(false);
    }
  });

  it("derives bounded deterministic Daraja display fields from the order identity", () => {
    const normalOrderId = "11111111-2222-4333-8444-555555555555";
    const sandboxOrderId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const normalReference = accountReferenceForOrder(normalOrderId);
    const sandboxReference = accountReferenceForOrder(sandboxOrderId);

    expect(normalReference).toBe(accountReferenceForOrder(normalOrderId));
    expect(normalReference).toHaveLength(12);
    expect(sandboxReference).toHaveLength(12);
    expect(normalReference).toMatch(/^HX[0-9A-F]{10}$/);
    expect(sandboxReference).toMatch(/^HX[0-9A-F]{10}$/);
    expect(normalReference).not.toBe(sandboxReference);
    expect(MPESA_TRANSACTION_DESCRIPTION).toBe("HILOXS ORDER");
    expect(MPESA_TRANSACTION_DESCRIPTION.length).toBeLessThanOrEqual(13);
  });
});

describe("DarajaClient", () => {
  it("uses Basic OAuth, caches the token, and sends authoritative STK fields", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(acceptedResponse())
      .mockResolvedValueOnce(acceptedResponse("checkout-2"));
    const client = new DarajaClient(config(), fetchMock, () => FIXED_DATE);

    await client.initiate(initiationInput());
    await client.initiate(initiationInput());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const oauth = fetchMock.mock.calls[0];
    expect(oauth?.[0]).toContain("/oauth/v1/generate?grant_type=client_credentials");
    expect(new Headers(oauth?.[1]?.headers).get("authorization")).toMatch(/^Basic /);
    const body = fetchMock.mock.calls[1]?.[1]?.body;
    if (typeof body !== "string") throw new Error("Expected a JSON request body");
    const request = JSON.parse(body) as Record<string, unknown>;
    expect(request).toMatchObject({
      BusinessShortCode: "174379",
      TransactionType: "CustomerPayBillOnline",
      Amount: "78500",
      PartyA: "254712345678",
      PartyB: "174379",
      PhoneNumber: "254712345678",
      CallBackURL: "https://api.example.test/callback/token",
      AccountReference: "HX0123456789",
      TransactionDesc: MPESA_TRANSACTION_DESCRIPTION,
    });
    expect(request["Password"]).toEqual(expect.any(String));
  });

  it("refreshes the in-memory OAuth token after its safety-adjusted expiry", async () => {
    let now = FIXED_DATE;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "first-test-token", expires_in: 10 }))
      .mockResolvedValueOnce(acceptedResponse())
      .mockResolvedValueOnce(jsonResponse({ access_token: "second-test-token", expires_in: 10 }))
      .mockResolvedValueOnce(acceptedResponse("checkout-2"));
    const client = new DarajaClient(config(), fetchMock, () => now);

    await client.initiate(initiationInput());
    now = new Date(FIXED_DATE.getTime() + 10_000);
    await client.initiate(initiationInput());

    expect(
      fetchMock.mock.calls.filter(([url]) => requestUrl(url).includes("/oauth/")),
    ).toHaveLength(2);
  });

  it("returns accepted and queried provider results", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(acceptedResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          MerchantRequestID: "merchant-1",
          CheckoutRequestID: "checkout-1",
          ResultCode: "0",
          ResultDesc: "Processed successfully",
        }),
      );
    const client = new DarajaClient(config(), fetchMock, () => FIXED_DATE);

    await expect(client.initiate(initiationInput())).resolves.toMatchObject({
      checkoutRequestId: "checkout-1",
      responseCode: "0",
    });
    await expect(client.query("checkout-1")).resolves.toMatchObject({
      checkoutRequestId: "checkout-1",
      resultCode: 0,
    });
  });

  it("returns a non-success query result without interpreting it as success", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          MerchantRequestID: "merchant-1",
          CheckoutRequestID: "checkout-1",
          ResultCode: "9999",
          ResultDesc: "Unrecognized test result",
        }),
      );
    const client = new DarajaClient(config(), fetchMock, () => FIXED_DATE);

    await expect(client.query("checkout-1")).resolves.toMatchObject({
      checkoutRequestId: "checkout-1",
      resultCode: 9999,
    });
  });

  it.each([
    ["HTTP 5xx", new Response("{}", { status: 503 })],
    ["malformed JSON", new Response("not-json", { status: 200 })],
    [
      "incomplete response",
      jsonResponse({ CheckoutRequestID: "checkout-1", ResultDesc: "Still processing" }),
    ],
  ] as const)("keeps an ambiguous %s query unresolved", async (_label, providerResponse) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(providerResponse);
    const client = new DarajaClient(config(), fetchMock, () => FIXED_DATE);

    await expect(client.query("checkout-1")).rejects.toMatchObject({ ambiguous: true });
  });

  it.each([
    ["HTTP 4xx", new Response("{}", { status: 401 }), false],
    ["HTTP 5xx", new Response("{}", { status: 503 }), true],
    ["malformed JSON", new Response("not-json", { status: 200 }), true],
    ["malformed response", jsonResponse({ ResponseCode: "0" }), true],
    [
      "provider rejection",
      jsonResponse({
        MerchantRequestID: "merchant-1",
        CheckoutRequestID: "checkout-1",
        ResponseCode: "1",
        ResponseDescription: "Rejected",
      }),
      false,
    ],
  ] as const)("classifies %s safely", async (_label, providerResponse, ambiguous) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-oauth-token", expires_in: 3600 }))
      .mockResolvedValueOnce(providerResponse);
    const client = new DarajaClient(config(), fetchMock, () => FIXED_DATE);

    await expect(client.initiate(initiationInput())).rejects.toMatchObject({ ambiguous });
  });

  it("classifies an aborted STK request as ambiguous", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "test-oauth-token", expires_in: 3600 }))
      .mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
    const client = new DarajaClient(
      { ...config(), requestTimeoutMs: 5 },
      fetchMock,
      () => FIXED_DATE,
    );

    await expect(client.initiate(initiationInput())).rejects.toMatchObject({ ambiguous: true });
  });
});

function config(): MpesaRuntimeConfig {
  return {
    environment: "sandbox",
    baseURL: "https://sandbox.safaricom.co.ke",
    consumerKey: "test-consumer-key",
    consumerSecret: "test-consumer-secret",
    shortcode: "174379",
    passkey: "test-passkey",
    transactionType: "CustomerPayBillOnline",
    partyB: "174379",
    callbackBaseURL: "https://api.example.test",
    maxAmountKes: 100_000n,
    requestTimeoutMs: 10_000,
  };
}

function initiationInput() {
  return {
    amountKes: 78_500n,
    phoneE164: "+254712345678",
    callbackURL: "https://api.example.test/callback/token",
    accountReference: "HX0123456789",
    transactionDescription: MPESA_TRANSACTION_DESCRIPTION,
  };
}

function acceptedResponse(checkoutRequestId = "checkout-1"): Response {
  return jsonResponse({
    MerchantRequestID: "merchant-1",
    CheckoutRequestID: checkoutRequestId,
    ResponseCode: "0",
    ResponseDescription: "Success. Request accepted for processing",
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
