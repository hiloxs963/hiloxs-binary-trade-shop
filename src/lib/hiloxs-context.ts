import { createContext, useContext } from "react";
import type { Product, ShopCategory } from "./hiloxs";
import type {
  AdminTrading,
  CustomProduct,
  HiloxsState,
  Leg,
  Order,
  PayoutAccounts,
  TrainingLevel,
  Trade,
} from "./hiloxs-store";

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
  checkout: (method: Order["method"]) => Order | null;
  recordTrade: (trade: Trade) => void;
  settleTrade: (id: string, exit: number) => void;
  setAdmin: (patch: Partial<AdminTrading>) => void;
  withdrawTrading: (amountUsd: number, to: "paypal" | "minipay" | "mpesa") => string | null;
  addVideo: (input: { title: string; level: TrainingLevel; url: string }) => string | null;
  removeVideo: (id: string) => void;
  addProduct: (input: {
    name: string;
    category: ShopCategory;
    priceKes: number;
    oldPriceKes?: number;
    reviews: number;
    blurb: string;
    image?: string;
    badge?: Product["badge"];
  }) => string | null;
  removeProduct: (id: string) => void;
  allProducts: Product[];
};

export const HiloxsContext = createContext<HiloxsContextValue | null>(null);

export function useHiloxs() {
  const ctx = useContext(HiloxsContext);
  if (!ctx) throw new Error("useHiloxs must be used inside HiloxsProvider");
  return ctx;
}
