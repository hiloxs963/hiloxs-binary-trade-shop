import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCurrentUser, loginWithEmail, logoutCurrentSession, type AuthUser } from "./auth-api";
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
      await loginWithEmail(email, password);
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
      logout,
      refresh,
    }),
    [currentUser, isLoading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
