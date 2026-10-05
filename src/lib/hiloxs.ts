// HILOXS core domain constants, catalog and helpers.

export const KES_PER_USD = 130;
export const DEMO_TRADING_PAYOUT_RATE = 1.85;

export const kesToUsd = (kes: number) => kes / KES_PER_USD;

export const usd = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const kes = (value: number) => `KSh ${Math.round(value).toLocaleString("en-KE")}`;

/** Money shown as USD with the KES original in brackets. */
export const dual = (kesAmount: number) => `${usd(kesToUsd(kesAmount))} (${kes(kesAmount)})`;

export const PLAN = {
  entryPackageKes: 25_000,
  registrationFeeKes: 3_000,
  directReferralKes: 4_000,
  pairMatchingKes: 2_000,
} as const;

export const PLAN_USD = {
  entryPackage: kesToUsd(PLAN.entryPackageKes),
  registrationFee: kesToUsd(PLAN.registrationFeeKes),
  directReferral: kesToUsd(PLAN.directReferralKes),
  pairMatching: kesToUsd(PLAN.pairMatchingKes),
  netToProfit: kesToUsd(PLAN.entryPackageKes - PLAN.registrationFeeKes),
};

export const SHOP_CATEGORIES = [
  "Laptops",
  "Screens",
  "Woofers",
  "Accessories",
  "Phones & Tablets",
  "Home & Kitchen",
  "Fashion",
  "Beauty & Health",
  "School & Office",
  "Groceries",
  "Sports & Outdoors",
] as const;

export type ShopCategory = (typeof SHOP_CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<ShopCategory, string> = {
  Laptops: "💻",
  Screens: "🖥️",
  Woofers: "🔊",
  Accessories: "🔌",
  "Phones & Tablets": "📱",
  "Home & Kitchen": "🍳",
  Fashion: "👗",
  "Beauty & Health": "💄",
  "School & Office": "🎒",
  Groceries: "🛒",
  "Sports & Outdoors": "⚽",
};

export type Product = {
  id: string;
  name: string;
  category: ShopCategory;
  priceKes: number;
  blurb: string;
  emoji: string;
  images?: ProductImage[];
};

export type ProductImage = {
  src: string;
  alt: string;
};

export function productSlug(product: Pick<Product, "name">): string {
  return product.name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function productImages(product: Product): ProductImage[] {
  if (product.images?.length) return product.images;
  const legacyImage = (product as Product & { image?: string }).image;
  return legacyImage ? [{ src: legacyImage, alt: `${product.name} product photo` }] : [];
}

export const CATEGORIES = ["All", ...SHOP_CATEGORIES] as const;

export type TrainingTrack = "Binary Network Marketing" | "Trading" | "Shopping" | "Getting Started";

export const TRACKS: TrainingTrack[] = [
  "Binary Network Marketing",
  "Trading",
  "Shopping",
  "Getting Started",
];

export const SUPPORT = {
  hours: "Mon–Sat, 8am–7pm EAT",
  email: "help@hiloxs.com",
  phone: "+254 727 375 963",
  phoneHref: "+254727375963",
};
