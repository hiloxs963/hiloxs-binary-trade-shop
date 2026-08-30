import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice, PasswordField } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerWithEmail } from "@/lib/auth-api";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/register")({
  head: () =>
    pageSeo({
      title: "Create an Account | HILOXS",
      description: "Create a verified HILOXS customer account.",
      path: "/register",
      noindex: true,
    }),
  component: RegisterPage,
});

function RegisterPage() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    phone?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState(false);

  return (
    <AuthFormLayout
      title="Create an account"
      description="Register with your email and phone number, then verify your email before logging in."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const nextErrors: typeof errors = {};
          if (form.name.trim().length < 2) nextErrors.name = "Enter your full name.";
          if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = "Enter a valid email address.";
          if (!/^\+?[\d\s().-]{8,20}$/.test(form.phone))
            nextErrors.phone = "Enter a valid phone number.";
          if (
            form.password.length < 12 ||
            !/[a-z]/.test(form.password) ||
            !/[A-Z]/.test(form.password) ||
            !/[0-9]/.test(form.password) ||
            !/[^A-Za-z0-9]/.test(form.password)
          )
            nextErrors.password = "Use 12+ characters with upper, lower, number and symbol.";
          if (form.confirm !== form.password) nextErrors.confirm = "Passwords do not match.";
          setErrors(nextErrors);
          if (Object.keys(nextErrors).length > 0) return;

          setSubmitting(true);
          setNotice("");
          try {
            await registerWithEmail({
              name: form.name,
              email: form.email,
              phone: form.phone,
              password: form.password,
            });
            setRegistered(true);
            setNotice("Check your email for the verification link before logging in.");
          } catch {
            setNotice(
              "Unable to complete registration. Check your details or try again in a few minutes.",
            );
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <TextField
          id="register-name"
          label="Full name"
          value={form.name}
          onChange={(name) => setForm({ ...form, name })}
          error={errors.name}
          autoComplete="name"
        />
        <TextField
          id="register-email"
          label="Email address"
          value={form.email}
          onChange={(email) => setForm({ ...form, email })}
          error={errors.email}
          autoComplete="email"
          type="email"
        />
        <TextField
          id="register-phone"
          label="Phone number"
          value={form.phone}
          onChange={(phone) => setForm({ ...form, phone })}
          error={errors.phone}
          autoComplete="tel"
          type="tel"
        />
        <PasswordField
          id="register-password"
          value={form.password}
          onChange={(password) => setForm({ ...form, password })}
          error={errors.password}
          autoComplete="new-password"
        />
        <PasswordField
          id="register-confirm"
          label="Confirm password"
          value={form.confirm}
          onChange={(confirm) => setForm({ ...form, confirm })}
          error={errors.confirm}
          autoComplete="new-password"
        />
        {notice && <FormNotice>{notice}</FormNotice>}
        <Button type="submit" variant="hero" className="w-full" disabled={submitting || registered}>
          {submitting ? "Creating account..." : registered ? "Verification email sent" : "Continue"}
        </Button>
      </form>
    </AuthFormLayout>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  autoComplete,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  autoComplete: string;
  type?: "text" | "email" | "tel";
}) {
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
