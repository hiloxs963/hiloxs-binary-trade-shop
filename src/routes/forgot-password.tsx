import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/forgot-password")({
  head: () =>
    pageSeo({
      title: "Reset Password | HILOXS",
      description: "Future password reset access for HILOXS accounts.",
      path: "/forgot-password",
      noindex: true,
    }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(false);
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
        onSubmit={(event) => {
          event.preventDefault();
          const nextError = /^\S+@\S+\.\S+$/.test(email) ? "" : "Enter a valid email address.";
          setError(nextError);
          setNotice(!nextError);
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
        {notice && (
          <FormNotice>
            Password reset is not connected yet. No message was sent and the email was not stored.
          </FormNotice>
        )}
        <Button type="submit" variant="hero" className="w-full">
          Continue
        </Button>
      </form>
    </AuthFormLayout>
  );
}
