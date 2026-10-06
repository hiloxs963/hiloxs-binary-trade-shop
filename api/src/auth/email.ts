import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AppEnv } from "../config/env.js";
import { resolveProductionEmailConfig } from "../config/env.js";
import { ResendAuthEmailSender } from "./resend-email.js";

export type AuthEmail =
  | { kind: "verification" | "password-reset"; recipient: string; url: string }
  // The code is only ever delivered in the message body; there is no link. `url?: undefined`
  // keeps `message.url` readable on the union for the link-oriented callers and tests.
  | {
      kind: "email-otp";
      recipient: string;
      code: string;
      expiresInMinutes: number;
      url?: undefined;
    }
  | {
      kind:
        | "email-otp-enabled"
        | "email-otp-disabled"
        | "password-reset-notice"
        | "authenticator-replaced"
        | "backup-codes-regenerated";
      recipient: string;
      url?: undefined;
    };

export interface AuthEmailSender {
  send(message: AuthEmail): Promise<void>;
}

export class InMemoryAuthEmailSender implements AuthEmailSender {
  readonly messages: AuthEmail[] = [];

  send(message: AuthEmail): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }
}

export class DevelopmentAuthEmailSender implements AuthEmailSender {
  readonly #directory: string;

  constructor(directory = resolve(".dev-emails")) {
    this.#directory = directory;
  }

  async send(message: AuthEmail): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const filename = `${message.kind}-${Date.now()}.json`;
    await writeFile(resolve(this.#directory, filename), `${JSON.stringify(message, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

export function createRuntimeEmailSender(env: AppEnv): AuthEmailSender {
  const productionConfig = resolveProductionEmailConfig(env);
  if (productionConfig) return new ResendAuthEmailSender(productionConfig);
  return new DevelopmentAuthEmailSender();
}
