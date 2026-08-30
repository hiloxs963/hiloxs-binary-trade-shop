import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BadgeCheck,
  Building2,
  FileCheck2,
  ShieldCheck,
  Store,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SHOP_CATEGORIES } from "@/lib/hiloxs";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/sell-with-us")({
  head: () =>
    pageSeo({
      title: "Seller Application Requirements | HILOXS",
      description:
        "Review the business, contact, tax, payout and document information planned for future HILOXS seller applications.",
      path: "/sell-with-us",
    }),
  component: SellWithUsPage,
});

type SellerStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "VERIFIED" | "REJECTED" | "SUSPENDED";

const SELLER_TYPES = ["Company", "Registered Business", "Sole Proprietor"] as const;
const STATUSES: SellerStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
];

const STEPS = [
  {
    icon: Building2,
    title: "Business identity",
    body: "Legal name, registration and tax details.",
  },
  {
    icon: UserRoundCheck,
    title: "Contact checks",
    body: "Verified business email and phone ownership.",
  },
  {
    icon: FileCheck2,
    title: "Document review",
    body: "Secure review after backend upload is available.",
  },
  {
    icon: BadgeCheck,
    title: "Approval decision",
    body: "Seller access only after verification is complete.",
  },
];

function SellWithUsPage() {
  const [draftReviewed, setDraftReviewed] = useState(false);
  const currentStatus: SellerStatus = "DRAFT";

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Store className="size-5" aria-hidden />
            <span className="text-xs font-semibold uppercase tracking-widest">
              Seller onboarding preview
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Sell With HILOXS</h1>
        </div>
        <Badge variant="secondary">Status: {currentStatus.replace("_", " ")}</Badge>
      </div>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Verification will be completed before seller approval. This frontend does not currently
        submit applications, upload documents or perform automatic checks against BRS or KRA.
      </p>

      <section className="mt-8" aria-labelledby="onboarding-steps">
        <h2 id="onboarding-steps" className="sr-only">
          Planned onboarding steps
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.title} className="panel p-5">
              <step.icon className="size-6 text-primary" aria-hidden />
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8" aria-labelledby="application-statuses">
        <h2 id="application-statuses" className="text-lg font-semibold">
          Application status
        </h2>
        <ol className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STATUSES.map((status) => (
            <li
              key={status}
              className={`rounded-md border px-3 py-2 text-center text-xs font-semibold ${
                status === currentStatus
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"
              }`}
              aria-current={status === currentStatus ? "step" : undefined}
            >
              {status.replace("_", " ")}
            </li>
          ))}
        </ol>
      </section>

      <form
        className="mt-10 space-y-10"
        onSubmit={(event) => {
          event.preventDefault();
          setDraftReviewed(true);
          toast.info("Draft checked locally. Nothing was submitted or stored.");
        }}
      >
        <FormSection
          title="Business identity"
          description="Basic legal and registration details for the future seller record."
        >
          <Field label="Seller type" id="seller-type">
            <select
              id="seller-type"
              required
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select seller type</option>
              {SELLER_TYPES.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          <Field label="Registered business name" id="business-name">
            <Input id="business-name" required autoComplete="organization" />
          </Field>
          <Field label="Trading name (if different)" id="trading-name">
            <Input id="trading-name" autoComplete="organization" />
          </Field>
          <Field label="Business registration number" id="registration-number">
            <Input id="registration-number" required />
          </Field>
          <Field label="KRA PIN" id="kra-pin">
            <Input id="kra-pin" required autoCapitalize="characters" />
          </Field>
          <Field label="Business location" id="business-location">
            <Input id="business-location" required autoComplete="street-address" />
          </Field>
        </FormSection>

        <FormSection
          title="Contact person"
          description="The person authorized to manage the future seller account."
        >
          <Field label="Full name" id="contact-name">
            <Input id="contact-name" required autoComplete="name" />
          </Field>
          <Field label="Role in the business" id="contact-role">
            <Input id="contact-role" required />
          </Field>
          <Field label="Business email" id="contact-email" status="Not verified">
            <Input id="contact-email" type="email" required autoComplete="email" />
          </Field>
          <Field label="Business phone" id="contact-phone" status="Not verified">
            <Input id="contact-phone" type="tel" required autoComplete="tel" />
          </Field>
        </FormSection>

        <FormSection
          title="Payout details"
          description="Payout ownership will need secure verification before seller approval."
        >
          <Field label="Preferred payout method" id="payout-method">
            <select
              id="payout-method"
              required
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select payout method</option>
              <option>M-Pesa</option>
              <option>Bank account</option>
              <option>PayPal</option>
            </select>
          </Field>
          <Field label="Account holder name" id="payout-name">
            <Input id="payout-name" required autoComplete="name" />
          </Field>
          <Field label="Payout account or phone" id="payout-destination">
            <Input id="payout-destination" required aria-describedby="payout-note" />
          </Field>
          <p id="payout-note" className="self-end text-xs text-muted-foreground sm:pb-2">
            This value remains in the form only and is not saved or sent.
          </p>
        </FormSection>

        <FormSection
          title="Catalog plans"
          description="Tell the review team what you intend to list."
        >
          <Field label="Primary product category" id="product-category">
            <select
              id="product-category"
              required
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a category</option>
              {SHOP_CATEGORIES.map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </Field>
          <Field label="Brands or product types" id="product-types">
            <Input id="product-types" required />
          </Field>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="catalog-notes">Catalog notes</Label>
            <Textarea
              id="catalog-notes"
              rows={4}
              placeholder="Products, condition, warranties and sourcing details"
            />
          </div>
        </FormSection>

        <FormSection
          title="Document placeholders"
          description="Secure document upload will be implemented with the production backend."
        >
          <DocumentField id="registration-document" label="Business registration document" />
          <DocumentField id="kra-document" label="KRA PIN certificate" />
          <DocumentField
            id="identity-document"
            label="Authorized representative identity document"
          />
          <DocumentField id="address-document" label="Business address evidence" />
        </FormSection>

        <section className="panel p-5 sm:p-6" aria-labelledby="seller-agreement">
          <div className="flex items-start gap-3">
            <input
              id="seller-agreement-checkbox"
              type="checkbox"
              required
              className="mt-1 size-4 accent-[var(--color-primary)]"
            />
            <div>
              <Label id="seller-agreement" htmlFor="seller-agreement-checkbox">
                Seller agreement consent
              </Label>
              <p className="mt-1 text-sm text-muted-foreground">
                I confirm that the application information will be accurate and that approval will
                depend on document, identity and business review under the final seller agreement.
              </p>
            </div>
          </div>
          {draftReviewed && (
            <p
              role="status"
              className="mt-4 rounded-md border border-border bg-secondary/60 p-3 text-sm text-muted-foreground"
            >
              Draft validation completed in this browser. No application, payout details or
              documents were submitted or stored.
            </p>
          )}
          <Button type="submit" variant="hero" className="mt-5 w-full sm:w-auto">
            <ShieldCheck aria-hidden /> Review draft
          </Button>
        </section>
      </form>
    </div>
  );
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const id = title.toLowerCase().replaceAll(" ", "-");
  return (
    <section className="panel p-5 sm:p-6" aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  id,
  status,
  children,
}: {
  label: string;
  id: string;
  status?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {status && (
          <Badge variant="outline" className="text-[10px]">
            {status}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}

function DocumentField({ id, label }: { id: string; label: string }) {
  const noteId = `${id}-note`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="file"
        accept="image/png,image/jpeg,application/pdf"
        aria-describedby={noteId}
      />
      <p id={noteId} className="text-xs text-muted-foreground">
        Preview only. This file is not uploaded or persisted.
      </p>
    </div>
  );
}
