import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthFormLayout, FormNotice } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resendVerification, verifyEmail } from "@/lib/auth-api";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/verify-email")({
  head: () => {
    const seo = pageSeo({
      title: "Verify Email | HILOXS",
      description: "Verify the email address for a HILOXS account.",
      path: "/verify-email",
      noindex: true,
    });
    return {
      ...seo,
      meta: [...seo.meta, { name: "referrer", content: "no-referrer" }],
    };
  },
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const [verificationToken, setVerificationToken] = useState("");
  const [tokenCaptured, setTokenCaptured] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token")?.trim() ?? "";
    setVerificationToken(token);
    setTokenCaptured(true);

    if (!window.location.hash) return;
    const sanitized = new URL(window.location.href);
    sanitized.hash = "";
    window.history.replaceState(
      window.history.state,
      "",
      `${sanitized.pathname}${sanitized.search}`,
    );
  }, []);

  if (verified) {
    return (
      <AuthFormLayout
        title="Email verified"
        description="Your email address is confirmed. You can now access your account."
        footer={
          <Link to="/" className="font-medium text-primary hover:underline">
            Return home
          </Link>
        }
      >
        <Button asChild variant="hero" className="w-full">
          <Link to="/login" search={{ verified: true }}>
            Log in
          </Link>
        </Button>
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout
      title="Verify your email"
      description="Use the verification link sent after registration, or request another message."
      footer={
        <Link to="/login" className="font-medium text-primary hover:underline">
          Return to login
        </Link>
      }
    >
      {tokenCaptured && verificationToken && !verificationFailed ? (
        <Button
          type="button"
          variant="hero"
          className="w-full"
          disabled={verifying}
          onClick={async () => {
            setVerifying(true);
            try {
              await verifyEmail(verificationToken);
              setVerificationToken("");
              setVerified(true);
            } catch {
              setVerificationToken("");
              setVerificationFailed(true);
            } finally {
              setVerifying(false);
            }
          }}
        >
          {verifying ? "Verifying..." : "Verify Email"}
        </Button>
      ) : !tokenCaptured ? (
        <Button type="button" variant="hero" className="w-full" disabled>
          Preparing verification...
        </Button>
      ) : (
        <VerificationResendForm
          email={email}
          setEmail={setEmail}
          error={error}
          setError={setError}
          notice={notice}
          setNotice={setNotice}
          submitting={submitting}
          setSubmitting={setSubmitting}
        />
      )}
    </AuthFormLayout>
  );
}

function VerificationResendForm({
  email,
  setEmail,
  error,
  setError,
  notice,
  setNotice,
  submitting,
  setSubmitting,
}: {
  email: string;
  setEmail: (value: string) => void;
  error: string;
  setError: (value: string) => void;
  notice: string;
  setNotice: (value: string) => void;
  submitting: boolean;
  setSubmitting: (value: boolean) => void;
}) {
  return (
    <>
      <FormNotice>The verification link is invalid, expired, or missing.</FormNotice>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const nextError = /^\S+@\S+\.\S+$/.test(email) ? "" : "Enter a valid email address.";
          setError(nextError);
          if (nextError) return;

          setSubmitting(true);
          try {
            await resendVerification(email);
            setNotice("If the account needs verification, a new link has been sent.");
          } catch {
            setNotice("Unable to process the request right now. Please try again shortly.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="verification-email">Email address</Label>
          <Input
            id="verification-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "verification-email-error" : undefined}
          />
          {error && (
            <p id="verification-email-error" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        {notice && <FormNotice>{notice}</FormNotice>}
        <Button type="submit" variant="hero" className="w-full" disabled={submitting}>
          {submitting ? "Sending..." : "Resend verification"}
        </Button>
      </form>
    </>
  );
}
