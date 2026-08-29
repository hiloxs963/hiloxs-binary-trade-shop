import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Activity, Lock, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CandleChart } from "@/components/hiloxs/CandleChart";
import { makeSeed, stepCandles, type Candle } from "@/components/hiloxs/CandleChart.helpers";
import { useHiloxs } from "@/lib/hiloxs-context";
import { type Trade } from "@/lib/hiloxs-store";
import { MERCHANT_NAME, TILL_NUMBER, SUPPORT } from "@/lib/hiloxs";
import { ADMIN_KEY, useAdminMode } from "@/lib/admin";

export const Route = createFileRoute("/trading")({
  head: () => ({
    meta: [
      { title: "HILOXS Binary Trading — Live Candles, Expiry Timers & Payouts" },
      {
        name: "description",
        content:
          "Place real binary UP/DOWN calls on HILOXS with live candlestick charts, expiry timers and winnings withdrawable to PayPal, MiniPay or M-Pesa.",
      },
      { property: "og:title", content: "HILOXS Binary Trading" },
      {
        property: "og:description",
        content:
          "Live candles, expiry timers and withdrawable winnings, settled through the HILOXS till.",
      },
    ],
  }),
  component: TradingPage,
});

const ASSETS = [
  { symbol: "BTC/USD", base: 64_250, vol: 42 },
  { symbol: "EUR/USD", base: 1.0865, vol: 0.0006 },
  { symbol: "GBP/USD", base: 1.2712, vol: 0.0007 },
  { symbol: "USD/KES", base: 129.4, vol: 0.09 },
  { symbol: "GOLD", base: 2_385, vol: 1.6 },
];

const EXPIRIES = [
  { label: "30s", sec: 30 },
  { label: "1m", sec: 60 },
  { label: "2m", sec: 120 },
  { label: "5m", sec: 300 },
];

