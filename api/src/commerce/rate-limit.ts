import { RateLimitError } from "../lib/errors.js";

type WindowState = { count: number; resetAt: number };

export class FixedWindowRateLimiter {
  readonly #windows = new Map<string, WindowState>();

  consume(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const current = this.#windows.get(key);
    if (!current || current.resetAt <= now) {
      this.#windows.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }
    if (current.count >= limit) throw new RateLimitError();
    current.count += 1;
  }
}
