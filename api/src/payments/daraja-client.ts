import { z } from "zod";
import type { MpesaRuntimeConfig } from "../config/env.js";
import {
  MpesaProviderError,
  type MpesaInitiationInput,
  type MpesaInitiationResult,
  type MpesaProvider,
  type MpesaQueryResult,
} from "./provider.js";
import { ProviderResultCodeSchema } from "./validation.js";

const OAuthSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
});

const InitiationResponseSchema = z.object({
  MerchantRequestID: z.string().min(1),
  CheckoutRequestID: z.string().min(1),
  ResponseCode: ProviderResultCodeSchema,
  ResponseDescription: z.string().default(""),
});

const QueryResponseSchema = z.object({
  MerchantRequestID: z.string().min(1).optional(),
  CheckoutRequestID: z.string().min(1),
  ResultCode: ProviderResultCodeSchema,
  ResultDesc: z.string().default(""),
});

type FetchImplementation = typeof fetch;

export class DarajaClient implements MpesaProvider {
  private token?: { value: string; usableUntil: number };

  constructor(
    private readonly config: MpesaRuntimeConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initiate(input: MpesaInitiationInput): Promise<MpesaInitiationResult> {
    const token = await this.getAccessToken();
    const timestamp = formatDarajaTimestamp(this.now());
    const response = await this.providerRequest(
      "/mpesa/stkpush/v1/processrequest",
      token,
      {
        BusinessShortCode: this.config.shortcode,
        Password: generateStkPassword(this.config.shortcode, this.config.passkey, timestamp),
        Timestamp: timestamp,
        TransactionType: this.config.transactionType,
        Amount: input.amountKes.toString(),
        PartyA: toProviderPhone(input.phoneE164),
        PartyB: this.config.partyB,
        PhoneNumber: toProviderPhone(input.phoneE164),
        CallBackURL: input.callbackURL,
        AccountReference: input.accountReference,
        TransactionDesc: input.transactionDescription,
      },
      true,
    );
    const parsed = InitiationResponseSchema.safeParse(response);
    if (!parsed.success) throw ambiguousProviderError("Malformed STK initiation response");
    if (parsed.data.ResponseCode !== 0) {
      throw new MpesaProviderError("M-Pesa rejected the payment request", {
        ambiguous: false,
        providerCode: String(parsed.data.ResponseCode),
      });
    }
    return {
      merchantRequestId: parsed.data.MerchantRequestID,
      checkoutRequestId: parsed.data.CheckoutRequestID,
      responseCode: String(parsed.data.ResponseCode),
      responseDescription: sanitizeDescription(parsed.data.ResponseDescription),
    };
  }

  async query(checkoutRequestId: string): Promise<MpesaQueryResult> {
    const token = await this.getAccessToken();
    const timestamp = formatDarajaTimestamp(this.now());
    const response = await this.providerRequest(
      "/mpesa/stkpushquery/v1/query",
      token,
      {
        BusinessShortCode: this.config.shortcode,
        Password: generateStkPassword(this.config.shortcode, this.config.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      true,
    );
    const parsed = QueryResponseSchema.safeParse(response);
    if (!parsed.success) throw ambiguousProviderError("Malformed STK query response");
    return {
      ...(parsed.data.MerchantRequestID
        ? { merchantRequestId: parsed.data.MerchantRequestID }
        : {}),
      checkoutRequestId: parsed.data.CheckoutRequestID,
      resultCode: parsed.data.ResultCode,
      resultDescription: sanitizeDescription(parsed.data.ResultDesc),
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = this.now().getTime();
    if (this.token && now < this.token.usableUntil) return this.token.value;

    const authorization = Buffer.from(
      `${this.config.consumerKey}:${this.config.consumerSecret}`,
    ).toString("base64");
    const response = await this.timedFetch(
      `${this.config.baseURL}/oauth/v1/generate?grant_type=client_credentials`,
      { method: "GET", headers: { Authorization: `Basic ${authorization}` } },
      false,
    );
    if (!response.ok) {
      throw new MpesaProviderError("M-Pesa authorization failed", {
        ambiguous: false,
        providerCode: String(response.status),
      });
    }
    const body = await safeJson(response, false);
    const parsed = OAuthSchema.safeParse(body);
    if (!parsed.success) {
      throw new MpesaProviderError("M-Pesa authorization returned an invalid response", {
        ambiguous: false,
      });
    }
    const safetyMargin = Math.min(60_000, Math.floor(parsed.data.expires_in * 100));
    this.token = {
      value: parsed.data.access_token,
      usableUntil: now + parsed.data.expires_in * 1_000 - safetyMargin,
    };
    return this.token.value;
  }

  private async providerRequest(
    path: string,
    token: string,
    body: Record<string, string>,
    potentiallySent: boolean,
  ): Promise<unknown> {
    const response = await this.timedFetch(
      `${this.config.baseURL}${path}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      potentiallySent,
    );
    if (response.status >= 500) throw ambiguousProviderError("M-Pesa service error");
    if (!response.ok) {
      throw new MpesaProviderError("M-Pesa rejected the provider request", {
        ambiguous: false,
        providerCode: String(response.status),
      });
    }
    return safeJson(response, potentiallySent);
  }

  private async timedFetch(
    url: string,
    init: RequestInit,
    potentiallySent: boolean,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await this.fetchImplementation(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new MpesaProviderError("M-Pesa request could not be completed", {
        ambiguous: potentiallySent,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function formatDarajaTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value["year"]}${value["month"]}${value["day"]}${value["hour"]}${value["minute"]}${value["second"]}`;
}

export function generateStkPassword(
  businessShortCode: string,
  passkey: string,
  timestamp: string,
): string {
  return Buffer.from(`${businessShortCode}${passkey}${timestamp}`).toString("base64");
}

function toProviderPhone(phoneE164: string): string {
  return phoneE164.replace(/^\+/, "");
}

async function safeJson(response: Response, ambiguous: boolean): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new MpesaProviderError("M-Pesa returned malformed JSON", { ambiguous, cause: error });
  }
}

function ambiguousProviderError(message: string): MpesaProviderError {
  return new MpesaProviderError(message, { ambiguous: true });
}

function sanitizeDescription(value: string): string {
  return value.replace(/[\r\n\t]/g, " ").slice(0, 500);
}
