import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice, PasswordField } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthApiError } from "@/lib/auth-api";
import { useAuth } from "@/lib/auth-context";
import { parseAuthReturnPath, type AuthReturnPath } from "@/lib/auth-return";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => {
    const result: {
      returnTo?: AuthReturnPath;
      verified?: boolean;
    } = {};
    const returnTo = parseAuthReturnPath(search["returnTo"]);
    if (returnTo) result.returnTo = returnTo;
    if (search["verified"] === true || search["verified"] === "true") result.verified = true;
    return result;
  },
  head: () =>
    pageSeo({
      title: "Log In | HILOXS",
      description: "Account access for HILOXS customers.",
      path: "/login",
      noindex: true,
    }),
  component: LoginPage,
});

function LoginPage() {
  const auth = useAuth();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [notice, setNotice] = useState(
    search.verified ? "Email verified. You can now log in." : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [awaitingTwoFactor, setAwaitingTwoFactor] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  return (
    <AuthFormLayout
      title="Log in"
      description="Access your HILOXS account with a verified email address."
      footer={
        <>
          New to HILOXS?{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (awaitingTwoFactor) {
            if (!/^\d{6}$/.test(twoFactorCode)) {
              setNotice("Enter the six-digit code from your authenticator app.");
              return;
            }
            setSubmitting(true);
            setNotice("");
            try {
              await auth.completeTwoFactor(twoFactorCode);
              setTwoFactorCode("");
              await navigate({ to: search.returnTo ?? "/" });
            } catch {
              setNotice("The authentication code could not be verified.");
            } finally {
              setSubmitting(false);
            }
            return;
          }

          const nextErrors: typeof errors = {};
          if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = "Enter a valid email address.";
          if (!password) nextErrors.password = "Enter your password.";
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length > 0) return;

          setSubmitting(true);
          setNotice("");
          try {
            const result = await auth.login(email, password);
            if (result.requiresTwoFactor) {
              setPassword("");
              setAwaitingTwoFactor(true);
            } else {
              await navigate({ to: search.returnTo ?? "/" });
            }
          } catch (error) {
            setNotice(
              error instanceof AuthApiError && error.status === 403
                ? "Verify your email before logging in."
                : "The email or password could not be verified.",
            );
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {awaitingTwoFactor ? (
          <div className="space-y-1.5">
            <Label htmlFor="login-totp">Authenticator code</Label>
            <Input
              id="login-totp"
              type="text"
              value={twoFactorCode}
              onChange={(event) =>
                setTwoFactorCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              autoFocus
            />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="login-email">Email address</Label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                inputMode="email"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "login-email-error" : undefined}
              />
              {errors.email && (
                <p id="login-email-error" className="text-xs text-destructive">
                  {errors.email}
                </p>
              )}
            </div>
            <PasswordField
              id="login-password"
              value={password}
              onChange={setPassword}
              error={errors.password}
              autoComplete="current-password"
            />
            <div className="text-right">
              <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
          </>
        )}
        {notice && <FormNotice>{notice}</FormNotice>}
        <Button type="submit" variant="hero" className="w-full" disabled={submitting}>
          {submitting ? "Verifying..." : awaitingTwoFactor ? "Verify code" : "Continue"}
        </Button>
      </form>
    </AuthFormLayout>
  );
}
