import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ELECTRONICS_PRODUCTS, PLAN, SUPPORT, dual, kes, usd, kesToUsd } from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-context";
import { type Leg } from "@/lib/hiloxs-store";
import { BinaryTree } from "@/components/hiloxs/BinaryTree";
import { buildTree } from "@/components/hiloxs/BinaryTree.helpers";
import { pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/binary-plan")({
  head: () =>
    pageSeo({
      title: "Binary Plan Overview and Prototype Dashboard | HILOXS",
      description:
        "Review the HILOXS binary-plan structure, electronics entry package and current prototype referral dashboard.",
      path: "/binary-plan",
    }),
  component: BinaryPlanPage,
});

function BinaryPlanPage() {
  const { state, hydrated, walletKes, legCounts, addReferral, activateReferral, activateMember } =
    useHiloxs();

  const [form, setForm] = useState({
    name: "",
    leg: "L" as Leg,
    parentId: "" as string,
  });
  const [memberName, setMemberName] = useState("");

  const pairs = Math.min(legCounts.L, legCounts.R);
  const directs = state.referrals.filter((r) => r.activated).length;
  const tree = buildTree(
    hydrated ? state.referrals : [],
    state.member.name || "You",
    state.member.activated,
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">Binary Plan</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        This browser-only prototype illustrates a proposed electronics-backed binary structure.
        Entries, referrals, bonuses, wallet balances and package confirmations shown here are
        simulations stored on this device.
      </p>
      <div className="mt-4 max-w-3xl rounded-md border border-border bg-secondary/60 p-4 text-sm text-muted-foreground">
        HILOXS does not currently accept entry payments or transfer referral, pairing or withdrawal
        funds through this page.
      </div>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PlanCard
          title="Entry package"
          value={dual(PLAN.entryPackageKes)}
          note="Proposed one-off electronics starter package"
        />
        <PlanCard
          title="Registration fee"
          value={dual(PLAN.registrationFeeKes)}
          note="Illustrative amount within the prototype"
        />
        <PlanCard
          title="Direct referral"
          value={dual(PLAN.directReferralKes)}
          note={`Prototype projection: two = ${dual(PLAN.directReferralKes * 2)}`}
        />
        <PlanCard
          title="Matching pair"
          value={dual(PLAN.pairMatchingKes)}
          note="Illustrative amount per left and right pair"
        />
      </section>

      <div className="panel mt-4 p-5 text-sm text-muted-foreground">
        The prototype models {kes(PLAN.registrationFeeKes)} of a {dual(PLAN.entryPackageKes)} entry
        package as a registration fee, with the remaining{" "}
        <span className="font-semibold text-foreground">
          {dual(PLAN.entryPackageKes - PLAN.registrationFeeKes)}
        </span>{" "}
        assigned to an illustrative profit pool. These values are planning assumptions, not payable
        earnings or accepted funds. No PMAs, no health products — electronics only.
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h2 className="text-xl font-semibold">Simulate a referral</h2>
          <form
            className="panel mt-3 grid gap-4 p-5 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.name.trim()) {
                toast.error("Enter the referral's name");
                return;
              }
              addReferral({
                name: form.name.trim(),
                phone: "",
                leg: form.leg,
                parentId: form.parentId || null,
              });
              toast.success(`${form.name} added to the ${form.leg === "L" ? "left" : "right"} leg`);
              setForm({
                name: "",
                leg: form.leg === "L" ? "R" : "L",
                parentId: form.parentId,
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="ref-name">Full name</Label>
              <Input
                id="ref-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Achieng Otieno"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ref-parent">Place under (sponsor position)</Label>
              <select
                id="ref-parent"
                value={form.parentId}
                onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{state.member.name || "You"} (top of your tree)</option>
                {state.referrals.map((r) => (
                  <option key={r.id} value={r.id}>
                    Under {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Placement leg</Label>
              <div className="flex gap-2">
                {(["L", "R"] as Leg[]).map((leg) => (
                  <Button
                    key={leg}
                    type="button"
                    variant={form.leg === leg ? "default" : "outline"}
                    onClick={() => setForm({ ...form, leg })}
                    aria-pressed={form.leg === leg}
                  >
                    {leg === "L" ? "Left leg" : "Right leg"}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="submit" variant="hero" className="sm:col-span-2">
              <Users /> Add demo referral
            </Button>
          </form>

          <h3 className="mt-8 text-lg font-semibold">Your binary tree</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Each demo member takes a left or right position. Their simulated referrals sit under
            them the same way. Expand any node to follow a prototype leg down.
          </p>
          <div className="panel mt-3 overflow-x-auto p-5">
            <BinaryTree node={tree} />
          </div>

          <h3 className="mt-8 text-lg font-semibold">Electronics packages behind the plan</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The binary plan is backed by electronics only — laptops, screens, woofers and their
            accessories. Nothing else qualifies for the entry package.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ELECTRONICS_PRODUCTS.map((p) => (
              <div key={p.id} className="panel p-4">
                <span className="text-2xl" aria-hidden>
                  {p.emoji}
                </span>
                <p className="mt-2 text-sm font-semibold leading-tight">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.category}</p>
                <p className="mt-1 text-sm font-bold text-primary">{kes(p.priceKes)}</p>
              </div>
            ))}
          </div>

          <h3 className="mt-8 text-lg font-semibold">My team</h3>
          {hydrated && state.referrals.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {state.referrals.map((r) => (
                <li key={r.id} className="panel flex items-center gap-3 p-4">
                  <Badge variant={r.leg === "L" ? "secondary" : "outline"}>
                    {r.leg === "L" ? "Left" : "Right"}
                  </Badge>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.phone || "No phone saved"}</p>
                  </div>
                  {r.activated ? (
                    <span className="flex items-center gap-1 text-xs font-semibold text-success">
                      <CheckCircle2 className="size-4" /> Activated
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => activateReferral(r.id)}>
                      Simulate package confirmation
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No demo referrals yet. Simulated bonuses appear after a package confirmation.
            </p>
          )}

          <h3 className="mt-8 text-lg font-semibold">Prototype bonus ledger</h3>
          <ul className="mt-3 space-y-2">
            {hydrated && state.ledger.length > 0 ? (
              state.ledger
                .slice()
                .sort((a, b) => b.at - a.at)
                .map((e) => (
                  <li key={e.id} className="panel flex items-center gap-3 p-4 text-sm">
                    <span className="flex-1">{e.label}</span>
                    <span
                      className={
                        e.amountKes < 0
                          ? "font-semibold text-destructive"
                          : "font-semibold text-success"
                      }
                    >
                      {e.amountKes === 0
                        ? "—"
                        : `${e.amountKes < 0 ? "-" : "+"}${dual(Math.abs(e.amountKes))}`}
                    </span>
                  </li>
                ))
            ) : (
              <li className="text-sm text-muted-foreground">
                Simulated bonuses will appear here automatically.
              </li>
            )}
          </ul>
        </section>

        <aside className="space-y-6">
          <div className="panel p-5">
            <div className="flex items-center gap-2 text-primary">
              <Wallet className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-widest">
                Prototype bonus wallet
              </span>
            </div>
            <p className="mt-2 text-3xl font-bold">{usd(kesToUsd(walletKes))}</p>
            <p className="text-sm text-muted-foreground">{kes(walletKes)} simulated balance</p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
              <Stat label="Left" value={legCounts.L} />
              <Stat label="Right" value={legCounts.R} />
              <Stat label="Pairs" value={pairs} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {directs} simulated direct referral{directs === 1 ? "" : "s"} · prototype pairing
              value {dual(PLAN.pairMatchingKes)} per pair.
            </p>
          </div>

          <div className="panel p-5">
            <h3 className="text-sm font-semibold">Prototype membership</h3>
            {state.member.activated ? (
              <p className="mt-2 text-sm text-success">
                {state.member.name} — demo package activated.
              </p>
            ) : (
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  activateMember(memberName.trim());
                  toast.success("Demo package activated; no payment was made");
                }}
              >
                <Input
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Your full name"
                />
                <Button variant="hero" className="w-full" type="submit">
                  Simulate {dual(PLAN.entryPackageKes)} activation
                </Button>
              </form>
            )}
          </div>

          <div className="panel p-5">
            <h3 className="text-sm font-semibold">Payouts are not available</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              PayPal, MiniPay and M-Pesa payout connections are planned. This page does not collect
              payout account details or transfer funds.
            </p>
          </div>

          <div className="panel p-5 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Support</p>
            <p className="mt-2">{SUPPORT.hours}</p>
            <p>{SUPPORT.email}</p>
            <p>{SUPPORT.phone}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PlanCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="panel p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-lg font-bold text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-secondary p-3">
      <p className="text-xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
