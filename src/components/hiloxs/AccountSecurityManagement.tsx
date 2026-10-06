import { KeyRound, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { PasswordField } from "@/components/hiloxs/AuthForm";
import { RecoveryCodes } from "@/components/hiloxs/RecoveryCodes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AuthApiError,
  confirmAuthenticatorReplacement,
  getAccountSecurityStatus,
  regenerateBackupCodes,
  startAuthenticatorReplacement,
  type AccountSecurityStatus,
} from "@/lib/auth-api";
import { describeAccountSecurityError } from "@/lib/recovery-codes";
import { normalizeSecondFactorCode } from "@/lib/second-factor";
import { manualSetupKey } from "@/lib/totp-uri";

function describeFailure(error: unknown): string {
  return describeAccountSecurityError(
    error instanceof AuthApiError ? error : { status: 0, code: "" },
  );
}

/**
 * Backup-code count and regeneration, and authenticator replacement. Renders nothing until the API
 * reports it supports these (it answers 404 before it is deployed), so a newer frontend never shows
 * a control that cannot work.
 */
export function AccountSecurityManagement() {
  const [status, setStatus] = useState<AccountSecurityStatus | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void getAccountSecurityStatus().then((next) => {
      if (active) setStatus(next);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!status?.enrolled) return null;

  const refresh = async () => {
    const next = await getAccountSecurityStatus();
    if (next) setStatus(next);
  };

  return (
    <>
      <BackupCodesSection remaining={status.backupCodesRemaining} onChanged={refresh} />
      <ReplaceAuthenticatorSection onChanged={refresh} />
    </>
  );
}

function BackupCodesSection({
  remaining,
  onChanged,
}: {
  remaining: number;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const closeForm = () => {
    setOpen(false);
    setPassword("");
    setCode("");
    setNotice("");
  };

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 size-5 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Backup codes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {remaining === 1
              ? "You have 1 unused backup code."
              : `You have ${remaining} unused backup codes.`}{" "}
            Each works once if you lose your authenticator app.
          </p>

          {codes ? (
            <div className="mt-4 space-y-4">
              <RecoveryCodes
                codes={codes}
                heading="Your new backup codes"
                description="Your old codes no longer work. Save these now: they will not be shown again."
                onNotice={setNotice}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCodes(null);
                  setNotice("");
                }}
              >
                I have saved these codes
              </Button>
            </div>
          ) : open ? (
            <form
              className="mt-4 max-w-md space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!password || !code.trim()) return;
                setBusy(true);
                setNotice("");
                try {
                  const result = await regenerateBackupCodes(password, code.trim());
                  setCodes(result.backupCodes);
                  setPassword("");
                  setCode("");
                  setOpen(false);
                  await onChanged();
                  setNotice("New backup codes generated. We sent you a confirmation email.");
                } catch (error) {
                  setNotice(describeFailure(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm text-muted-foreground">
                Regenerating replaces all of your current codes. Confirm with your password and a
                code from your authenticator app or one unused backup code.
              </p>
              <PasswordField
                id="backup-regenerate-password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <div className="space-y-1.5">
                <Label htmlFor="backup-regenerate-code">Authenticator or backup code</Label>
                <Input
                  id="backup-regenerate-code"
                  value={code}
                  onChange={(event) =>
                    setCode(normalizeSecondFactorCode("backup-code", event.target.value))
                  }
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !password || !code.trim()}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Generate new codes
                </Button>
                <Button type="button" variant="ghost" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button type="button" variant="outline" className="mt-4" onClick={() => setOpen(true)}>
              Regenerate backup codes
            </Button>
          )}
          {notice && (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ReplaceAuthenticatorSection({ onChanged }: { onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const setupKey = totpURI ? manualSetupKey(totpURI) : null;

  const closeForm = () => {
    setOpen(false);
    setPassword("");
    setCode("");
    setNotice("");
  };

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Replace authenticator app</h2>

          {codes ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Your new authenticator app is active. Your old app and old backup codes no longer
                work, and your other signed-in devices were signed out. We sent you a confirmation
                email.
              </p>
              <RecoveryCodes
                codes={codes}
                heading="Your new backup codes"
                description="Save these now: they will not be shown again."
                onNotice={setNotice}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCodes(null);
                  setNotice("");
                }}
              >
                I have saved these codes
              </Button>
            </div>
          ) : totpURI ? (
            <form
              className="mt-4 space-y-5"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!/^\d{6}$/.test(newCode)) {
                  setNotice("Enter the six-digit code from your new authenticator app.");
                  return;
                }
                setBusy(true);
                setNotice("");
                try {
                  const result = await confirmAuthenticatorReplacement(newCode);
                  setCodes(result.backupCodes);
                  setTotpURI(null);
                  setNewCode("");
                  setOpen(false);
                  await onChanged();
                } catch (error) {
                  setNotice(describeFailure(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm text-muted-foreground">
                Your current authenticator keeps working until you confirm the new one. Scan this
                code with the new app, then enter the code it shows.
              </p>
              <div className="w-56 bg-white p-4">
                <QRCode
                  value={totpURI}
                  size={224}
                  level="M"
                  title="HILOXS new authenticator setup code"
                  className="h-auto w-full"
                />
              </div>
              {setupKey && (
                <details className="max-w-xl border-t border-border pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-primary">
                    Show manual setup key
                  </summary>
                  <code className="mt-3 block break-all rounded-md border border-border bg-secondary p-3 text-xs">
                    {setupKey}
                  </code>
                </details>
              )}
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="replace-new-code">Code from the new app</Label>
                <Input
                  id="replace-new-code"
                  value={newCode}
                  onChange={(event) =>
                    setNewCode(normalizeSecondFactorCode("totp", event.target.value))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Confirm and replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setTotpURI(null);
                    setNewCode("");
                    setNotice("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : open ? (
            <form
              className="mt-4 max-w-md space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!password || !code.trim()) return;
                setBusy(true);
                setNotice("");
                try {
                  const started = await startAuthenticatorReplacement(password, code.trim());
                  setTotpURI(started.totpURI);
                  setPassword("");
                  setCode("");
                } catch (error) {
                  setNotice(describeFailure(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-sm text-muted-foreground">
                Move to a new phone or app. Two-factor authentication stays on throughout. Confirm
                with your password and a code from your current authenticator app or one unused
                backup code.
              </p>
              <PasswordField
                id="replace-password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
              />
              <div className="space-y-1.5">
                <Label htmlFor="replace-current-code">Authenticator or backup code</Label>
                <Input
                  id="replace-current-code"
                  value={code}
                  onChange={(event) =>
                    setCode(normalizeSecondFactorCode("backup-code", event.target.value))
                  }
                  autoComplete="one-time-code"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !password || !code.trim()}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Continue
                </Button>
                <Button type="button" variant="ghost" onClick={closeForm}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Switch to a new phone or authenticator app without turning two-factor authentication
                off.
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => setOpen(true)}
              >
                Replace authenticator
              </Button>
            </>
          )}
          {notice && (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              {notice}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
