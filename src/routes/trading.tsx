import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CandleChart, makeSeed, stepCandles, type Candle } from "@/components/hiloxs/CandleChart";
import { useHiloxs, type Trade } from "@/lib/hiloxs-store";

export const Route = createFileRoute("/trading")({
  head: () => ({
    meta: [
      { title: "HILOXS Demo Trading Desk — Live Candles & Expiry Timers" },
      {
        name: "description",
        content:
          "Practise binary-style UP/DOWN calls on the HILOXS demo desk with live candlestick charts, selectable expiry timers and real-time market movement.",
      },
      { property: "og:title", content: "HILOXS Demo Trading Desk" },
      {
        property: "og:description",
        content: "Live-style candles, expiry timers and a risk-free demo balance.",
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
  const { state, hydrated, recordTrade, settleTrade } = useHiloxs();
  const [assetIndex, setAssetIndex] = useState(0);
  const asset = ASSETS[assetIndex]!;
  const [candles, setCandles] = useState<Candle[]>(() => makeSeed(asset.base));
  const [expiry, setExpiry] = useState(EXPIRIES[1]!);
  const [stake, setStake] = useState("10");
  const [openTrade, setOpenTrade] = useState<{ id: string; endsAt: number } | null>(null);
  const [now, setNow] = useState(0);
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
        <span className="text-xs font-semibold uppercase tracking-widest">Demo desk</span>
      </div>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Trading</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        A risk-free practice desk with live-style candles and expiry timers. No real money moves
        here — it exists so you can rehearse what you learn in training.
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
              {change >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
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
            Demo balance
          </p>
          <p className="text-3xl font-bold">
            ${hydrated ? state.demoBalanceUsd.toFixed(2) : "1000.00"}
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
              <TrendingUp /> UP · 85% payout
            </Button>
            <Button variant="down" onClick={() => place("DOWN")} disabled={!!openTrade}>
              <TrendingDown /> DOWN · 85% payout
            </Button>
          </div>
        </aside>
      </div>

      <h2 className="mt-10 text-xl font-semibold">Trade history</h2>
      <div className="panel mt-3 divide-y divide-border">
        {hydrated && state.trades.length > 0 ? (
          state.trades.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <Badge variant={t.direction === "UP" ? "default" : "destructive"}>{t.direction}</Badge>
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