import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEMO_TRADING_PAYOUT_RATE, PLAN } from "./hiloxs";
import { HiloxsContext, type HiloxsContextValue } from "./hiloxs-context";

export type Leg = "L" | "R";

export type Referral = {
  id: string;
  name: string;
  phone: string;
  leg: Leg;
  parentId: string | null;
  activated: boolean;
  joinedAt: number;
};

export type LedgerEntry = {
  id: string;
  kind: "direct" | "pair" | "withdrawal" | "registration" | "trading";
  label: string;
  amountKes: number; // negative for money leaving the wallet
  at: number;
};

export type PayoutAccounts = {
  paypalEmail: string;
  miniPayNumber: string;
  mpesaNumber: string;
  accountName: string;
};

export type Trade = {
  id: string;
  asset: string;
  direction: "UP" | "DOWN";
  stakeUsd: number;
  expirySec: number;
  entry: number;
  exit?: number;
  result?: "WIN" | "LOSS";
  payoutUsd?: number;
  at: number;
};

export type TrainingLevel = "Beginner" | "Intermediate" | "Advanced";

export type CustomVideo = {
  id: string;
  title: string;
  level: TrainingLevel;
  youtubeId: string;
  url: string;
  at: number;
};

export type HiloxsState = {
  member: { name: string; activated: boolean; joinedAt: number };
  referrals: Referral[];
  ledger: LedgerEntry[];
  paidPairs: number;
  accounts: PayoutAccounts;
  cart: Record<string, number>;
  trades: Trade[];
  demoBalanceUsd: number;
  paybillFloatUsd: number;
  videos: CustomVideo[];
};

const CART_STORAGE_KEY = "hiloxs.cart.v1";
const LEGACY_STORAGE_KEYS = ["hiloxs.state.v2"] as const;

const initialState: HiloxsState = {
  member: { name: "Guest Member", activated: false, joinedAt: Date.now() },
  referrals: [],
  ledger: [],
  paidPairs: 0,
  accounts: { paypalEmail: "", miniPayNumber: "", mpesaNumber: "", accountName: "" },
  cart: {},
  trades: [],
  demoBalanceUsd: 1000,
  paybillFloatUsd: 0,
  videos: [],
};

const uid = () => Math.random().toString(36).slice(2, 10);

/** Accepts a full YouTube URL (watch, youtu.be, shorts, embed) or a bare 11-char ID. */
function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  const match = value.match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
  return match?.[1] ?? null;
}

type Ctx = HiloxsContextValue;

