import type { ReactNode } from "react";
import { AuthContext, DISCONNECTED_AUTH_STATE } from "./auth-context";

/** Frontend-only seam for the future server-backed session provider. */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={DISCONNECTED_AUTH_STATE}>{children}</AuthContext.Provider>;
}
