import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowDownToLine, CheckCircle2, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  ELECTRONICS_PRODUCTS,
  PLAN,
  SUPPORT,
  TILL_NUMBER,
  dual,
  kes,
  usd,
  kesToUsd,
} from "@/lib/hiloxs";
import { useHiloxs, type Leg } from "@/lib/hiloxs-store";
import { MERCHANT_NAME } from "@/lib/hiloxs";
import { BinaryTree, buildTree } from "@/components/hiloxs/BinaryTree";

export const Route = createFileRoute("/binary-plan")({
  head: () => ({
    meta: [
      { title: "HILOXS Binary Plan — Referral & Matching Bonuses" },
      {
        name: "description",
        content:
          "Register your own referrals, fill your left and right legs, and let HILOXS release direct and pairing bonuses to PayPal, MiniPay or M-Pesa.",
      },
      { property: "og:title", content: "The HILOXS Binary Plan" },
      {
        property: "og:description",
        content: "Direct referral and matching pair bonuses paid out automatically.",
      },
    ],
  }),
  component: BinaryPlanPage,
});

function BinaryPlanPage() {
  const {
    state,
    hydrated,
    walletKes,
    legCounts,
    addReferral,
    activateReferral,
    activateMember,
    saveAccounts,
    withdraw,
  } = useHiloxs();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    leg: "L" as Leg,
    parentId: "" as string,
  });
  const [accounts, setAccounts] = useState(state.accounts);
  const [amount, setAmount] = useState("");
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
        HILOXS pays on an electronics-backed binary structure. You register your own referrals, the
        system detects direct sign-ups and left/right pairs, and it releases the bonuses to your
        wallet automatically.
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PlanCard
          title="Entry package"
          value={dual(PLAN.entryPackageKes)}
          note="One-off activation with an electronics starter pack"
        />
        <PlanCard
          title="Registration fee"
          value={dual(PLAN.registrationFeeKes)}
          note="Cut from the entry package and set aside directly"
        />
        <PlanCard
          title="Direct referral"
          value={dual(PLAN.directReferralKes)}
          note={`Two referrals = ${dual(PLAN.directReferralKes * 2)}`}
        />
        <PlanCard
          title="Matching pair"
          value={dual(PLAN.pairMatchingKes)}
          note="Per left + right pair, repeating with every new pair"
        />
      </section>

      <div className="panel mt-4 p-5 text-sm text-muted-foreground">
        Of every {dual(PLAN.entryPackageKes)} entry package, {kes(PLAN.registrationFeeKes)} is held
        as the registration fee and the remaining{" "}
        <span className="font-semibold text-foreground">
          {dual(PLAN.entryPackageKes - PLAN.registrationFeeKes)}
        </span>{" "}
        flows into the profit pool that funds referral and pairing bonuses. No PMAs, no health
        products — electronics only.
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section>
          <h2 className="text-xl font-semibold">Register a referral</h2>
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
                phone: form.phone.trim(),
                leg: form.leg,
                parentId: form.parentId || null,
              });
              toast.success(`${form.name} added to the ${form.leg === "L" ? "left" : "right"} leg`);
              setForm({
                name: "",
                phone: "",
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
            <div className="space-y-1.5">
              <Label htmlFor="ref-phone">Phone</Label>
              <Input
                id="ref-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="07xx xxx xxx"
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
                  >
                    {leg === "L" ? "Left leg" : "Right leg"}
                  </Button>
                ))}
              </div>
            </div>
            <Button type="submit" variant="hero" className="sm:col-span-2">
              <Users /> Add referral
            </Button>
          </form>

          <h3 className="mt-8 text-lg font-semibold">Your binary tree</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Every member you register takes a left or right position. Their own referrals sit under
            them the same way, so the structure keeps expanding level after level — to infinity.
            Expand any node to follow a leg down.
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
                <span className="text-2xl" aria-hidden>{p.emoji}</span>
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
                      Confirm package
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No referrals yet. Bonuses release the moment a referral's entry package is confirmed.
            </p>
          )}

          <h3 className="mt-8 text-lg font-semibold">Bonus ledger</h3>
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
                        e.amountKes < 0 ? "font-semibold text-destructive" : "font-semibold text-success"
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
                Bonuses will appear here automatically.
              </li>
            )}
          </ul>
        </section>

        <aside className="space-y-6">
          <div className="panel p-5">
            <div className="flex items-center gap-2 text-primary">
              <Wallet className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-widest">Bonus wallet</span>
            </div>
            <p className="mt-2 text-3xl font-bold">{usd(kesToUsd(walletKes))}</p>
            <p className="text-sm text-muted-foreground">{kes(walletKes)} available</p>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
              <Stat label="Left" value={legCounts.L} />
              <Stat label="Right" value={legCounts.R} />
              <Stat label="Pairs" value={pairs} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {directs} activated direct referral{directs === 1 ? "" : "s"} · pairing bonus repeats
              at {dual(PLAN.pairMatchingKes)} per pair.
            </p>
          </div>

          <div className="panel p-5">
            <h3 className="text-sm font-semibold">Membership</h3>
            {state.member.activated ? (
              <p className="mt-2 text-sm text-success">
                {state.member.name} — package activated.
              </p>
            ) : (
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  activateMember(memberName.trim());
                  toast.success("Entry package activated");
                }}
              >
                <Input
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder="Your full name"
                />
                <Button variant="hero" className="w-full" type="submit">
                  Activate {dual(PLAN.entryPackageKes)}
                </Button>
              </form>
            )}
          </div>

          <div className="panel p-5">
            <h3 className="text-sm font-semibold">Payout accounts (in your own name)</h3>
            <form
              className="mt-3 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveAccounts(accounts);
                toast.success("Payout accounts saved");
              }}
            >
              <Input
                value={accounts.accountName}
                onChange={(e) => setAccounts({ ...accounts, accountName: e.target.value })}
                placeholder="Account holder name"
              />
              <Input
                value={accounts.paypalEmail}
                onChange={(e) => setAccounts({ ...accounts, paypalEmail: e.target.value })}
                placeholder="PayPal email"
                type="email"
              />
              <Input
                value={accounts.miniPayNumber}
                onChange={(e) => setAccounts({ ...accounts, miniPayNumber: e.target.value })}
                placeholder="MiniPay wallet number"
              />
              <Input
                value={accounts.mpesaNumber}
                onChange={(e) => setAccounts({ ...accounts, mpesaNumber: e.target.value })}
                placeholder="M-Pesa number for cash-out"
              />
              <Button variant="outline" className="w-full" type="submit">
                Save accounts
              </Button>
            </form>
          </div>

          <div className="panel p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ArrowDownToLine className="size-4" /> Withdraw bonuses
            </h3>
            <Input
              className="mt-3"
              value={amount}
              inputMode="numeric"
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount in KSh"
            />
            <div className="mt-3 grid gap-2">
              {(["paypal", "minipay", "mpesa"] as const).map((to) => (
                <Button
                  key={to}
                  variant={to === "paypal" ? "hero" : "outline"}
                  onClick={() => {
                    const err = withdraw(Number(amount), to);
                    if (err) toast.error(err);
                    else {
                      toast.success(`Withdrawal sent to ${to}`);
                      setAmount("");
                    }
                  }}
                >
                  Withdraw to {to === "paypal" ? "PayPal" : to === "minipay" ? "MiniPay" : "M-Pesa"}
                </Button>
              ))}
            </div>
            <p className="mt-3 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              Entry packages and bonus cash-outs run through {MERCHANT_NAME} · Buy Goods Till{" "}
              {TILL_NUMBER} — the same till used in the shop and on the trading desk. Every prompt
              and receipt reads {MERCHANT_NAME}.
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