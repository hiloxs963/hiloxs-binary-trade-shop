import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resendVerification } from "@/lib/auth-api";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>) => ({
    verified: search["verified"] === "true",
    error: typeof search["error"] === "string" ? search["error"] : "",
  }),
  head: () =>
    pageSeo({
      title: "Verify Email | HILOXS",
      description: "Verify the email address for a HILOXS account.",
      path: "/verify-email",
      noindex: true,
    }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const search = Route.useSearch();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (search.verified) {
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
        {search.error && <FormNotice>The verification link is invalid or has expired.</FormNotice>}
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
    </AuthFormLayout>
  );
}
