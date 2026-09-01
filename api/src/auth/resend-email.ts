import type { ProductionEmailConfig } from "../config/env.js";
import { EmailDeliveryError } from "../lib/errors.js";
import type { AuthEmail, AuthEmailSender } from "./email.js";
import { renderAuthEmail } from "./email-templates.js";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 10_000;

type FetchImplementation = typeof fetch;

export class ResendAuthEmailSender implements AuthEmailSender {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetch: FetchImplementation;
  readonly #timeoutMs: number;

  constructor(
    config: ProductionEmailConfig,
    options: { fetch?: FetchImplementation; timeoutMs?: number } = {},
  ) {
    this.#apiKey = config.apiKey;
    this.#from = config.from;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async send(message: AuthEmail): Promise<void> {
    const content = renderAuthEmail(message);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);

    try {
      const response = await this.#fetch(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "hiloxs-api/0.1.0",
        },
        body: JSON.stringify({
          from: this.#from,
          to: [message.recipient],
          subject: content.subject,
          text: content.text,
          html: content.html,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new EmailDeliveryError();
      }
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
