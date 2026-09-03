import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Loader2,
  Save,
  Send,
  Store,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { pageSeo } from "@/lib/seo";
import { SellerProducts } from "@/components/hiloxs/SellerProducts";
import { SellerFulfillment } from "@/components/hiloxs/SellerFulfillment";
import {
  createSellerApplication,
  getSellerApplication,
  SellerApiError,
  submitSellerApplication,
  updateSellerApplication,
  withdrawSellerApplication,
  type SellerApplication,
  type SellerApplicationState,
  type SellerDraftInput,
  type SellerType,
} from "@/lib/seller-api";

export const Route = createFileRoute("/sell-with-us")({
  head: () =>
    pageSeo({
      title: "Seller Applications | HILOXS",
      description:
        "Apply to become a HILOXS marketplace seller through a reviewed, account-based process.",
      path: "/sell-with-us",
      noindex: true,
    }),
  component: SellWithUsPage,
});

const SELLER_TYPE_LABELS: Record<SellerType, string> = {
  COMPANY: "Company",
  REGISTERED_BUSINESS: "Registered business",
  SOLE_PROPRIETOR: "Sole proprietor",
};

const TERMS = [
  "The submitted details are accurate to the best of my knowledge.",
  "Approval is not automatic, and HILOXS may request additional verification later.",
  "Counterfeit, prohibited and illegal goods are not permitted.",
  "Product publishing remains unavailable until approval and a later Phase 6 release.",
  "Payout functionality is not part of this application phase.",
];

