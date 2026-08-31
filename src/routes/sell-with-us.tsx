import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Building2, FileCheck2, Store, UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

const STEPS = [
  {
    icon: Building2,
    title: "Business identity",
    body: "Legal name, registration and tax details.",
  },
  {
    icon: UserRoundCheck,
    title: "Contact checks",
    body: "Business email, phone and authorized representative.",
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

const REQUIREMENTS = [
  "Business registration and tax information",
  "Authorized business contact details",
  "Verified payout ownership",
  "Business and identity documents",
  "Product categories and sourcing details",
];

function SellWithUsPage() {
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
        <Badge variant="secondary">Applications not open</Badge>
      </div>
      <p className="mt-3 max-w-3xl text-muted-foreground">
        Seller applications are not currently accepted. This page does not collect business, tax,
        contact, payout or document information, and HILOXS does not currently perform BRS or KRA
        verification.
      </p>

      <section className="mt-8" aria-labelledby="onboarding-steps">
        <h2 id="onboarding-steps" className="text-xl font-semibold">
          Planned onboarding steps
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.title} className="panel p-5">
              <step.icon className="size-6 text-primary" aria-hidden />
              <h3 className="mt-3 font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="panel mt-8 p-5 sm:p-6" aria-labelledby="future-requirements">
        <h2 id="future-requirements" className="text-xl font-semibold">
          Future application requirements
        </h2>
        <ul className="mt-4 grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          {REQUIREMENTS.map((requirement) => (
            <li key={requirement} className="flex items-start gap-2">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              {requirement}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
