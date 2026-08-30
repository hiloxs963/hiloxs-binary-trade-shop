import { createContext, useContext } from "react";

export type AuthUser = {
  id: string;
  displayName: string;
  email: string;
};

export type AuthState = {
  currentUser: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  connectionStatus: "not-connected" | "connected";
};

export const DISCONNECTED_AUTH_STATE: AuthState = {
  currentUser: null,
  isAuthenticated: false,
  isLoading: false,
  connectionStatus: "not-connected",
};

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}
