import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;

const StrongPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(128, "Use no more than 128 characters.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.")
  .regex(/[^A-Za-z0-9]/, "Include a symbol.");

export const RegistrationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().transform(normalizeEmail),
  phone: z.string().transform((value, context) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Enter a valid phone number." });
      return z.NEVER;
    }
    return normalized;
  }),
  password: StrongPasswordSchema,
  callbackURL: z.url().optional(),
});

export const LoginSchema = z.object({
  email: z.email().transform(normalizeEmail),
  password: z.string().min(1).max(128),
  callbackURL: z.url().optional(),
  rememberMe: z.boolean().optional(),
});

export const PasswordResetRequestSchema = z.object({
  email: z.email().transform(normalizeEmail),
  redirectTo: z.url().optional(),
});

export const PasswordResetSchema = z.object({
  newPassword: StrongPasswordSchema,
  token: z.string().min(1),
});

export const VerificationRequestSchema = z.object({
  email: z.email().transform(normalizeEmail),
  callbackURL: z.url().optional(),
});

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const international = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  let normalized = international;

  if (/^0\d+$/.test(normalized)) normalized = `+254${normalized.slice(1)}`;
  else if (/^254\d+$/.test(normalized)) normalized = `+${normalized}`;

  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function validateTrustedRedirect(
  url: string | undefined,
  trustedOrigins: readonly string[],
): boolean {
  if (!url) return true;
  try {
    return trustedOrigins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}
