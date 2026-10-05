import { Loader2, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeEmailOtp, getEmailOtpStatus, type EmailOtpStatus } from "@/lib/auth-api";
import { normalizeSecondFactorCode } from "@/lib/second-factor";

/**
 * Opt-in emailed sign-in codes. Renders nothing while the API feature flag is off (the status
 * endpoint answers 404), so the section never appears before it can work.
 */
export function EmailOtpSettings() {
  const [status, setStatus] = useState<EmailOtpStatus | null | undefined>(undefined);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    getEmailOtpStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!status) return null;

  const action = status.enrolled ? "disable" : "enroll";

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 size-5 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Email sign-in codes</h2>
          {status.eligible || status.enrolled ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {status.enrolled
                  ? "You can choose to receive a sign-in code by email instead of using your authenticator app. Your authenticator app and backup codes keep working."
                  : "Optionally receive a sign-in code by email as an alternative to your authenticator app. Your authenticator app stays required to manage this setting."}
              </p>
              <form
                className="mt-4 max-w-xs space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!/^\d{6}$/.test(code)) {
                    setNotice("Enter the six-digit code from your authenticator app.");
                    return;
                  }
                  setBusy(true);
                  setNotice("");
                  try {
                    await changeEmailOtp(action, code);
                    setCode("");
                    setStatus(await getEmailOtpStatus());
                    setNotice(
                      action === "enroll"
                        ? "Email sign-in codes are on. We sent you a confirmation email."
                        : "Email sign-in codes are off. We sent you a confirmation email.",
                    );
                  } catch {
                    setNotice("That authenticator code could not be verified.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Label htmlFor="email-otp-totp">Authenticator code</Label>
                <Input
                  id="email-otp-totp"
                  value={code}
                  onChange={(event) =>
                    setCode(normalizeSecondFactorCode("totp", event.target.value))
                  }
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                />
                <Button
                  type="submit"
                  variant={status.enrolled ? "outline" : "default"}
                  disabled={busy}
                >
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  {status.enrolled ? "Turn off email codes" : "Turn on email codes"}
                </Button>
              </form>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Email codes are not available for this account. Sign in with your authenticator app or
              a backup code.
            </p>
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
