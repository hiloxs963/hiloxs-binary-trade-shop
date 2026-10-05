import type { Database } from "../../db/client.js";
import { authSecurityEvents, type AuthSecurityEventType } from "../../db/schema/email-otp.js";

type EventExecutor = Pick<Database, "insert">;

export type AuthSecurityEventInput = {
  userId: string | null;
  eventType: AuthSecurityEventType;
  challengeId?: string | undefined;
  ipDigest?: string | null | undefined;
  userAgent?: string | null | undefined;
};

/** Append-only. Callers must never pass a code, token, or raw IP address. */
export async function recordAuthSecurityEvent(
  executor: EventExecutor,
  input: AuthSecurityEventInput,
): Promise<void> {
  await executor.insert(authSecurityEvents).values({
    userId: input.userId,
    eventType: input.eventType,
    challengeId: input.challengeId ?? null,
    ipDigest: input.ipDigest ?? null,
    userAgent: input.userAgent ? input.userAgent.slice(0, 200) : null,
  });
}
