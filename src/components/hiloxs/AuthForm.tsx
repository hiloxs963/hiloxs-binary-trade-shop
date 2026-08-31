import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";

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
