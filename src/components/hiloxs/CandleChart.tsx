import { useEffect, useMemo, useRef, useState } from "react";

export type Candle = { o: number; h: number; l: number; c: number; t: number };

export function makeSeed(base: number, count = 60): Candle[] {
  const out: Candle[] = [];
  let price = base;
  const now = Date.now();
  for (let i = count; i > 0; i--) {
    const o = price;
    const drift = (Math.random() - 0.5) * base * 0.004;
    const c = Math.max(base * 0.9, o + drift);
    const h = Math.max(o, c) + Math.random() * base * 0.0015;
    const l = Math.min(o, c) - Math.random() * base * 0.0015;
    out.push({ o, h, l, c, t: now - i * 1000 });
    price = c;
  }
  return out;
}

export function stepCandles(prev: Candle[], tick: number, volatility: number): Candle[] {
  const next = prev.slice();
  const last = next[next.length - 1]!;
  const live = { ...last };
  const move = (Math.random() - 0.5) * volatility;
  live.c = Math.max(0.0001, live.c + move);
  live.h = Math.max(live.h, live.c);
  live.l = Math.min(live.l, live.c);
  next[next.length - 1] = live;

  if (tick % 4 === 0) {
    next.push({ o: live.c, c: live.c, h: live.c, l: live.c, t: Date.now() });
    if (next.length > 70) next.shift();
  }
  return next;
}

/** Lightweight SVG candlestick chart with a live price rail. */
export function CandleChart({ candles, height = 320 }: { candles: Candle[]; height?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    const padRight = 68;
    const padY = 16;
    const innerW = Math.max(120, width - padRight);
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const span = Math.max(max - min, 0.000001);
    const y = (v: number) => padY + ((max - v) / span) * (height - padY * 2);
    const slot = innerW / candles.length;
    const bodyW = Math.max(2, slot * 0.6);
    return { y, slot, bodyW, innerW, max, min, padY };
  }, [candles, width, height]);

  const last = candles[candles.length - 1]!;
  const first = candles[0]!;
  const rising = last.c >= first.o;

  return (
    <div ref={wrapRef} className="w-full">
      <svg width="100%" height={height} role="img" aria-label="Live candlestick chart">
        <defs>
          <linearGradient id="candleGlow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const yy = view.padY + p * (height - view.padY * 2);
          const price = view.max - p * (view.max - view.min);
          return (
            <g key={p}>
              <line
                x1={0}
                x2={view.innerW}
                y1={yy}
                y2={yy}
                stroke="var(--color-border)"
                strokeDasharray="3 6"
              />
              <text
                x={view.innerW + 8}
                y={yy + 4}
                fontSize="10"
                fill="var(--color-muted-foreground)"
              >
                {price.toFixed(price > 100 ? 1 : 4)}
              </text>
            </g>
          );
        })}

        {candles.map((c, i) => {
          const x = i * view.slot + view.slot / 2;
          const up = c.c >= c.o;
          const color = up ? "var(--color-success)" : "var(--color-destructive)";
          const top = view.y(Math.max(c.o, c.c));
          const bottom = view.y(Math.min(c.o, c.c));
          return (
            <g key={c.t + "-" + i}>
              <line x1={x} x2={x} y1={view.y(c.h)} y2={view.y(c.l)} stroke={color} strokeWidth={1} />
              <rect
                x={x - view.bodyW / 2}
                y={top}
                width={view.bodyW}
                height={Math.max(1.5, bottom - top)}
                fill={color}
                rx={1}
              />
            </g>
          );
        })}

        <line
          x1={0}
          x2={view.innerW}
          y1={view.y(last.c)}
          y2={view.y(last.c)}
          stroke={rising ? "var(--color-success)" : "var(--color-destructive)"}
          strokeDasharray="4 4"
        />
        <rect
          x={view.innerW + 2}
          y={view.y(last.c) - 9}
          width={62}
          height={18}
          rx={4}
          fill={rising ? "var(--color-success)" : "var(--color-destructive)"}
        />
        <text
          x={view.innerW + 33}
          y={view.y(last.c) + 4}
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill="var(--color-background)"
        >
          {last.c.toFixed(last.c > 100 ? 1 : 4)}
        </text>
      </svg>
    </div>
  );
}