function SellWithUsPage() {
  const auth = useAuth();
  const [state, setState] = useState<SellerApplicationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (auth.isLoading || !auth.isAuthenticated) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    void getSellerApplication()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch(() => {
        if (active) setLoadError("Your seller application could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, auth.isLoading]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center gap-2 text-primary">
        <Store className="size-5" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-widest">Seller applications</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Sell With HILOXS</h1>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Seller access follows a reviewed application. Applying does not activate a seller account,
        publish products, verify identifiers automatically or enable payouts.
      </p>

      {auth.isLoading ? (
        <PageStatus>Checking your account...</PageStatus>
      ) : !auth.isAuthenticated ? (
        <AnonymousSellerIntro />
      ) : loading ? (
        <PageStatus>Loading your seller application...</PageStatus>
      ) : loadError ? (
        <div className="mt-8" role="alert">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
            Reload application
          </Button>
        </div>
      ) : state?.application ? (
        state.application.status === "DRAFT" ? (
          <SellerApplicationForm state={state} onState={setState} />
        ) : (
          <SellerApplicationStatusView state={state} onState={setState} />
        )
      ) : starting && state ? (
        <SellerApplicationForm state={state} onState={setState} />
      ) : (
        <section className="mt-8 border-t border-border pt-8" aria-labelledby="start-application">
          <h2 id="start-application" className="text-xl font-semibold">
            Start one seller application
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Your account email and phone remain your contact details. The application stores only
            the limited business identity fields needed for later review.
          </p>
          <Button variant="hero" className="mt-5" onClick={() => setStarting(true)}>
            <FileCheck2 aria-hidden /> Start seller application
          </Button>
        </section>
      )}
    </main>
  );
}

function AnonymousSellerIntro() {
  return (
    <section className="mt-8 border-t border-border pt-8" aria-labelledby="seller-account-needed">
      <h2 id="seller-account-needed" className="text-xl font-semibold">
        A verified HILOXS account is required
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Sign in before entering business information. Applications are reviewed and approval is not
        guaranteed or immediate.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button asChild variant="hero">
          <Link to="/login" search={{ returnTo: "/sell-with-us" }}>
            Log in to apply
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/register">Create an account</Link>
        </Button>
      </div>
      <div className="mt-10 grid gap-6 border-t border-border pt-8 sm:grid-cols-3">
        <ProgramPoint
          icon={Building2}
          title="Limited business details"
          body="No documents, bank details or payout numbers are collected in this phase."
        />
        <ProgramPoint
          icon={FileCheck2}
          title="Human review boundary"
          body="Structural checks do not prove KRA or registration authenticity."
        />
        <ProgramPoint
          icon={BadgeCheck}
          title="Approval before seller access"
          body="Product publishing remains unavailable until a later release."
        />
      </div>
    </section>
  );
}

function ProgramPoint({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <div>
      <Icon className="size-5 text-primary" aria-hidden />
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function SellerApplicationForm({
  state,
  onState,
}: {
  state: SellerApplicationState;
  onState: (state: SellerApplicationState) => void;
}) {
  const application = state.application;
  const [sellerType, setSellerType] = useState<SellerType>(application?.sellerType ?? "COMPANY");
  const [legalName, setLegalName] = useState(application?.legalName ?? "");
  const [tradingName, setTradingName] = useState(application?.tradingName ?? "");
  const [registrationNumber, setRegistrationNumber] = useState(
    application?.registrationNumber ?? "",
  );
  const [kraPin, setKraPin] = useState(application?.kraPin ?? "");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | "withdraw" | "">("");

  const input = (): SellerDraftInput => ({
    sellerType,
    legalName,
    ...(tradingName.trim() ? { tradingName } : {}),
    ...(sellerType !== "SOLE_PROPRIETOR" && registrationNumber.trim()
      ? { registrationNumber }
      : {}),
    ...(kraPin.trim() ? { kraPin } : {}),
  });

  const persist = async (): Promise<SellerApplicationState> => {
    const nextState = application
      ? await updateSellerApplication(input())
      : await createSellerApplication(input());
    onState(nextState);
    return nextState;
  };

  const save = async () => {
    const nextErrors = validateForm(input(), false);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy("save");
    setNotice("");
    try {
      await persist();
      setNotice("Draft saved.");
    } catch (error) {
      setNotice(sellerErrorMessage(error, "The draft could not be saved."));
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    const nextErrors = validateForm(input(), true);
    if (!termsAccepted) nextErrors["terms"] = "Accept the seller terms before submitting.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy("submit");
    setNotice("");
    try {
      await persist();
      onState(await submitSellerApplication(state.termsVersion));
    } catch (error) {
      setNotice(sellerErrorMessage(error, "The application could not be submitted."));
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="mt-8" aria-labelledby="seller-form-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="seller-form-title" className="text-xl font-semibold">
            Seller application draft
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saving a draft does not submit it for review.
          </p>
        </div>
        <Badge variant="secondary">DRAFT</Badge>
      </div>

      <div className="panel mt-5 p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="seller-type" label="Seller type" error={errors["sellerType"]} full>
            <Select
              value={sellerType}
              onValueChange={(value: SellerType) => {
                setSellerType(value);
                if (value === "SOLE_PROPRIETOR") setRegistrationNumber("");
              }}
            >
              <SelectTrigger id="seller-type" aria-label="Seller type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SELLER_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="seller-legal-name"
            label="Legal or business name"
            error={errors["legalName"]}
            full
          >
            <Input
              id="seller-legal-name"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              maxLength={160}
              autoComplete="organization"
              aria-invalid={Boolean(errors["legalName"])}
            />
          </Field>

          <Field
            id="seller-trading-name"
            label="Trading name (optional)"
            error={errors["tradingName"]}
          >
            <Input
              id="seller-trading-name"
              value={tradingName}
              onChange={(event) => setTradingName(event.target.value)}
              maxLength={160}
              autoComplete="organization"
              aria-invalid={Boolean(errors["tradingName"])}
            />
          </Field>

          {sellerType !== "SOLE_PROPRIETOR" && (
            <Field
              id="seller-registration-number"
              label="Registration number"
              error={errors["registrationNumber"]}
              description="Used to identify the registered entity during later review. This is not a live BRS verification."
            >
              <Input
                id="seller-registration-number"
                value={registrationNumber}
                onChange={(event) => setRegistrationNumber(event.target.value)}
                maxLength={80}
                autoCapitalize="characters"
                aria-invalid={Boolean(errors["registrationNumber"])}
              />
            </Field>
          )}

          <Field
            id="seller-kra-pin"
            label="KRA PIN"
            error={errors["kraPin"]}
            description="Used to identify the taxpayer during later review. Format checks do not confirm authenticity."
          >
            <Input
              id="seller-kra-pin"
              value={kraPin}
              onChange={(event) => setKraPin(event.target.value.toUpperCase())}
              maxLength={11}
              autoCapitalize="characters"
              autoComplete="off"
              aria-invalid={Boolean(errors["kraPin"])}
              placeholder={sellerType === "SOLE_PROPRIETOR" ? "A123456789Z" : "P123456789Z"}
            />
          </Field>
        </div>

        <div className="mt-7 border-t border-border pt-6">
          <h3 className="font-semibold">Review acknowledgments</h3>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {TERMS.map((term) => (
              <li key={term} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {term}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-start gap-3">
            <Checkbox
              id="seller-terms"
              checked={termsAccepted}
              onCheckedChange={(checked) => setTermsAccepted(checked === true)}
              aria-invalid={Boolean(errors["terms"])}
            />
            <Label htmlFor="seller-terms" className="leading-5">
              I have reviewed and accept these seller application terms.
            </Label>
          </div>
          {errors["terms"] && <FieldError>{errors["terms"]}</FieldError>}
        </div>

        {notice && (
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            {notice}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="outline" disabled={Boolean(busy)} onClick={() => void save()}>
            {busy === "save" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Save aria-hidden />
            )}
            Save draft
          </Button>
          <Button variant="hero" disabled={Boolean(busy)} onClick={() => void submit()}>
            {busy === "submit" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
            Review and submit
          </Button>
          {application && (
            <WithdrawDialog
              busy={busy === "withdraw"}
              onConfirm={async () => {
                setBusy("withdraw");
                setNotice("");
                try {
                  onState(await withdrawSellerApplication());
                } catch (error) {
                  setNotice(sellerErrorMessage(error, "The application could not be withdrawn."));
                } finally {
                  setBusy("");
                }
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function SellerApplicationStatusView({
  state,
  onState,
}: {
  state: SellerApplicationState;
  onState: (state: SellerApplicationState) => void;
}) {
  const application = state.application as SellerApplication;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <section className="mt-8" aria-labelledby="application-status-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="application-status-title" className="text-xl font-semibold">
            Application status
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {statusMessage(application)}
          </p>
        </div>
        <Badge variant={application.status === "REJECTED" ? "destructive" : "secondary"}>
          {application.status.replaceAll("_", " ")}
        </Badge>
      </div>

      <div className="panel mt-5 p-5 sm:p-6">
        <ApplicationDetails application={application} />
        {application.status === "REJECTED" && application.reviewReason && (
          <div className="mt-5 border-t border-border pt-5">
            <p className="text-sm font-medium">Review note</p>
            <p className="mt-1 text-sm text-muted-foreground">{application.reviewReason}</p>
          </div>
        )}
        {application.status === "APPROVED" && (
          <div className="mt-5 flex items-start gap-2 border-t border-border pt-5 text-sm">
            <BadgeCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            <p>
              Approval enables private product submissions below. It does not publish products or
              create payout access.
            </p>
          </div>
        )}
        {application.status === "SUBMITTED" && (
          <div className="mt-6 border-t border-border pt-5">
            <WithdrawDialog
              busy={busy}
              onConfirm={async () => {
                setBusy(true);
                setError("");
                try {
                  onState(await withdrawSellerApplication());
                } catch (reason) {
                  setError(sellerErrorMessage(reason, "The application could not be withdrawn."));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </div>
        )}
        {error && (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
      {application.status === "APPROVED" && (
        <>
          <SellerProducts />
          <SellerFulfillment />
        </>
      )}
    </section>
  );
}

function ApplicationDetails({ application }: { application: SellerApplication }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
      <Detail label="Seller type" value={SELLER_TYPE_LABELS[application.sellerType]} />
      <Detail label="Legal name" value={application.legalName} />
      <Detail label="Trading name" value={application.tradingName ?? "Not provided"} />
      {application.registrationNumber && (
        <Detail label="Registration number" value={application.registrationNumber} />
      )}
      <Detail label="KRA PIN" value={application.kraPin ?? "Not provided"} />
      <Detail
        label="Submitted"
        value={application.submittedAt ? formatDate(application.submittedAt) : "Not submitted"}
      />
    </dl>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium break-words">{value}</dd>
    </div>
  );
}

function Field({
  id,
  label,
  description,
  error,
  full = false,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string | undefined;
  full?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {description && <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function FieldError({ children }: { children: string }) {
  return <p className="mt-1.5 text-xs text-destructive">{children}</p>;
}

function WithdrawDialog({ busy, onConfirm }: { busy: boolean; onConfirm: () => Promise<void> }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <XCircle aria-hidden />}
          Withdraw application
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw this application?</AlertDialogTitle>
          <AlertDialogDescription>
            Withdrawal is terminal in this phase. The application will no longer be considered for
            review.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep application</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm()}>
            Withdraw application
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function validateForm(input: SellerDraftInput, forSubmission: boolean): Record<string, string> {
  const errors: Record<string, string> = {};
  const legalName = input.legalName.trim();
  if (legalName.length < 2 || legalName.length > 160 || containsUnsafeText(legalName)) {
    errors["legalName"] = "Enter a valid legal or business name.";
  }
  if (
    input.tradingName &&
    (input.tradingName.trim().length < 2 ||
      input.tradingName.trim().length > 160 ||
      containsUnsafeText(input.tradingName))
  ) {
    errors["tradingName"] = "Enter a valid trading name or leave it blank.";
  }
  if (
    input.registrationNumber &&
    (input.registrationNumber.trim().length < 2 ||
      input.registrationNumber.trim().length > 80 ||
      containsUnsafeText(input.registrationNumber))
  ) {
    errors["registrationNumber"] = "Enter a valid registration number.";
  }
  if (
    forSubmission &&
    input.sellerType !== "SOLE_PROPRIETOR" &&
    !input.registrationNumber?.trim()
  ) {
    errors["registrationNumber"] = "A registration number is required for this seller type.";
  }
  if (input.kraPin && !/^[AP][0-9]{9}[A-Z]$/.test(input.kraPin.trim().toUpperCase())) {
    errors["kraPin"] = "Enter the 11-character KRA PIN format.";
  }
  if (input.sellerType === "COMPANY" && input.kraPin?.toUpperCase().startsWith("A")) {
    errors["kraPin"] = "A company KRA PIN must start with P.";
  }
  if (input.sellerType === "SOLE_PROPRIETOR" && input.kraPin?.toUpperCase().startsWith("P")) {
    errors["kraPin"] = "A sole proprietor KRA PIN must start with A.";
  }
  if (forSubmission && !input.kraPin?.trim()) {
    errors["kraPin"] = "A KRA PIN is required before submission.";
  }
  return errors;
}

function containsUnsafeText(value: string): boolean {
  return /[<>\p{C}]/u.test(value) || /(?:javascript|data):/i.test(value);
}

function statusMessage(application: SellerApplication): string {
  switch (application.status) {
    case "SUBMITTED":
      return "Your application was submitted for review. Approval is not automatic, and no seller privileges are active.";
    case "UNDER_REVIEW":
      return "Your application is under review. HILOXS may request additional verification later.";
    case "APPROVED":
      return "Your seller application is approved. Product publishing and payouts are not enabled in this phase.";
    case "REJECTED":
      return "The application was not approved. It cannot be edited or resubmitted in this phase.";
    case "WITHDRAWN":
      return "You withdrew this application. It cannot be restarted in this phase.";
    case "DRAFT":
      return "Your application is still a draft.";
  }
}

function sellerErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof SellerApiError && error.status === 409) return error.message;
  return fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function PageStatus({ children }: { children: string }) {
  return (
    <div className="mt-10 flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Clock3 className="size-4" aria-hidden /> {children}
    </div>
  );
}
