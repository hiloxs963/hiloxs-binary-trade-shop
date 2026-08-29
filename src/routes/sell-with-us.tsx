import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BadgeCheck, PackageCheck, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MERCHANT_NAME, TILL_NUMBER } from "@/lib/hiloxs";

export const Route = createFileRoute("/sell-with-us")({
  head: () => ({
    meta: [
      { title: "Sell Electronics With HILOXS — Vendor Application" },
      {
        name: "description",
        content:
          "List your laptops, screens and woofers on HILOXS, reach the whole network and get paid to your till, PayPal or MiniPay.",
      },
      { property: "og:title", content: "Sell With HILOXS" },
      {
        property: "og:description",
        content: "Become a HILOXS vendor and sell electronics to the entire network.",
      },
    ],
  }),
  component: SellWithUsPage,
});

const STEPS = [
  { icon: Store, title: "Apply", body: "Send your shop details and the electronics you stock." },
  {
    icon: BadgeCheck,
    title: "Get verified",
    body: "We confirm stock quality, warranty and pricing.",
  },
  {
    icon: PackageCheck,
    title: "List products",
    body: "Your items appear in the HILOXS shop instantly.",
  },
  {
    icon: Truck,
    title: "Ship & get paid",
    body: "We handle the order flow; payouts go to your account.",
  },
];

function SellWithUsPage() {
  const [sent, setSent] = useState(false);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold sm:text-4xl">Sell With Us</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        HILOXS lists electronics only. If you stock laptops, screens, woofers or the accessories
        around them, bring them to a network that is already buying.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <div key={s.title} className="panel p-5">
            <s.icon className="size-6 text-primary" />
            <p className="mt-3 font-semibold">{s.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <form
          className="panel grid gap-4 p-6 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSent(true);
            toast.success("Vendor application received — we'll be in touch");
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="biz">Business name</Label>
            <Input id="biz" required placeholder="e.g. Nova Electronics" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner">Contact person</Label>
            <Input id="owner" required placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mail">Email</Label>
            <Input id="mail" type="email" required placeholder="you@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tel">Phone</Label>
            <Input id="tel" required placeholder="07xx xxx xxx" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cats">What do you stock?</Label>
            <Input id="cats" required placeholder="Laptops, monitors, subwoofers…" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">
              Tell us about your stock — business permit and user 🆔 attached
            </Label>
            <Textarea
              id="notes"
              rows={4}
              placeholder="Brands, warranty, monthly volume, location"
            />
            <p className="text-xs text-muted-foreground">
              Attach a clear copy of your business permit and your national ID / passport. Both are
              required before your shop is verified.
            </p>
            <Input
              id="docs"
              type="file"
              multiple
              accept="image/*,application/pdf"
              aria-label="Attach business permit and user ID"
              className="cursor-pointer"
            />
          </div>
          <Button type="submit" variant="hero" className="sm:col-span-2">
            {sent ? "Application sent" : "Apply to sell"}
          </Button>
        </form>

        <aside className="space-y-5">
          <div className="panel p-6">
            <h2 className="text-lg font-semibold">Vendor payouts</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>· PayPal — international vendors</li>
              <li>· MiniPay — instant local wallet settlement</li>
              <li>· M-Pesa — cash-out from either wallet</li>
            </ul>
            <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm">
              <p className="font-semibold">{MERCHANT_NAME}</p>
              <p className="mt-1 text-muted-foreground">
                Buy Goods Till: {TILL_NUMBER} (Buy Goods only — no paybill). Payouts and vendor
                payments show as {MERCHANT_NAME}.
              </p>
            </div>
          </div>
          <div className="panel p-6 text-sm text-muted-foreground">
            <p className="font-semibold text-foreground">Vendor rules</p>
            <p className="mt-2">
              Electronics only. No health products, no PMAs. Genuine stock with a working warranty,
              honest condition grading, and delivery within 48 hours of an order.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
