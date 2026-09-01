import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/auth-api";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/forgot-password")({
  head: () =>
    pageSeo({
      title: "Reset Password | HILOXS",
      description: "Password reset access for HILOXS accounts.",
      path: "/forgot-password",
      noindex: true,
    }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  return (
    <AuthFormLayout
      title="Reset your password"
      description="Enter the email address that will be linked to your HILOXS account."
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
            await requestPasswordReset(email);
            setNotice("If an account matches that email, a password reset link has been sent.");
          } catch {
            setNotice("Unable to process the request right now. Please try again shortly.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="reset-email">Email address</Label>
          <Input
            id="reset-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "reset-email-error" : undefined}
          />
          {error && (
            <p id="reset-email-error" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        {notice && <FormNotice>{notice}</FormNotice>}
        <Button type="submit" variant="hero" className="w-full" disabled={submitting}>
          {submitting ? "Sending request..." : "Continue"}
        </Button>
      </form>
    </AuthFormLayout>
  );
}
