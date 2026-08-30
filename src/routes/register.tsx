import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice, PasswordField } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/register")({
  head: () =>
    pageSeo({
      title: "Create an Account | HILOXS",
      description: "Future account registration for HILOXS customers.",
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
    password?: string;
    confirm?: string;
  }>({});
  const [notice, setNotice] = useState(false);

  return (
    <AuthFormLayout
      title="Create an account"
      description="Registration will connect to verified email and secure server sessions in the backend phase."
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
        onSubmit={(event) => {
          event.preventDefault();
          const nextErrors: typeof errors = {};
          if (form.name.trim().length < 2) nextErrors.name = "Enter your full name.";
          if (!/^\S+@\S+\.\S+$/.test(form.email)) nextErrors.email = "Enter a valid email address.";
          if (form.password.length < 10) nextErrors.password = "Use at least 10 characters.";
          if (form.confirm !== form.password) nextErrors.confirm = "Passwords do not match.";
          setErrors(nextErrors);
          setNotice(Object.keys(nextErrors).length === 0);
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
          label="Phone number (optional for now)"
          value={form.phone}
          onChange={(phone) => setForm({ ...form, phone })}
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
        {notice && (
          <FormNotice>
            Registration is not connected yet. No account was created and no details were sent or
            stored.
          </FormNotice>
        )}
        <Button type="submit" variant="hero" className="w-full">
          Continue
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
