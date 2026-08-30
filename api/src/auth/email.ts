import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ConfigurationError } from "../lib/errors.js";

export type AuthEmail = {
  kind: "verification" | "password-reset";
  recipient: string;
  url: string;
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

export function createRuntimeEmailSender(nodeEnv: string): AuthEmailSender {
  if (nodeEnv === "production") {
    throw new ConfigurationError(
      "A transactional authentication email provider must be configured before production startup",
    );
  }
  return new DevelopmentAuthEmailSender();
}
