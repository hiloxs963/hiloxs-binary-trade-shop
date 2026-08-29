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
