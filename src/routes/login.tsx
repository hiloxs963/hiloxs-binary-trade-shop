import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AuthFormLayout, FormNotice, PasswordField } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/login")({
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [notice, setNotice] = useState(false);

  return (
    <AuthFormLayout
      title="Log in"
      description="Account access is being prepared for secure server-backed sessions."
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
        onSubmit={(event) => {
          event.preventDefault();
          const nextErrors: typeof errors = {};
          if (!/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = "Enter a valid email address.";
          if (!password) nextErrors.password = "Enter your password.";
          setErrors(nextErrors);
          setNotice(Object.keys(nextErrors).length === 0);
        }}
      >
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
        {notice && (
          <FormNotice>Login is not connected yet. No credentials were sent or stored.</FormNotice>
        )}
        <Button type="submit" variant="hero" className="w-full">
          Continue
        </Button>
      </form>
    </AuthFormLayout>
  );
}
