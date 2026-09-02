import {
  CheckCircle2,
  Clock3,
  Loader2,
  PackageCheck,
  PackagePlus,
  Pencil,
  Save,
  Send,
  XCircle,
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
import { Textarea } from "@/components/ui/textarea";
import { formatMoneyMinor } from "@/lib/commerce-api";
import { SHOP_CATEGORIES, type ShopCategory } from "@/lib/hiloxs";
import {
  createSellerProduct,
  listSellerProducts,
  SellerProductApiError,
  submitSellerProduct,
  updateSellerProduct,
  withdrawSellerProduct,
  type SellerProductDraftInput,
  type SellerProductListState,
  type SellerProductState,
  type SellerProductSubmission,
} from "@/lib/seller-product-api";
import { minorToKesInput, parseKesPriceToMinor } from "@/lib/seller-product-money";

const PRODUCT_TERMS = [
  "The listing represents the product accurately, and I have the legal right to sell it.",
  "Counterfeit, illegal and restricted goods are prohibited.",
  "Approval is not automatic and does not publish this item in the HILOXS shop.",
  "HILOXS may request more information, and future media must be authorized or licensed.",
  "Payout functionality is separate from product-submission review.",
];

export function SellerProducts() {
  const [state, setState] = useState<SellerProductListState | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void listSellerProducts()
      .then((nextState) => {
        if (active) setState(nextState);
      })
      .catch(() => {
        if (active) setError("Product submissions could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateSubmission = (next: SellerProductState, keepEditing = false) => {
    setState((current) => {
      if (!current) return { submissions: [next.submission], termsVersion: next.termsVersion };
      const existing = current.submissions.some((item) => item.id === next.submission.id);
      return {
        termsVersion: next.termsVersion,
        submissions: existing
          ? current.submissions.map((item) =>
              item.id === next.submission.id ? next.submission : item,
            )
          : [next.submission, ...current.submissions],
      };
    });
    setEditing(keepEditing ? next.submission.id : null);
  };

  const selected =
    editing && editing !== "new"
      ? (state?.submissions.find((item) => item.id === editing) ?? null)
      : null;

  return (
    <section className="mt-10 border-t border-border pt-8" aria-labelledby="product-submissions">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <PackageCheck className="size-5" aria-hidden />
            <h2 id="product-submissions" className="text-xl font-semibold text-foreground">
              Product submissions
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Approved listings remain private review records. They are not live, orderable products.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing("new")} disabled={editing === "new"}>
          <PackagePlus aria-hidden /> New draft
        </Button>
      </div>

      {error && (
        <p className="mt-5 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading submissions...
        </p>
      ) : state ? (
        <>
          {(editing === "new" || selected) && (
            <ProductDraftForm
              key={editing}
              submission={selected}
              termsVersion={state.termsVersion}
              onChange={updateSubmission}
              onCancel={() => setEditing(null)}
            />
          )}
          {state.submissions.length === 0 && editing !== "new" ? (
            <p className="mt-6 text-sm text-muted-foreground">No product drafts yet.</p>
          ) : (
            <div className="mt-7 divide-y divide-border border-y border-border">
              {state.submissions.map((submission) => (
                <ProductSubmissionRow
                  key={submission.id}
                  submission={submission}
                  onEdit={() => setEditing(submission.id)}
                  onChange={updateSubmission}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function ProductDraftForm({
  submission,
  termsVersion,
  onChange,
  onCancel,
}: {
  submission: SellerProductSubmission | null;
  termsVersion: string;
  onChange: (state: SellerProductState, keepEditing?: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(submission?.name ?? "");
  const [category, setCategory] = useState<ShopCategory>(submission?.category ?? "Accessories");
  const [description, setDescription] = useState(submission?.description ?? "");
  const [price, setPrice] = useState(submission ? minorToKesInput(submission.priceMinor) : "");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "submit" | "">("");

  const validatedInput = (): {
    draft: SellerProductDraftInput | null;
    errors: Record<string, string>;
  } => {
    const nextErrors = validateProductForm({ name, description, price });
    let priceMinor = "";
    try {
      priceMinor = parseKesPriceToMinor(price);
    } catch (reason) {
      nextErrors["price"] = reason instanceof Error ? reason.message : "Enter a valid price.";
    }
    if (Object.keys(nextErrors).length > 0) return { draft: null, errors: nextErrors };
    return { draft: { name, category, description, priceMinor }, errors: nextErrors };
  };

  const save = async (): Promise<SellerProductState | null> => {
    const { draft, errors: nextErrors } = validatedInput();
    setErrors(nextErrors);
    if (!draft) return null;
    setBusy("save");
    setNotice("");
    try {
      const next = submission
        ? await updateSellerProduct(submission.id, draft)
        : await createSellerProduct(draft);
      onChange(next, true);
      setNotice("Draft saved.");
      return next;
    } catch (reason) {
      setNotice(productError(reason, "The product draft could not be saved."));
      return null;
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    const { draft, errors: nextErrors } = validatedInput();
    if (!termsAccepted) nextErrors["terms"] = "Accept the product terms before submitting.";
    setErrors(nextErrors);
    if (!draft || Object.keys(nextErrors).length > 0 || !submission) return;
    setBusy("submit");
    setNotice("");
    try {
      await updateSellerProduct(submission.id, draft);
      onChange(await submitSellerProduct(submission.id, termsVersion));
    } catch (reason) {
      setNotice(productError(reason, "The product could not be submitted."));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="panel mt-6 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{submission ? "Edit product draft" : "New product draft"}</h3>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={Boolean(busy)}>
          Cancel
        </Button>
      </div>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <ProductField id="product-name" label="Product name" error={errors["name"]} full>
          <Input
            id="product-name"
            value={name}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={Boolean(errors["name"])}
          />
        </ProductField>
        <ProductField id="product-category" label="Category" error={errors["category"]}>
          <Select value={category} onValueChange={(value: ShopCategory) => setCategory(value)}>
            <SelectTrigger id="product-category" aria-label="Product category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOP_CATEGORIES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ProductField>
        <ProductField
          id="product-price"
          label="Price in KSh"
          error={errors["price"]}
          description="Enter a positive amount with up to two decimal places."
        >
          <Input
            id="product-price"
            value={price}
            inputMode="decimal"
            placeholder="2899.00"
            onChange={(event) => setPrice(event.target.value)}
            aria-invalid={Boolean(errors["price"])}
          />
        </ProductField>
        <ProductField
          id="product-description"
          label="Description"
          error={errors["description"]}
          full
        >
          <Textarea
            id="product-description"
            value={description}
            maxLength={5_000}
            rows={6}
            onChange={(event) => setDescription(event.target.value)}
            aria-invalid={Boolean(errors["description"])}
          />
        </ProductField>
      </div>

      {submission && (
        <div className="mt-7 border-t border-border pt-6">
          <h4 className="font-medium">Product review acknowledgment</h4>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {PRODUCT_TERMS.map((term) => (
              <li key={term} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {term}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex items-start gap-3">
            <Checkbox
              id={`product-terms-${submission.id}`}
              checked={termsAccepted}
              onCheckedChange={(checked) => setTermsAccepted(checked === true)}
              aria-invalid={Boolean(errors["terms"])}
            />
            <Label htmlFor={`product-terms-${submission.id}`} className="leading-5">
              I have reviewed and accept these product-submission terms.
            </Label>
          </div>
          {errors["terms"] && <ProductFieldError>{errors["terms"]}</ProductFieldError>}
        </div>
      )}

      {notice && (
        <p className="mt-5 text-sm text-muted-foreground" role="status">
          {notice}
        </p>
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => void save()} disabled={Boolean(busy)}>
          {busy === "save" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Save aria-hidden />
          )}
          Save draft
        </Button>
        {submission && (
          <Button variant="hero" onClick={() => void submit()} disabled={Boolean(busy)}>
            {busy === "submit" ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Send aria-hidden />
            )}
            Submit for review
          </Button>
        )}
      </div>
    </div>
  );
}

function ProductSubmissionRow({
  submission,
  onEdit,
  onChange,
}: {
  submission: SellerProductSubmission;
  onEdit: () => void;
  onChange: (state: SellerProductState) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canWithdraw = submission.status === "DRAFT" || submission.status === "SUBMITTED";

  return (
    <article className="py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold break-words">{submission.name}</h3>
            <Badge variant={submission.status === "REJECTED" ? "destructive" : "secondary"}>
              {submission.status.replaceAll("_", " ")}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {submission.category} | {formatMoneyMinor(submission.priceMinor, submission.currency)}
          </p>
          <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm">{submission.description}</p>
          <p className="mt-3 text-sm text-muted-foreground">{productStatusMessage(submission)}</p>
          {submission.status === "REJECTED" && submission.reviewReason && (
            <p className="mt-2 text-sm text-destructive">Review note: {submission.reviewReason}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {submission.status === "DRAFT" && (
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil aria-hidden /> Edit
            </Button>
          )}
          {canWithdraw && (
            <ProductWithdrawDialog
              busy={busy}
              onConfirm={async () => {
                setBusy(true);
                setError("");
                try {
                  onChange(await withdrawSellerProduct(submission.id));
                } catch (reason) {
                  setError(productError(reason, "The product submission could not be withdrawn."));
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function ProductWithdrawDialog({
  busy,
  onConfirm,
}: {
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={busy}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <XCircle aria-hidden />}
          Withdraw
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw this product submission?</AlertDialogTitle>
          <AlertDialogDescription>
            This submission will remain in your history and cannot be reopened.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep submission</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm()}>Withdraw</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProductField({
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
      {error && <ProductFieldError>{error}</ProductFieldError>}
    </div>
  );
}

function ProductFieldError({ children }: { children: string }) {
  return <p className="mt-1.5 text-xs text-destructive">{children}</p>;
}

function validateProductForm(input: {
  name: string;
  description: string;
  price: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = input.name.trim();
  const description = input.description.trim();
  if (name.length < 3 || name.length > 160 || unsafeText(name)) {
    errors["name"] = "Enter a valid plain-text product name.";
  }
  if (description.length < 20 || description.length > 5_000 || unsafeText(description)) {
    errors["description"] = "Enter a plain-text description of at least 20 characters.";
  }
  if (!input.price.trim()) errors["price"] = "Enter the product price.";
  return errors;
}

function unsafeText(value: string): boolean {
  return /[<>\p{C}]/u.test(value) || /(?:javascript|data):/i.test(value);
}

function productStatusMessage(submission: SellerProductSubmission): string {
  switch (submission.status) {
    case "DRAFT":
      return "Draft only. It has not been submitted for review.";
    case "SUBMITTED":
      return "Submitted for review. It is not live in the shop.";
    case "UNDER_REVIEW":
      return "Under review. The listing is immutable and not live in the shop.";
    case "APPROVED":
      return "Approved for future catalog activation. This product is not live in the shop yet.";
    case "REJECTED":
      return "This submission was not approved and remains in your history.";
    case "WITHDRAWN":
      return "This submission was withdrawn and remains in your history.";
  }
}

function productError(error: unknown, fallback: string): string {
  if (error instanceof SellerProductApiError && [400, 403, 404, 409].includes(error.status)) {
    return error.message;
  }
  return fallback;
}
