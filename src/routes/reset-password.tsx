import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice, PasswordField } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/auth-api";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
    error: typeof search["error"] === "string" ? search["error"] : "",
  }),
  head: () =>
    pageSeo({
      title: "Choose New Password | HILOXS",
      description: "Choose a new password for a HILOXS account.",
      path: "/reset-password",
      noindex: true,
    }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const search = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  return (
    <AuthFormLayout
      title="Choose a new password"
      description="Use a strong password that you do not use on another service."
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
          const nextErrors: typeof errors = {};
          if (
            password.length < 12 ||
            !/[a-z]/.test(password) ||
            !/[A-Z]/.test(password) ||
            !/[0-9]/.test(password) ||
            !/[^A-Za-z0-9]/.test(password)
          )
            nextErrors.password = "Use 12+ characters with upper, lower, number and symbol.";
          if (confirm !== password) nextErrors.confirm = "Passwords do not match.";
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length > 0 || !search.token) return;

          setSubmitting(true);
          try {
            await resetPassword(search.token, password);
            setComplete(true);
            setNotice("Your password has been reset. Existing sessions were signed out.");
          } catch {
            setNotice("The reset link is invalid or has expired. Request a new one.");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {(!search.token || search.error) && (
          <FormNotice>The reset link is invalid or has expired.</FormNotice>
        )}
        <PasswordField
          id="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm-new-password"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
          autoComplete="new-password"
        />
        {notice && <FormNotice>{notice}</FormNotice>}
        <Button
          type="submit"
          variant="hero"
          className="w-full"
          disabled={submitting || complete || !search.token}
        >
          {submitting ? "Resetting..." : complete ? "Password reset" : "Reset password"}
        </Button>
      </form>
    </AuthFormLayout>
  );
}
