import { createFileRoute } from "@tanstack/react-router";
import { Check, CheckCircle2, Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import QRCode from "react-qr-code";
import { AuthRequired } from "@/components/hiloxs/AuthRequired";
import { PasswordField } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { enableTwoFactor, verifyTwoFactorCode } from "@/lib/auth-api";
import { useAuth } from "@/lib/auth-context";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/account/security")({
  head: () =>
    pageSeo({
      title: "Account Security | HILOXS",
      description: "Manage two-factor authentication for your HILOXS account.",
      path: "/account/security",
      noindex: true,
    }),
  component: AccountSecurityPage,
});

function AccountSecurityPage() {
  const auth = useAuth();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<{
    totpURI: string;
    backupCodes: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<"manual-key" | "recovery-codes" | null>(null);
  const setupKey = enrollment ? manualSetupKey(enrollment.totpURI) : null;

  const copyLocally = async (
    value: string,
    target: "manual-key" | "recovery-codes",
  ): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      setNotice(target === "manual-key" ? "Setup key copied." : "Recovery codes copied.");
    } catch {
      setNotice("Copy was unavailable. Select the text and copy it manually.");
    }
  };

  if (auth.isLoading) return <SecurityStatus text="Checking account security..." />;
  if (!auth.isAuthenticated) {
    return (
      <AuthRequired
        title="Log in to manage account security"
        description="Two-factor settings are available only for your authenticated account."
        returnTo="/my-orders"
      />
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-8 text-primary" aria-hidden />
        <div>
          <h1 className="text-3xl font-bold">Account Security</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Protect sign-in with a time-based code from your authenticator app.
          </p>
        </div>
      </div>

      <div className="panel mt-8 p-6">
        {auth.currentUser?.mfaEnabled ? (
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 text-primary" aria-hidden />
            <div>
              <h2 className="font-semibold">Two-factor authentication is enabled</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your authenticator code is required when you sign in.
              </p>
            </div>
          </div>
        ) : enrollment ? (
          <div className="space-y-5">
            <div>
              <h2 className="font-semibold">Add HILOXS to your authenticator</h2>
              <p className="mt-1 text-sm font-medium">
                Scan this code with your authenticator app.
              </p>
              <div className="mt-4 w-56 bg-white p-4">
                <QRCode
                  value={enrollment.totpURI}
                  size={224}
                  level="M"
                  title="HILOXS authenticator setup code"
                  className="h-auto w-full"
                />
              </div>
              {setupKey && (
                <details className="mt-4 max-w-xl border-t border-border pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    Show manual setup key
                  </summary>
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Enter this key manually and choose a time-based authenticator code.
                    </p>
                    <div className="flex items-start gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-secondary p-3 text-xs">
                        {setupKey}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void copyLocally(setupKey, "manual-key");
                        }}
                      >
                        {copied === "manual-key" ? <Check aria-hidden /> : <Copy aria-hidden />}
                        {copied === "manual-key" ? "Copied" : "Copy key"}
                      </Button>
                    </div>
                  </div>
                </details>
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">One-time recovery codes</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void copyLocally(enrollment.backupCodes.join("\n"), "recovery-codes")
                  }
                >
                  {copied === "recovery-codes" ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied === "recovery-codes" ? "Copied" : "Copy codes"}
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Each code works once. Store them offline in a secure place now. They will not be
                shown again after you leave this enrollment flow.
              </p>
              <ul className="mt-3 grid gap-2 rounded-md border border-border p-4 font-mono text-sm sm:grid-cols-2">
                {enrollment.backupCodes.map((backupCode) => (
                  <li key={backupCode}>{backupCode}</li>
                ))}
              </ul>
            </div>
            <form
              className="max-w-xs space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!/^\d{6}$/.test(code)) {
                  setNotice("Enter the six-digit code from your authenticator app.");
                  return;
                }
                setBusy(true);
                setNotice("");
                try {
                  await verifyTwoFactorCode(code);
                  await auth.refresh();
                  setCode("");
                  setEnrollment(null);
                  setCopied(null);
                  setNotice("Two-factor authentication is now enabled.");
                } catch {
                  setNotice("The authenticator code could not be verified.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Label htmlFor="security-totp">Authenticator code</Label>
              <Input
                id="security-totp"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
              />
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                Verify and enable
              </Button>
            </form>
          </div>
        ) : (
          <form
            className="max-w-md space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!password) return;
              setBusy(true);
              setNotice("");
              try {
                setEnrollment(await enableTwoFactor(password));
                setPassword("");
                setCopied(null);
              } catch {
                setNotice("Two-factor enrollment could not be started.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 size-5 text-primary" aria-hidden />
              <div>
                <h2 className="font-semibold">Enable two-factor authentication</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Confirm your password to create an authenticator enrollment.
                </p>
              </div>
            </div>
            <PasswordField
              id="security-password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
            <Button type="submit" disabled={busy || !password}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              Begin setup
            </Button>
          </form>
        )}
        {notice && (
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}

function manualSetupKey(totpURI: string): string | null {
  try {
    const url = new URL(totpURI);
    if (url.protocol !== "otpauth:" || url.hostname !== "totp") return null;
    const secret = url.searchParams.get("secret")?.trim();
    return secret && /^[A-Z2-7]+=*$/i.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

function SecurityStatus({ text }: { text: string }) {
  return (
    <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-16 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {text}
    </div>
  );
}
