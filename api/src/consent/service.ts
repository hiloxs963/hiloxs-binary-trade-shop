import type { Database } from "../db/client.js";
import { userConsents } from "../db/schema/consent.js";
import { REGISTRATION_CONSENT_POLICIES } from "./model.js";

// Consent rows outlive sessions, so the request metadata is bounded rather than
// stored at whatever length the client sent.
const MAX_USER_AGENT_LENGTH = 512;

type ConsentRequestMetadata = {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
};

export async function recordRegistrationConsent(
  db: Database,
  userId: string,
  { ipAddress, userAgent }: ConsentRequestMetadata,
): Promise<void> {
  await db.insert(userConsents).values(
    REGISTRATION_CONSENT_POLICIES.map(({ policy, version }) => ({
      userId,
      policy,
      version,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    })),
  );
}
