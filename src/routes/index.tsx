import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  GraduationCap,
  Laptop,
  Network,
  ShieldCheck,
  ShoppingBag,
  Store,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import heroImage from "@/assets/hiloxs-brand-hero.jpg";
import { PLAN, PRODUCTS, dual, kes } from "@/lib/hiloxs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HILOXS — Electronics Shop, Binary Plan & Trading Desk" },
      {
        name: "description",
        content:
          "HILOXS brings together an electronics shop, a binary referral plan paying direct and matching bonuses, a demo trading desk and a video training academy.",
      },
      { property: "og:title", content: "HILOXS — Shop. Refer. Trade. Learn." },
      {
        property: "og:description",
        content:
          "Laptops, screens and woofers, a binary marketing plan with automatic bonuses, and a live-style demo trading desk.",
      },
    ],
  }),
  component: Index,
});

const PILLARS = [
  {
    icon: ShoppingBag,
    title: "Shop",
    to: "/shop" as const,
    body: "Laptops, screens, woofers and accessories with till, PayPal or MiniPay checkout.",
  },
  {
    icon: GraduationCap,
    title: "Training",
    to: "/training" as const,
    body: "My own YouTube classes sorted into binary, trading, shopping and getting started.",
  },
  {
    icon: Network,
    title: "Binary Plan",
    to: "/binary-plan" as const,
    body: "Register referrals yourself; direct and pairing bonuses release automatically.",
  },
  {
    icon: Activity,
    title: "Trading",
    to: "/trading" as const,
    body: "A demo desk with live candles, expiry timers and real-time market movement.",
  },
  {
    icon: Store,
    title: "Sell With Us",
    to: "/sell-with-us" as const,
    body: "Vendors list verified electronics and get paid straight to their accounts.",
  },
  {
    icon: Laptop,
    title: "My Orders",
    to: "/my-orders" as const,
    body: "Track everything you have bought, its payment method and delivery status.",
  },
];

function Index() {
  const featured = PRODUCTS.slice(0, 4);

  return (
    <div>
      <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:py-20">
        <div>
          <Badge variant="secondary" className="gap-1">
            <ShieldCheck className="size-3.5" /> Electronics only · No PMAs
          </Badge>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Shop electronics. <span className="text-gradient-brand">Build your team.</span> Learn to
            trade.
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            HILOXS is one platform with four engines: a marketplace for laptops, screens and
            woofers; a binary network marketing plan that pays you for every referral and every
            pair; a demo trading desk; and a training academy where I show you exactly how I work
            each system.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button asChild variant="hero" size="lg">
              <Link to="/binary-plan">Join the binary plan</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/shop">Browse the shop</Link>
            </Button>
          </div>
          <dl className="mt-8 grid max-w-md grid-cols-3 gap-4">
            <HeroStat label="Per referral" value={dual(PLAN.directReferralKes).split(" (")[0]!} />
            <HeroStat label="Per pair" value={dual(PLAN.pairMatchingKes).split(" (")[0]!} />
            <HeroStat label="Entry package" value={dual(PLAN.entryPackageKes).split(" (")[0]!} />
          </dl>
        </div>
        <div className="panel overflow-hidden">
          <img
            src={heroImage}
            alt="HILOXS brand mark with the tagline Luxury. Quality. Lifestyle."
            width={1254}
            height={1254}
            className="h-full w-full object-cover"
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6">
        <h2 className="text-2xl font-bold sm:text-3xl">What is inside HILOXS</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Six sections, one login. Here is what each one does.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <Link key={p.title} to={p.to} className="panel block p-6 transition-colors hover:border-primary">
              <p.icon className="size-6 text-primary" />
              <h3 className="mt-3 text-lg font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="panel grid gap-8 p-8 lg:grid-cols-2">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Wallet className="size-5" />
              <span className="text-xs font-semibold uppercase tracking-widest">
                How the money works
              </span>
            </div>
            <h2 className="mt-3 text-2xl font-bold sm:text-3xl">The binary plan in plain words</h2>
            <ol className="mt-5 space-y-4 text-sm text-muted-foreground">
              <li>
                <span className="font-semibold text-foreground">1. Activate.</span> Your entry
                package is {dual(PLAN.entryPackageKes)}. {kes(PLAN.registrationFeeKes)} of it is
                held as the registration fee and set aside; the rest becomes the profit pool.
              </li>
              <li>
                <span className="font-semibold text-foreground">2. Refer.</span> Every referral you
                register yourself pays you {dual(PLAN.directReferralKes)}. Bring in two and that is{" "}
                {dual(PLAN.directReferralKes * 2)}.
              </li>
              <li>
                <span className="font-semibold text-foreground">3. Pair.</span> One person on your
                left leg plus one on your right forms a pair, and each pair adds{" "}
                {dual(PLAN.pairMatchingKes)} — again and again as new pairs form.
              </li>
              <li>
                <span className="font-semibold text-foreground">4. Withdraw.</span> Bonuses land in
                your wallet automatically and move to your PayPal or MiniPay account, then out to
                M-Pesa.
              </li>
            </ol>
            <Button asChild variant="hero" className="mt-6">
              <Link to="/binary-plan">Open my binary dashboard</Link>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {featured.map((p) => (
              <div key={p.id} className="rounded-xl border border-border bg-background/40 p-4">
                <span className="text-3xl" aria-hidden>{p.emoji}</span>
                <p className="mt-2 text-sm font-semibold leading-tight">{p.name}</p>
                <p className="mt-1 text-sm font-bold text-primary">{kes(p.priceKes)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface/70 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-lg font-bold text-primary">{value}</dd>
    </div>
  );
}
