import { and, eq } from "drizzle-orm";
import type { IncomingHttpHeaders } from "node:http";
import { requireActiveUser } from "../auth/active-user.js";
import type { AuthService } from "../auth/auth.js";
import type { DatabaseClient } from "../db/client.js";
import { sellerApplications } from "../db/schema/sellers.js";
import { SellerNotApprovedError } from "../lib/errors.js";

export type ApprovedSeller = {
  userId: string;
  sellerApplicationId: string;
};

export async function requireApprovedSeller(
  auth: AuthService,
  database: DatabaseClient,
  headers: IncomingHttpHeaders,
): Promise<ApprovedSeller> {
  const owner = await requireActiveUser(auth, database, headers);
  const [application] = await database.db
    .select({ id: sellerApplications.id })
    .from(sellerApplications)
    .where(and(eq(sellerApplications.userId, owner.id), eq(sellerApplications.status, "APPROVED")))
    .limit(1);
  if (!application) throw new SellerNotApprovedError();
  return { userId: owner.id, sellerApplicationId: application.id };
}
