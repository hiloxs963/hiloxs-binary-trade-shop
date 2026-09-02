export type AuthUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  mfaEnabled: boolean;
};

type ApiErrorBody = {
  code?: string;
  message?: string;
  error?: { code?: string; message?: string };
};

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "AUTH_REQUEST_FAILED") {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const response = await request("/api/v1/users/me", { method: "GET" });
  if (response.status === 401) return null;
  if (!response.ok) throw await toAuthError(response, "Unable to check your account");
  const body = (await response.json()) as { user: AuthUser };
  return body.user;
}

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<{ requiresTwoFactor: boolean }> {
  const response = await request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to log in");
  const body = (await response.json()) as { twoFactorRedirect?: boolean };
  return { requiresTwoFactor: body.twoFactorRedirect === true };
}

export async function verifyTwoFactorCode(code: string): Promise<void> {
  const response = await request("/api/auth/two-factor/verify-totp", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to verify the authentication code");
}

export async function enableTwoFactor(password: string): Promise<{
  totpURI: string;
  backupCodes: string[];
}> {
  const response = await request("/api/auth/two-factor/enable", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to begin two-factor enrollment");
  return (await response.json()) as { totpURI: string; backupCodes: string[] };
}

export async function registerWithEmail(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<void> {
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      callbackURL: `${window.location.origin}/verify-email`,
    }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to create the account");
}

export async function logoutCurrentSession(): Promise<void> {
  const response = await request("/api/auth/sign-out", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to log out");
}

export async function requestPasswordReset(email: string): Promise<void> {
  const response = await request("/api/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to request a password reset");
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const response = await request("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to reset the password");
}

export async function verifyEmail(token: string): Promise<void> {
  const response = await request("/api/v1/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to verify the email address");
}

export async function resendVerification(email: string): Promise<void> {
  const response = await request("/api/auth/send-verification-email", {
    method: "POST",
    body: JSON.stringify({
      email,
      callbackURL: `${window.location.origin}/verify-email`,
    }),
  });
  if (!response.ok) throw await toAuthError(response, "Unable to send a verification email");
}

function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...init.headers,
    },
  });
}

async function toAuthError(response: Response, fallback: string): Promise<AuthApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // A malformed upstream response must not expose transport details to the UI.
  }
  const detail = body.error ?? body;
  return new AuthApiError(detail.message || fallback, response.status, detail.code);
}
