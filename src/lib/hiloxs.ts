// HILOXS core domain constants, catalog and helpers.

export const KES_PER_USD = 130;

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

export type Product = {
  id: string;
  name: string;
  category: "Laptops" | "Screens" | "Woofers" | "Accessories";
  priceKes: number;
  oldPriceKes?: number;
  rating: number;
  sold: number;
  blurb: string;
  emoji: string;
};

export const PRODUCTS: Product[] = [
  { id: "lp-01", name: "HP EliteBook 840 G8 · i7 16GB/512GB", category: "Laptops", priceKes: 78_500, oldPriceKes: 92_000, rating: 4.8, sold: 312, blurb: "Business ultrabook, backlit keyboard, 14\" FHD.", emoji: "💻" },
  { id: "lp-02", name: "Dell Latitude 5420 · i5 8GB/256GB", category: "Laptops", priceKes: 52_000, oldPriceKes: 61_000, rating: 4.6, sold: 540, blurb: "Reliable daily driver for school and office.", emoji: "💻" },
  { id: "lp-03", name: "Lenovo ThinkPad X1 Carbon Gen 9", category: "Laptops", priceKes: 118_000, rating: 4.9, sold: 96, blurb: "Carbon-fibre flagship, 1.1kg, 16GB RAM.", emoji: "💻" },
  { id: "lp-04", name: "MacBook Air M2 · 8GB/256GB", category: "Laptops", priceKes: 152_000, oldPriceKes: 168_000, rating: 4.9, sold: 141, blurb: "All-day battery, silent fanless design.", emoji: "💻" },
  { id: "sc-01", name: 'Samsung 55" Crystal UHD 4K Smart TV', category: "Screens", priceKes: 62_900, oldPriceKes: 74_000, rating: 4.7, sold: 233, blurb: "HDR10+, Tizen apps, voice remote.", emoji: "📺" },
  { id: "sc-02", name: 'LG UltraGear 27" 165Hz Gaming Monitor', category: "Screens", priceKes: 41_500, rating: 4.8, sold: 187, blurb: "1ms IPS, G-Sync compatible, height adjust.", emoji: "🖥️" },
  { id: "sc-03", name: 'Dell P2422H 24" IPS Office Monitor', category: "Screens", priceKes: 23_900, oldPriceKes: 27_500, rating: 4.5, sold: 402, blurb: "Flicker-free, pivot stand, HDMI + DP.", emoji: "🖥️" },
  { id: "sc-04", name: 'Hisense 43" Smart Frameless TV', category: "Screens", priceKes: 34_800, rating: 4.4, sold: 615, blurb: "Netflix & YouTube built in, bezel-less.", emoji: "📺" },
  { id: "wf-01", name: "JBL Bar 5.1 Soundbar + Wireless Woofer", category: "Woofers", priceKes: 89_000, oldPriceKes: 99_500, rating: 4.8, sold: 88, blurb: "550W, detachable surround speakers.", emoji: "🔊" },
  { id: "wf-02", name: 'Sony SA-SW3 200W Active Subwoofer', category: "Woofers", priceKes: 46_500, rating: 4.6, sold: 130, blurb: "Deep bass module for home theatre.", emoji: "🔊" },
  { id: "wf-03", name: "Vitron 3.1CH Home Theatre Woofer", category: "Woofers", priceKes: 18_900, oldPriceKes: 22_000, rating: 4.3, sold: 921, blurb: "Bluetooth, USB, FM — the estate favourite.", emoji: "🔊" },
  { id: "wf-04", name: "Edifier R1280DB Studio Monitors", category: "Woofers", priceKes: 21_400, rating: 4.7, sold: 264, blurb: "Bookshelf pair with optical + Bluetooth.", emoji: "🔉" },
  { id: "ac-01", name: "Anker 65W GaN Charger + USB-C Cable", category: "Accessories", priceKes: 4_900, rating: 4.7, sold: 1_204, blurb: "Charges laptop and phone from one brick.", emoji: "🔌" },
  { id: "ac-02", name: "Logitech MX Keys S Wireless Keyboard", category: "Accessories", priceKes: 13_500, oldPriceKes: 15_900, rating: 4.8, sold: 176, blurb: "Backlit, multi-device, USB-C.", emoji: "⌨️" },
  { id: "ac-03", name: "1500VA Line-Interactive UPS", category: "Accessories", priceKes: 16_800, rating: 4.5, sold: 340, blurb: "Keeps the shop running through blackouts.", emoji: "🔋" },
  { id: "ac-04", name: "HDMI 2.1 8K Braided Cable · 3m", category: "Accessories", priceKes: 2_300, rating: 4.4, sold: 2_010, blurb: "48Gbps for screens and consoles.", emoji: "🧵" },
];

export const CATEGORIES = ["All", "Laptops", "Screens", "Woofers", "Accessories"] as const;

export type TrainingTrack = "Binary Network Marketing" | "Trading" | "Shopping" | "Getting Started";

export type Training = {
  id: string;
  title: string;
  track: TrainingTrack;
  youtubeId: string;
  duration: string;
  summary: string;
};

/** Replace youtubeId with your own uploads — the player reads it directly. */
export const TRAININGS: Training[] = [
  { id: "t1", title: "HILOXS Binary Plan explained on a whiteboard", track: "Binary Network Marketing", youtubeId: "dQw4w9WgXcQ", duration: "18:42", summary: "How the left and right legs fill up, what counts as a pair, and when the matching bonus releases." },
  { id: "t2", title: "Registering your first two referrals correctly", track: "Binary Network Marketing", youtubeId: "dQw4w9WgXcQ", duration: "11:05", summary: "Live walkthrough of the referral form, leg placement and the KSh 8,000 first-pair payout." },
  { id: "t3", title: "Withdrawing to PayPal, MiniPay and M-Pesa", track: "Binary Network Marketing", youtubeId: "dQw4w9WgXcQ", duration: "09:31", summary: "Linking payout accounts under your own name and cashing out safely." },
  { id: "t4", title: "Reading candlesticks before an expiry", track: "Trading", youtubeId: "dQw4w9WgXcQ", duration: "22:18", summary: "Wicks, bodies and momentum — how I decide UP or DOWN on the demo desk." },
  { id: "t5", title: "Choosing expiry timers that fit your setup", track: "Trading", youtubeId: "dQw4w9WgXcQ", duration: "14:50", summary: "30s vs 5m: matching the timer to the market movement you actually see." },
  { id: "t6", title: "Risk rules I never break", track: "Trading", youtubeId: "dQw4w9WgXcQ", duration: "16:07", summary: "Stake sizing, daily stop, and why demo comes before anything else." },
  { id: "t7", title: "Sourcing electronics that actually resell", track: "Shopping", youtubeId: "dQw4w9WgXcQ", duration: "13:22", summary: "Picking laptops, screens and woofers buyers keep coming back for." },
  { id: "t8", title: "Ordering, delivery and till payments", track: "Shopping", youtubeId: "dQw4w9WgXcQ", duration: "07:44", summary: "Checkout end-to-end, tracking your order and paying to the HILOXS till." },
  { id: "t9", title: "Your first 7 days on HILOXS", track: "Getting Started", youtubeId: "dQw4w9WgXcQ", duration: "20:03", summary: "Activate, learn, refer, trade — the exact order I recommend." },
];

export const TRACKS: TrainingTrack[] = [
  "Binary Network Marketing",
  "Trading",
  "Shopping",
  "Getting Started",
];

/** Till number placeholder — replace once your Buy Goods till is live. */
export const TILL_NUMBER: string | null = null;
export const TILL_LABEL = "HILOXS Buy Goods Till";