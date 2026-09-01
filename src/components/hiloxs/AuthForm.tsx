import type { ReactNode } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthFormLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12 sm:py-16">
      <div className="flex items-center gap-2 text-primary">
        <LockKeyhole className="size-5" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-widest">
          Secure account access
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="panel mt-6 p-5 sm:p-6">{children}</div>
      <div className="mt-5 text-center text-sm text-muted-foreground">{footer}</div>
    </main>
  );
}

export function PasswordField({
  id,
  label = "Password",
  value,
  onChange,
  error,
  autoComplete,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  autoComplete: "current-password" | "new-password";
}) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="pr-11"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 size-9"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </Button>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p
      className="rounded-md border border-border bg-secondary/60 p-3 text-xs text-muted-foreground"
      role="status"
    >
      {children}
    </p>
  );
}
