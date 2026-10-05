import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FormNotice } from "@/components/hiloxs/AuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthApiError, sendEmailOtp } from "@/lib/auth-api";
import { useAuth } from "@/lib/auth-context";
import {
  SECOND_FACTOR_LABELS,
  describeEmailOtpSendError,
  describeSecondFactorError,
  isValidSecondFactorCode,
  normalizeSecondFactorCode,
  secondFactorPrompt,
  secondsUntil,
  type SecondFactorMethod,
} from "@/lib/second-factor";

type SecondFactorStepProps = {
  methods: readonly SecondFactorMethod[];
  onVerified: () => Promise<void> | void;
};

/** Second step of login: choose authenticator, emailed code, or backup code, then verify. */
export function SecondFactorStep({ methods, onVerified }: SecondFactorStepProps) {
  const auth = useAuth();
  const [method, setMethod] = useState<SecondFactorMethod>("totp");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailRequested, setEmailRequested] = useState(false);
  const [resendAt, setResendAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const resendWait = secondsUntil(resendAt, now);

  useEffect(() => {
    if (!resendAt || secondsUntil(resendAt, Date.now()) === 0) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (secondsUntil(resendAt, Date.now()) === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const choose = (next: SecondFactorMethod) => {
    setMethod(next);
    setCode("");
    setNotice("");
  };

  const requestEmailCode = async () => {
    setBusy(true);
    setNotice("");
    try {
      const sent = await sendEmailOtp();
      setEmailRequested(true);
      setResendAt(sent.resendAvailableAt);
      setNow(Date.now());
      setCode("");
      setNotice("We emailed you a code. It expires in 10 minutes.");
    } catch (error) {
      // A failed send never blocks sign-in: the authenticator and backup codes stay available.
      setNotice(
        error instanceof AuthApiError
          ? describeEmailOtpSendError(error)
          : "We couldn't send the code. Use your authenticator app instead.",
      );
    } finally {
      setBusy(false);
    }
  };

  const showCodeField = method !== "email-otp" || emailRequested;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!isValidSecondFactorCode(method, code)) {
          setNotice(secondFactorPrompt(method));
          return;
        }
        setBusy(true);
        setNotice("");
        try {
          await auth.completeTwoFactor(code, method);
          setCode("");
          await onVerified();
        } catch (error) {
          setNotice(
            error instanceof AuthApiError
              ? describeSecondFactorError(method, error)
              : describeSecondFactorError(method, { status: 0, code: "" }),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div role="group" aria-label="Verification method" className="flex flex-wrap gap-2">
        {methods.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={option === method ? "default" : "outline"}
            aria-pressed={option === method}
            disabled={busy}
            onClick={() => choose(option)}
          >
            {SECOND_FACTOR_LABELS[option]}
          </Button>
        ))}
      </div>

      {method === "email-otp" && !emailRequested && (
        <p className="text-sm text-muted-foreground">
          We will email a six-digit code to the address on your account.
        </p>
      )}

      {showCodeField && (
        <div className="space-y-1.5">
          <Label htmlFor="login-second-factor">{SECOND_FACTOR_LABELS[method]}</Label>
          <Input
            id="login-second-factor"
            type="text"
            value={code}
            onChange={(event) => setCode(normalizeSecondFactorCode(method, event.target.value))}
            autoComplete={method === "backup-code" ? "off" : "one-time-code"}
            inputMode={method === "backup-code" ? "text" : "numeric"}
            maxLength={method === "backup-code" ? 128 : 6}
            spellCheck={false}
            autoFocus
          />
          {method === "backup-code" && (
            <p className="text-xs text-muted-foreground">Each backup code works only once.</p>
          )}
        </div>
      )}

      {notice && <FormNotice>{notice}</FormNotice>}

      {method === "email-otp" ? (
        <div className="space-y-2">
          {emailRequested && (
            <Button type="submit" variant="hero" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {busy ? "Verifying..." : "Verify code"}
            </Button>
          )}
          <Button
            type="button"
            variant={emailRequested ? "outline" : "hero"}
            className="w-full"
            disabled={busy || resendWait > 0}
            onClick={() => void requestEmailCode()}
          >
            {emailRequested
              ? resendWait > 0
                ? `Send a new code in ${resendWait}s`
                : "Send a new code"
              : "Email me a code"}
          </Button>
          <button
            type="button"
            className="w-full text-center text-sm text-primary hover:underline"
            onClick={() => choose("totp")}
          >
            Use my authenticator app instead
          </button>
        </div>
      ) : (
        <Button type="submit" variant="hero" className="w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? "Verifying..." : "Verify code"}
        </Button>
      )}
    </form>
  );
}
