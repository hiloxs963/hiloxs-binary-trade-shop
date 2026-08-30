import { describe, expect, it, vi } from "vitest";
import { createRuntimeEmailSender, DevelopmentAuthEmailSender } from "../../src/auth/email.js";
import { ResendAuthEmailSender } from "../../src/auth/resend-email.js";
import { parseEnv } from "../../src/config/env.js";
import { EmailDeliveryError } from "../../src/lib/errors.js";
import { safeErrorForLog } from "../../src/lib/redact.js";

const API_KEY = "re_test_key_with_safe_placeholder_characters";
const FROM = "HILOXS <auth@mail.hiloxs.co.ke>";
const VERIFICATION_URL =
  "https://api.hiloxs.co.ke/api/auth/verify-email?token=test-token&callbackURL=https%3A%2F%2Fhiloxs.co.ke%2Fverify-email%3Fverified%3Dtrue";
const RESET_URL = "https://hiloxs.co.ke/reset-password#token=test-token";

describe("authentication email delivery", () => {
  it("keeps development on the local email sink", () => {
    expect(createRuntimeEmailSender(parseEnv({ NODE_ENV: "development" }))).toBeInstanceOf(
      DevelopmentAuthEmailSender,
    );
  });

  it("constructs the production sender without calling Resend at startup", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const sender = createRuntimeEmailSender(
      parseEnv({
        NODE_ENV: "production",
        RESEND_API_KEY: API_KEY,
        AUTH_EMAIL_FROM: FROM,
      }),
    );

    expect(sender).toBeInstanceOf(ResendAuthEmailSender);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it.each([
    ["verification", VERIFICATION_URL, "Verify your HILOXS email", "Verify Email"],
    ["password-reset", RESET_URL, "Reset your HILOXS password", "Reset Password"],
  ] as const)(
    "sends the %s email with HTML and plain-text content",
    async (kind, url, subject, action) => {
      const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
      const fetchImplementation: typeof fetch = (input, init) => {
        requests.push(init ? { input, init } : { input });
        return Promise.resolve(
          new Response(JSON.stringify({ id: "safe-delivery-id" }), { status: 200 }),
        );
      };
      const sender = new ResendAuthEmailSender(
        { apiKey: API_KEY, from: FROM },
        { fetch: fetchImplementation },
      );

      await sender.send({ kind, recipient: "customer@example.com", url });

      const request = requests[0];
      if (!request) throw new Error("Expected a mocked Resend request");
      const headers = new Headers(request.init?.headers);
      const bodyText = typeof request.init?.body === "string" ? request.init.body : "";
      const body = JSON.parse(bodyText) as Record<string, unknown>;
      expect(request.input).toBe("https://api.resend.com/emails");
      expect(headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
      expect(headers.get("user-agent")).toBe("hiloxs-api/0.1.0");
      expect(body).toMatchObject({
        from: FROM,
        to: ["customer@example.com"],
        subject,
      });
      expect(body["text"]).toContain(`${action}: ${url}`);
      expect(body["html"]).toContain(action);
      expect(body["html"]).not.toContain("<img");
      expect(bodyText).not.toContain(API_KEY);
    },
  );

  it("returns a safe error without reading a rejected provider response", async () => {
    const fetchImplementation: typeof fetch = () =>
      Promise.resolve(new Response("provider-body-with-sensitive-detail", { status: 422 }));
    const sender = new ResendAuthEmailSender(
      { apiKey: API_KEY, from: FROM },
      { fetch: fetchImplementation },
    );

    let failure: unknown;
    try {
      await sender.send({
        kind: "verification",
        recipient: "customer@example.com",
        url: VERIFICATION_URL,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(EmailDeliveryError);
    expect(JSON.stringify(safeErrorForLog(failure))).not.toContain("provider-body");
    expect(JSON.stringify(safeErrorForLog(failure))).not.toContain(API_KEY);
    expect(JSON.stringify(safeErrorForLog(failure))).not.toContain("test-token");
  });

  it("aborts a provider request after the bounded timeout", async () => {
    const fetchImplementation: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), {
          once: true,
        });
      });
    const sender = new ResendAuthEmailSender(
      { apiKey: API_KEY, from: FROM },
      { fetch: fetchImplementation, timeoutMs: 5 },
    );

    await expect(
      sender.send({
        kind: "password-reset",
        recipient: "customer@example.com",
        url: RESET_URL,
      }),
    ).rejects.toBeInstanceOf(EmailDeliveryError);
  });
});
