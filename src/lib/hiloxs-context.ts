import { createContext, useContext } from "react";
import type { HiloxsState, Leg, PayoutAccounts, TrainingLevel, Trade } from "./hiloxs-store";

export type HiloxsContextValue = {
  state: HiloxsState;
  hydrated: boolean;
  walletKes: number;
  legCounts: { L: number; R: number };
  addReferral: (input: { name: string; phone: string; leg: Leg; parentId: string | null }) => void;
  activateReferral: (id: string) => void;
  activateMember: (name: string) => void;
  saveAccounts: (accounts: PayoutAccounts) => void;
  withdraw: (amountKes: number, to: "paypal" | "minipay" | "mpesa") => string | null;
  addToCart: (productId: string, qty?: number) => void;
  setCartQty: (productId: string, qty: number) => void;
  clearCart: () => void;
  recordTrade: (trade: Trade) => void;
  settleTrade: (id: string, exit: number) => void;
  withdrawTrading: (amountUsd: number, to: "paypal" | "minipay" | "mpesa") => string | null;
  addVideo: (input: { title: string; level: TrainingLevel; url: string }) => string | null;
  removeVideo: (id: string) => void;
};

export const HiloxsContext = createContext<HiloxsContextValue | null>(null);

export function useHiloxs() {
  const ctx = useContext(HiloxsContext);
  if (!ctx) throw new Error("useHiloxs must be used inside HiloxsProvider");
  return ctx;
}
