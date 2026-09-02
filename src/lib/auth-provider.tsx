import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getCurrentUser,
  loginWithEmail,
  logoutCurrentSession,
  verifyTwoFactorCode,
  type AuthUser,
} from "./auth-api";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setCurrentUser(await getCurrentUser());
    } catch {
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await loginWithEmail(email, password);
      if (!result.requiresTwoFactor) await refresh();
      return result;
    },
    [refresh],
  );

  const completeTwoFactor = useCallback(
    async (code: string) => {
      await verifyTwoFactorCode(code);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    setCurrentUser(null);
    try {
      await logoutCurrentSession();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      isAuthenticated: currentUser !== null,
      isLoading,
      login,
      completeTwoFactor,
      logout,
      refresh,
    }),
    [completeTwoFactor, currentUser, isLoading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