function TradingPage() {
  const { state, hydrated, recordTrade, settleTrade, setAdmin, withdrawTrading } = useHiloxs();
  const adminMode = useAdminMode();
  const [assetIndex, setAssetIndex] = useState(0);
  const asset = ASSETS[assetIndex]!;
  const [candles, setCandles] = useState<Candle[]>(() => makeSeed(asset.base));
  const [expiry, setExpiry] = useState(EXPIRIES[1]!);
  const [stake, setStake] = useState("10");
  const [openTrade, setOpenTrade] = useState<{ id: string; endsAt: number } | null>(null);
  const [now, setNow] = useState(0);
  const [adminPin, setAdminPin] = useState("");
  const [payout, setPayout] = useState("");
  const tick = useRef(0);
  const priceRef = useRef(asset.base);

  useEffect(() => {
    setCandles(makeSeed(asset.base));
    priceRef.current = asset.base;
  }, [asset.base]);

  useEffect(() => {
    const id = window.setInterval(() => {
      tick.current += 1;
      setCandles((prev) => {
        const next = stepCandles(prev, tick.current, asset.vol);
        priceRef.current = next[next.length - 1]!.c;
        return next;
      });
      setNow(Date.now());
    }, 700);
    return () => window.clearInterval(id);
  }, [asset.vol]);

  useEffect(() => {
    if (!openTrade) return;
    if (Date.now() >= openTrade.endsAt) {
      settleTrade(openTrade.id, priceRef.current);
      setOpenTrade(null);
      toast.info("Trade expired — result posted to your history");
    }
  }, [now, openTrade, settleTrade]);

  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 2] ?? last;
  const change = ((last.c - candles[0]!.o) / candles[0]!.o) * 100;
  const rising = last.c >= prev.c;
  const remaining = openTrade ? Math.max(0, Math.ceil((openTrade.endsAt - now) / 1000)) : 0;

  const place = (direction: "UP" | "DOWN"): void => {
    const stakeUsd = Number(stake);
    if (!stakeUsd || stakeUsd <= 0) {
      toast.error("Enter a stake above $0");
      return;
    }
    if (stakeUsd > state.demoBalanceUsd) {
      toast.error("Demo balance is too low");
      return;
    }
    if (openTrade) {
      toast.error("Wait for the open trade to expire");
      return;
    }
    const trade: Trade = {
      id: Math.random().toString(36).slice(2, 10),
      asset: asset.symbol,
      direction,
      stakeUsd,
      expirySec: expiry.sec,
      entry: priceRef.current,
      at: Date.now(),
    };
    recordTrade(trade);
    setOpenTrade({ id: trade.id, endsAt: Date.now() + expiry.sec * 1000 });
    toast.success(`${direction} ${asset.symbol} · $${stakeUsd} · ${expiry.label}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex items-center gap-2 text-accent">
        <Activity className="size-5" />
        <span className="text-xs font-semibold uppercase tracking-widest">Live binary desk</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Binary Trading</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Real binary trading on HILOXS. Stakes are funded through the HILOXS till, and won trades can
        be withdrawn to your PayPal, MiniPay or M-Pesa account.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {ASSETS.map((a, i) => (
          <Button
            key={a.symbol}
            size="sm"
            variant={i === assetIndex ? "default" : "outline"}
            onClick={() => setAssetIndex(i)}
          >
            {a.symbol}
          </Button>
        ))}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="panel p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">{asset.symbol}</p>
              <p
                className={`font-display text-3xl font-bold ${rising ? "text-success" : "text-destructive"}`}
              >
                {last.c.toFixed(last.c > 100 ? 2 : 4)}
              </p>
            </div>
            <Badge variant="secondary" className="gap-1">
              {change >= 0 ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {change.toFixed(2)}%
            </Badge>
          </div>
          <div className="mt-4">
            <CandleChart candles={candles} />
          </div>
          {openTrade && (
            <div className="mt-4 flex items-center justify-between rounded-lg bg-secondary px-4 py-3 text-sm">
              <span>Trade in progress on {asset.symbol}</span>
              <span className="font-display text-xl font-bold text-primary">{remaining}s</span>
            </div>
          )}
        </div>

        <aside className="panel h-fit p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Trading balance
          </p>
          <p className="text-3xl font-bold">
            ${hydrated ? state.demoBalanceUsd.toFixed(2) : "1000.00"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Fund or cash out via {MERCHANT_NAME} · Buy Goods Till {TILL_NUMBER}
          </p>

          <p className="mt-5 text-sm font-medium">Expiry timer</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {EXPIRIES.map((e) => (
              <Button
                key={e.sec}
                size="sm"
                variant={e.sec === expiry.sec ? "default" : "outline"}
                onClick={() => setExpiry(e)}
              >
                {e.label}
              </Button>
            ))}
          </div>

          <p className="mt-5 text-sm font-medium">Stake (USD)</p>
          <Input
            className="mt-2"
            value={stake}
            inputMode="decimal"
            onChange={(e) => setStake(e.target.value)}
          />

          <div className="mt-5 grid gap-2">
            <Button variant="up" onClick={() => place("UP")} disabled={!!openTrade}>
              <TrendingUp /> UP · {Math.round((state.admin.payoutRate - 1) * 100)}% payout
            </Button>
            <Button variant="down" onClick={() => place("DOWN")} disabled={!!openTrade}>
              <TrendingDown /> DOWN · {Math.round((state.admin.payoutRate - 1) * 100)}% payout
            </Button>
          </div>

          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm font-medium">Withdraw winnings (USD)</p>
            <Input
              className="mt-2"
              value={payout}
              inputMode="decimal"
              onChange={(e) => setPayout(e.target.value)}
              placeholder="Amount in USD"
            />
            <div className="mt-2 grid gap-2">
              {(["paypal", "minipay", "mpesa"] as const).map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={to === "paypal" ? "hero" : "outline"}
                  onClick={() => {
                    const err = withdrawTrading(Number(payout), to);
                    if (err) toast.error(err);
                    else {
                      toast.success(`Withdrawal sent to ${to}`);
                      setPayout("");
                    }
                  }}
                >
                  Withdraw to {to === "paypal" ? "PayPal" : to === "minipay" ? "MiniPay" : "M-Pesa"}
                </Button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Support: {SUPPORT.hours} · {SUPPORT.email} · {SUPPORT.phone}
            </p>
          </div>
        </aside>
      </div>

      {adminMode && (
        <section className="panel mt-8 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">Admin control</h2>
          </div>
          {state.admin.unlocked ? (
            <div className="mt-4 grid gap-5 lg:grid-cols-3">
              <div>
                <p className="text-sm font-medium">Trade outcome</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(["market", "win", "loss"] as const).map((o) => (
                    <Button
                      key={o}
                      size="sm"
                      variant={state.admin.outcome === o ? "default" : "outline"}
                      onClick={() => setAdmin({ outcome: o })}
                    >
                      {o === "market" ? "Follow market" : o === "win" ? "Force WIN" : "Force LOSS"}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Applies to every trade settled from now on.
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">Payout multiplier</p>
                <Input
                  className="mt-2"
                  value={String(state.admin.payoutRate)}
                  inputMode="decimal"
                  onChange={(e) => setAdmin({ payoutRate: Number(e.target.value) || 1 })}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  1.85 pays 85% on top of the stake.
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">Till float</p>
                <p className="mt-2 font-display text-2xl font-bold text-primary">
                  ${state.paybillFloatUsd.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Lost stakes settle into till {TILL_NUMBER}; paid winnings are deducted here.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  onClick={() => setAdmin({ unlocked: false })}
                >
                  Lock admin
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="mt-3 flex max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (adminPin.trim() === ADMIN_KEY) {
                  setAdmin({ unlocked: true });
                  setAdminPin("");
                  toast.success("Admin controls unlocked");
                } else toast.error("Wrong admin key");
              }}
            >
              <Input
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="Admin key"
                type="password"
              />
              <Button type="submit" variant="outline">
                <Lock /> Unlock
              </Button>
            </form>
          )}
        </section>
      )}

      <h2 className="mt-10 text-xl font-semibold">Trade history</h2>
      <div className="panel mt-3 divide-y divide-border">
        {hydrated && state.trades.length > 0 ? (
          state.trades.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <Badge variant={t.direction === "UP" ? "default" : "destructive"}>
                {t.direction}
              </Badge>
              <span className="font-medium">{t.asset}</span>
              <span className="text-muted-foreground">
                ${t.stakeUsd.toFixed(2)} · {t.expirySec}s · entry {t.entry.toFixed(4)}
              </span>
              <span className="ml-auto font-semibold">
                {t.result ? (
                  <span className={t.result === "WIN" ? "text-success" : "text-destructive"}>
                    {t.result} {t.result === "WIN" ? `+$${(t.payoutUsd ?? 0).toFixed(2)}` : ""}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Open…</span>
                )}
              </span>
            </div>
          ))
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No trades yet.</p>
        )}
      </div>
    </div>
  );
}