export function HiloxsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HiloxsState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cart: Record<string, number> = {};
    try {
      const current = window.localStorage.getItem(CART_STORAGE_KEY);
      if (current) cart = sanitizeStoredCart(JSON.parse(current));
      else {
        const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEYS[0]);
        if (legacy) {
          const parsed = JSON.parse(legacy) as { cart?: unknown };
          cart = sanitizeStoredCart(parsed.cart);
        }
      }
    } catch {
      /* ignore corrupt state */
    } finally {
      for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
    }
    setState((current) => ({ ...current, cart }));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
    } catch {
      /* storage full or blocked */
    }
  }, [state.cart, hydrated]);

  const walletKes = useMemo(
    () => state.ledger.reduce((sum, e) => sum + e.amountKes, 0),
    [state.ledger],
  );

  const legCounts = useMemo(() => {
    const active = state.referrals.filter((r) => r.activated);
    return {
      L: active.filter((r) => r.leg === "L").length,
      R: active.filter((r) => r.leg === "R").length,
    };
  }, [state.referrals]);

  /** Releases direct + matching bonuses automatically whenever the tree changes. */
  const settleBonuses = useCallback((next: HiloxsState): HiloxsState => {
    const ledger = [...next.ledger];
    let paidPairs = next.paidPairs;

    for (const ref of next.referrals) {
      if (!ref.activated) continue;
      const already = ledger.some((e) => e.kind === "direct" && e.id === `direct-${ref.id}`);
      if (already) continue;
      ledger.push({
        id: `direct-${ref.id}`,
        kind: "direct",
        label: `Direct referral bonus — ${ref.name} (${ref.leg === "L" ? "Left" : "Right"} leg)`,
        amountKes: PLAN.directReferralKes,
        at: Date.now(),
      });
    }

    const active = next.referrals.filter((r) => r.activated);
    const pairs = Math.min(
      active.filter((r) => r.leg === "L").length,
      active.filter((r) => r.leg === "R").length,
    );
    while (paidPairs < pairs) {
      paidPairs += 1;
      ledger.push({
        id: `pair-${paidPairs}`,
        kind: "pair",
        label: `Matching pair bonus — pair #${paidPairs} (1 left + 1 right)`,
        amountKes: PLAN.pairMatchingKes,
        at: Date.now(),
      });
    }

    return { ...next, ledger, paidPairs };
  }, []);

  const addReferral: Ctx["addReferral"] = useCallback(
    (input) => {
      setState((prev) =>
        settleBonuses({
          ...prev,
          referrals: [
            ...prev.referrals,
            { id: uid(), ...input, activated: false, joinedAt: Date.now() },
          ],
        }),
      );
    },
    [settleBonuses],
  );

  const activateReferral = useCallback(
    (id: string) => {
      setState((prev) =>
        settleBonuses({
          ...prev,
          referrals: prev.referrals.map((r) => (r.id === id ? { ...r, activated: true } : r)),
        }),
      );
    },
    [settleBonuses],
  );

  const activateMember = useCallback((name: string) => {
    setState((prev) => ({
      ...prev,
      member: { ...prev.member, name: name || prev.member.name, activated: true },
      ledger: prev.ledger.some((e) => e.kind === "registration")
        ? prev.ledger
        : [
            {
              id: `reg-${uid()}`,
              kind: "registration",
              label: `Registration fee deducted from the entry package`,
              amountKes: 0,
              at: Date.now(),
            },
            ...prev.ledger,
          ],
    }));
  }, []);

  const saveAccounts = useCallback((accounts: PayoutAccounts) => {
    setState((prev) => ({ ...prev, accounts }));
  }, []);

  const withdraw: Ctx["withdraw"] = useCallback(
    (amountKes, to) => {
      const balance = state.ledger.reduce((s, e) => s + e.amountKes, 0);
      if (amountKes <= 0) return "Enter an amount greater than zero.";
      if (amountKes > balance) return "Amount is higher than your available bonus wallet.";
      const destination =
        to === "paypal"
          ? state.accounts.paypalEmail
          : to === "minipay"
            ? state.accounts.miniPayNumber
            : state.accounts.mpesaNumber;
      if (!destination) return "Add and save that payout account first.";
      setState((prev) => ({
        ...prev,
        ledger: [
          {
            id: `wd-${uid()}`,
            kind: "withdrawal",
            label: `Demo balance reduction to ${to === "paypal" ? "PayPal" : to === "minipay" ? "MiniPay" : "M-Pesa"}; no funds transferred · ${destination}`,
            amountKes: -amountKes,
            at: Date.now(),
          },
          ...prev.ledger,
        ],
      }));
      return null;
    },
    [state.accounts, state.ledger],
  );

  const addToCart = useCallback((productId: string, qty = 1) => {
    setState((prev) => ({
      ...prev,
      cart: { ...prev.cart, [productId]: (prev.cart[productId] ?? 0) + qty },
    }));
  }, []);

  const setCartQty = useCallback((productId: string, qty: number) => {
    setState((prev) => {
      const cart = { ...prev.cart };
      if (qty <= 0) delete cart[productId];
      else cart[productId] = qty;
      return { ...prev, cart };
    });
  }, []);

  const clearCart = useCallback(() => setState((prev) => ({ ...prev, cart: {} })), []);

  const recordTrade = useCallback((trade: Trade) => {
    setState((prev) => ({
      ...prev,
      trades: [trade, ...prev.trades].slice(0, 40),
      demoBalanceUsd: prev.demoBalanceUsd - trade.stakeUsd,
    }));
  }, []);

  const settleTrade = useCallback((id: string, exit: number) => {
    setState((prev) => {
      const trade = prev.trades.find((t) => t.id === id);
      if (!trade || trade.result) return prev;
      const marketWin = trade.direction === "UP" ? exit > trade.entry : exit < trade.entry;
      const win = marketWin;
      const payoutUsd = win ? trade.stakeUsd * DEMO_TRADING_PAYOUT_RATE : 0;
      return {
        ...prev,
        demoBalanceUsd: prev.demoBalanceUsd + payoutUsd,
        paybillFloatUsd: win
          ? prev.paybillFloatUsd - (payoutUsd - trade.stakeUsd)
          : prev.paybillFloatUsd + trade.stakeUsd,
        trades: prev.trades.map((t) =>
          t.id === id ? { ...t, exit, result: win ? "WIN" : "LOSS", payoutUsd } : t,
        ),
      };
    });
  }, []);

  const withdrawTrading: Ctx["withdrawTrading"] = useCallback(
    (amountUsd, to) => {
      if (!amountUsd || amountUsd <= 0) return "Enter an amount greater than zero.";
      if (amountUsd > state.demoBalanceUsd) return "Amount is higher than your trading balance.";
      const destination =
        to === "paypal"
          ? state.accounts.paypalEmail
          : to === "minipay"
            ? state.accounts.miniPayNumber
            : state.accounts.mpesaNumber;
      if (!destination) return "Save that payout account on the Binary Plan page first.";
      setState((prev) => ({
        ...prev,
        demoBalanceUsd: prev.demoBalanceUsd - amountUsd,
        ledger: [
          {
            id: `tw-${uid()}`,
            kind: "trading",
            label: `Demo trading balance reduction to ${to === "paypal" ? "PayPal" : to === "minipay" ? "MiniPay" : "M-Pesa"}; no funds transferred · ${destination}`,
            amountKes: 0,
            at: Date.now(),
          },
          ...prev.ledger,
        ],
      }));
      return null;
    },
    [state.accounts, state.demoBalanceUsd],
  );

  const addVideo: Ctx["addVideo"] = useCallback((input) => {
    const id = parseYouTubeId(input.url);
    if (!input.title.trim()) return "Give the video a title.";
    if (!id) return "That does not look like a YouTube link or video ID.";
    setState((prev) => ({
      ...prev,
      videos: [
        {
          id: uid(),
          title: input.title.trim(),
          level: input.level,
          youtubeId: id,
          url: input.url.trim(),
          at: Date.now(),
        },
        ...prev.videos,
      ],
    }));
    return null;
  }, []);

  const removeVideo = useCallback((id: string) => {
    setState((prev) => ({ ...prev, videos: prev.videos.filter((v) => v.id !== id) }));
  }, []);

  const value: Ctx = {
    state,
    hydrated,
    walletKes,
    legCounts,
    addReferral,
    activateReferral,
    activateMember,
    saveAccounts,
    withdraw,
    addToCart,
    setCartQty,
    clearCart,
    recordTrade,
    settleTrade,
    withdrawTrading,
    addVideo,
    removeVideo,
  };

  return <HiloxsContext.Provider value={value}>{children}</HiloxsContext.Provider>;
}

function sanitizeStoredCart(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([productId, quantity]) =>
        /^[a-z0-9-]{1,80}$/i.test(productId) &&
        typeof quantity === "number" &&
        Number.isInteger(quantity) &&
        quantity > 0 &&
        quantity <= 99,
    ),
  );
}
