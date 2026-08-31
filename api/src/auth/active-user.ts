import { and, eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { IncomingHttpHeaders } from "node:http";
import type { AuthService } from "./auth.js";
import type { DatabaseClient } from "../db/client.js";
import { session, user } from "../db/schema/auth.js";
import { UnauthenticatedError } from "../lib/errors.js";

export type ActiveUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  status: "ACTIVE";
};

export async function requireActiveUser(
  auth: AuthService,
  database: DatabaseClient,
  headers: IncomingHttpHeaders,
): Promise<ActiveUser> {
  const authSession = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  if (!authSession) throw new UnauthenticatedError();

  const [profile] = await database.db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      status: user.status,
    })
    .from(user)
    .where(and(eq(user.id, authSession.user.id), eq(user.status, "ACTIVE")))
    .limit(1);

  if (!profile) {
    await database.db.delete(session).where(eq(session.userId, authSession.user.id));
    throw new UnauthenticatedError();
  }

  return { ...profile, status: "ACTIVE" };
}
