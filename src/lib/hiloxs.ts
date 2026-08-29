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

export const ELECTRONIC_CATEGORIES = ["Laptops", "Screens", "Woofers", "Accessories"] as const;

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
  oldPriceKes?: number;
  rating: number;
  sold: number;
  blurb: string;
  emoji: string;
  badge?: "FLASH SALE" | "BEST SELLER" | "HOT DEAL" | "TOP RATED";
};

export const PRODUCTS: Product[] = [
  {
    id: "lp-01",
    name: "HP EliteBook 840 G8 · i7 16GB/512GB",
    category: "Laptops",
    priceKes: 78_500,
    oldPriceKes: 92_000,
    rating: 4.8,
    sold: 312,
    blurb: 'Business ultrabook, backlit keyboard, 14" FHD.',
    emoji: "💻",
  },
  {
    id: "lp-02",
    name: "Dell Latitude 5420 · i5 8GB/256GB",
    category: "Laptops",
    priceKes: 52_000,
    oldPriceKes: 61_000,
    rating: 4.6,
    sold: 540,
    blurb: "Reliable daily driver for school and office.",
    emoji: "💻",
  },
  {
    id: "lp-03",
    name: "Lenovo ThinkPad X1 Carbon Gen 9",
    category: "Laptops",
    priceKes: 118_000,
    rating: 4.9,
    sold: 96,
    blurb: "Carbon-fibre flagship, 1.1kg, 16GB RAM.",
    emoji: "💻",
  },
  {
    id: "lp-04",
    name: "MacBook Air M2 · 8GB/256GB",
    category: "Laptops",
    priceKes: 152_000,
    oldPriceKes: 168_000,
    rating: 4.9,
    sold: 141,
    blurb: "All-day battery, silent fanless design.",
    emoji: "💻",
  },
  {
    id: "sc-01",
    name: 'Samsung 55" Crystal UHD 4K Smart TV',
    category: "Screens",
    priceKes: 62_900,
    oldPriceKes: 74_000,
    rating: 4.7,
    sold: 233,
    blurb: "HDR10+, Tizen apps, voice remote.",
    emoji: "📺",
  },
  {
    id: "sc-02",
    name: 'LG UltraGear 27" 165Hz Gaming Monitor',
    category: "Screens",
    priceKes: 41_500,
    rating: 4.8,
    sold: 187,
    blurb: "1ms IPS, G-Sync compatible, height adjust.",
    emoji: "🖥️",
  },
  {
    id: "sc-03",
    name: 'Dell P2422H 24" IPS Office Monitor',
    category: "Screens",
    priceKes: 23_900,
    oldPriceKes: 27_500,
    rating: 4.5,
    sold: 402,
    blurb: "Flicker-free, pivot stand, HDMI + DP.",
    emoji: "🖥️",
  },
  {
    id: "sc-04",
    name: 'Hisense 43" Smart Frameless TV',
    category: "Screens",
    priceKes: 34_800,
    rating: 4.4,
    sold: 615,
    blurb: "Netflix & YouTube built in, bezel-less.",
    emoji: "📺",
  },
  {
    id: "wf-01",
    name: "JBL Bar 5.1 Soundbar + Wireless Woofer",
    category: "Woofers",
    priceKes: 89_000,
    oldPriceKes: 99_500,
    rating: 4.8,
    sold: 88,
    blurb: "550W, detachable surround speakers.",
    emoji: "🔊",
  },
  {
    id: "wf-02",
    name: "Sony SA-SW3 200W Active Subwoofer",
    category: "Woofers",
    priceKes: 46_500,
    rating: 4.6,
    sold: 130,
    blurb: "Deep bass module for home theatre.",
    emoji: "🔊",
  },
  {
    id: "wf-03",
    name: "Vitron 3.1CH Home Theatre Woofer",
    category: "Woofers",
    priceKes: 18_900,
    oldPriceKes: 22_000,
    rating: 4.3,
    sold: 921,
    blurb: "Bluetooth, USB, FM — the estate favourite.",
    emoji: "🔊",
  },
  {
    id: "wf-04",
    name: "Edifier R1280DB Studio Monitors",
    category: "Woofers",
    priceKes: 21_400,
    rating: 4.7,
    sold: 264,
    blurb: "Bookshelf pair with optical + Bluetooth.",
    emoji: "🔉",
  },
  {
    id: "ac-01",
    name: "Anker 65W GaN Charger + USB-C Cable",
    category: "Accessories",
    priceKes: 4_900,
    rating: 4.7,
    sold: 1_204,
    blurb: "Charges laptop and phone from one brick.",
    emoji: "🔌",
  },
  {
    id: "ac-02",
    name: "Logitech MX Keys S Wireless Keyboard",
    category: "Accessories",
    priceKes: 13_500,
    oldPriceKes: 15_900,
    rating: 4.8,
    sold: 176,
    blurb: "Backlit, multi-device, USB-C.",
    emoji: "⌨️",
  },
  {
    id: "ac-03",
    name: "1500VA Line-Interactive UPS",
    category: "Accessories",
    priceKes: 16_800,
    rating: 4.5,
    sold: 340,
    blurb: "Keeps the shop running through blackouts.",
    emoji: "🔋",
  },
  {
    id: "ac-04",
    name: "HDMI 2.1 8K Braided Cable · 3m",
    category: "Accessories",
    priceKes: 2_300,
    rating: 4.4,
    sold: 2_010,
    blurb: "48Gbps for screens and consoles.",
    emoji: "🧵",
  },

  {
    id: "ph-01",
    name: "20000mAh Fast Power Bank",
    category: "Phones & Tablets",
    priceKes: 2_199,
    oldPriceKes: 3_499,
    rating: 4.5,
    sold: 533,
    blurb: "22.5W fast charge, triple output.",
    emoji: "🔋",
    badge: "BEST SELLER",
  },
  {
    id: "ph-02",
    name: 'Smart 6.7" Android Phone 128GB',
    category: "Phones & Tablets",
    priceKes: 18_499,
    oldPriceKes: 24_999,
    rating: 4.4,
    sold: 812,
    blurb: "5000mAh battery, 50MP camera.",
    emoji: "📱",
    badge: "HOT DEAL",
  },
  {
    id: "ph-03",
    name: "AirPulse Wireless Earbuds",
    category: "Phones & Tablets",
    priceKes: 3_499,
    oldPriceKes: 5_999,
    rating: 4.5,
    sold: 780,
    blurb: "ENC calls, 30h case, USB-C.",
    emoji: "🎧",
    badge: "FLASH SALE",
  },
  {
    id: "ph-04",
    name: '10" Kids Learning Tablet',
    category: "Phones & Tablets",
    priceKes: 12_999,
    oldPriceKes: 16_500,
    rating: 4.3,
    sold: 288,
    blurb: "Parental controls and a tough case.",
    emoji: "📲",
  },

  {
    id: "hk-01",
    name: "6L Digital Air Fryer",
    category: "Home & Kitchen",
    priceKes: 7_499,
    oldPriceKes: 11_999,
    rating: 4.7,
    sold: 932,
    blurb: "8 presets, non-stick basket.",
    emoji: "🍟",
    badge: "BEST SELLER",
  },
  {
    id: "hk-02",
    name: "Non-Stick Cookware Set · 7pc",
    category: "Home & Kitchen",
    priceKes: 4_899,
    oldPriceKes: 7_200,
    rating: 4.5,
    sold: 1_140,
    blurb: "Pots, pans and glass lids.",
    emoji: "🍳",
  },
  {
    id: "hk-03",
    name: "Stainless Steel Cutlery 24pc",
    category: "Home & Kitchen",
    priceKes: 1_899,
    oldPriceKes: 2_800,
    rating: 4.4,
    sold: 2_310,
    blurb: "Rust-free family set.",
    emoji: "🍴",
  },
  {
    id: "hk-04",
    name: "2L Electric Kettle · Cordless",
    category: "Home & Kitchen",
    priceKes: 2_299,
    oldPriceKes: 3_400,
    rating: 4.6,
    sold: 1_505,
    blurb: "Auto shut-off, fast boil.",
    emoji: "🫖",
    badge: "HOT DEAL",
  },

  {
    id: "fa-01",
    name: "Men's Classic Polo Shirt",
    category: "Fashion",
    priceKes: 1_299,
    oldPriceKes: 1_999,
    rating: 4.3,
    sold: 1_920,
    blurb: "Breathable cotton pique.",
    emoji: "👕",
  },
  {
    id: "fa-02",
    name: "Urban Canvas Sneakers",
    category: "Fashion",
    priceKes: 3_299,
    oldPriceKes: 4_999,
    rating: 4.2,
    sold: 410,
    blurb: "Everyday street sneakers.",
    emoji: "👟",
  },
  {
    id: "fa-03",
    name: "Ladies Ankara Maxi Dress",
    category: "Fashion",
    priceKes: 2_499,
    oldPriceKes: 3_800,
    rating: 4.6,
    sold: 622,
    blurb: "Vibrant print, all sizes.",
    emoji: "👗",
    badge: "TOP RATED",
  },
  {
    id: "fa-04",
    name: "Minimalist Steel Watch",
    category: "Fashion",
    priceKes: 2_899,
    oldPriceKes: 4_800,
    rating: 4.5,
    sold: 224,
    blurb: "Sapphire-look glass, 3ATM.",
    emoji: "⌚",
    badge: "FLASH SALE",
  },

  {
    id: "bh-01",
    name: "Vitamin C Brightening Serum",
    category: "Beauty & Health",
    priceKes: 1_499,
    oldPriceKes: 2_400,
    rating: 4.5,
    sold: 382,
    blurb: "30ml, hyaluronic blend.",
    emoji: "🧴",
  },
  {
    id: "bh-02",
    name: "Shea & Argan Body Butter",
    category: "Beauty & Health",
    priceKes: 999,
    oldPriceKes: 1_599,
    rating: 4.7,
    sold: 640,
    blurb: "Deep moisture, natural.",
    emoji: "🧈",
  },
  {
    id: "bh-03",
    name: "Digital Bathroom Scale",
    category: "Beauty & Health",
    priceKes: 1_799,
    oldPriceKes: 2_600,
    rating: 4.4,
    sold: 355,
    blurb: "Tempered glass, 180kg.",
    emoji: "⚖️",
  },
  {
    id: "bh-04",
    name: "Rechargeable Hair Clipper",
    category: "Beauty & Health",
    priceKes: 2_450,
    oldPriceKes: 3_600,
    rating: 4.3,
    sold: 470,
    blurb: "Cordless, 8 guards.",
    emoji: "💈",
  },

  {
    id: "so-01",
    name: "School Backpack · Waterproof",
    category: "School & Office",
    priceKes: 1_650,
    oldPriceKes: 2_500,
    rating: 4.5,
    sold: 1_733,
    blurb: "Padded laptop sleeve.",
    emoji: "🎒",
    badge: "BEST SELLER",
  },
  {
    id: "so-02",
    name: "A4 Exercise Books · 10 pack",
    category: "School & Office",
    priceKes: 780,
    oldPriceKes: 1_100,
    rating: 4.6,
    sold: 3_420,
    blurb: "200 pages, squared or ruled.",
    emoji: "📚",
  },
  {
    id: "so-03",
    name: "Scientific Calculator FX-991",
    category: "School & Office",
    priceKes: 1_450,
    oldPriceKes: 2_100,
    rating: 4.8,
    sold: 890,
    blurb: "417 functions, exam ready.",
    emoji: "🧮",
  },
  {
    id: "so-04",
    name: "Office Desk Organiser Set",
    category: "School & Office",
    priceKes: 1_250,
    rating: 4.2,
    sold: 265,
    blurb: "Trays, pen pots and file rack.",
    emoji: "🗂️",
  },

  {
    id: "gr-01",
    name: "Premium AA Arabica Coffee 1kg",
    category: "Groceries",
    priceKes: 1_899,
    oldPriceKes: 2_600,
    rating: 4.8,
    sold: 256,
    blurb: "Roasted beans, Kenyan grown.",
    emoji: "☕",
    badge: "TOP RATED",
  },
  {
    id: "gr-02",
    name: "Sunflower Cooking Oil 5L",
    category: "Groceries",
    priceKes: 1_450,
    oldPriceKes: 1_890,
    rating: 4.4,
    sold: 4_120,
    blurb: "Cholesterol free, family size.",
    emoji: "🛢️",
  },
  {
    id: "gr-03",
    name: "Long Grain Pishori Rice 5kg",
    category: "Groceries",
    priceKes: 1_290,
    oldPriceKes: 1_650,
    rating: 4.7,
    sold: 2_870,
    blurb: "Aromatic Mwea rice.",
    emoji: "🍚",
  },
  {
    id: "gr-04",
    name: "Assorted Spice Rack 12 jars",
    category: "Groceries",
    priceKes: 1_150,
    rating: 4.3,
    sold: 505,
    blurb: "Everyday kitchen spices.",
    emoji: "🧂",
  },

  {
    id: "sp-01",
    name: "Adjustable Dumbbell Set 20kg",
    category: "Sports & Outdoors",
    priceKes: 6_900,
    oldPriceKes: 9_500,
    rating: 4.6,
    sold: 318,
    blurb: "Home gym starter kit.",
    emoji: "🏋️",
  },
  {
    id: "sp-02",
    name: "Size 5 Match Football",
    category: "Sports & Outdoors",
    priceKes: 1_350,
    oldPriceKes: 1_900,
    rating: 4.4,
    sold: 1_460,
    blurb: "Hand-stitched, all surfaces.",
    emoji: "⚽",
  },
  {
    id: "sp-03",
    name: "6mm Yoga Mat + Strap",
    category: "Sports & Outdoors",
    priceKes: 1_690,
    oldPriceKes: 2_400,
    rating: 4.5,
    sold: 720,
    blurb: "Non-slip, easy to roll.",
    emoji: "🧘",
  },
  {
    id: "sp-04",
    name: "4-Person Camping Tent",
    category: "Sports & Outdoors",
    priceKes: 7_800,
    oldPriceKes: 10_500,
    rating: 4.3,
    sold: 141,
    blurb: "Waterproof, quick pitch.",
    emoji: "⛺",
    badge: "HOT DEAL",
  },
];

export const ELECTRONICS_PRODUCTS = PRODUCTS.filter((p) =>
  (ELECTRONIC_CATEGORIES as readonly string[]).includes(p.category),
);

export const CATEGORIES = ["All", ...SHOP_CATEGORIES] as const;

export const discountPct = (p: Product) =>
  p.oldPriceKes ? Math.round((1 - p.priceKes / p.oldPriceKes) * 100) : 0;

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
  {
    id: "t1",
    title: "HILOXS Binary Plan explained on a whiteboard",
    track: "Binary Network Marketing",
    youtubeId: "dQw4w9WgXcQ",
    duration: "18:42",
    summary:
      "How the left and right legs fill up, what counts as a pair, and when the matching bonus releases.",
  },
  {
    id: "t2",
    title: "Registering your first two referrals correctly",
    track: "Binary Network Marketing",
    youtubeId: "dQw4w9WgXcQ",
    duration: "11:05",
    summary:
      "Live walkthrough of the referral form, leg placement and the KSh 8,000 first-pair payout.",
  },
  {
    id: "t3",
    title: "Withdrawing to PayPal, MiniPay and M-Pesa",
    track: "Binary Network Marketing",
    youtubeId: "dQw4w9WgXcQ",
    duration: "09:31",
    summary: "Linking payout accounts under your own name and cashing out safely.",
  },
  {
    id: "t4",
    title: "Reading candlesticks before an expiry",
    track: "Trading",
    youtubeId: "dQw4w9WgXcQ",
    duration: "22:18",
    summary: "Wicks, bodies and momentum — how I decide UP or DOWN on the demo desk.",
  },
  {
    id: "t5",
    title: "Choosing expiry timers that fit your setup",
    track: "Trading",
    youtubeId: "dQw4w9WgXcQ",
    duration: "14:50",
    summary: "30s vs 5m: matching the timer to the market movement you actually see.",
  },
  {
    id: "t6",
    title: "Risk rules I never break",
    track: "Trading",
    youtubeId: "dQw4w9WgXcQ",
    duration: "16:07",
    summary: "Stake sizing, daily stop, and why demo comes before anything else.",
  },
  {
    id: "t7",
    title: "Sourcing electronics that actually resell",
    track: "Shopping",
    youtubeId: "dQw4w9WgXcQ",
    duration: "13:22",
    summary: "Picking laptops, screens and woofers buyers keep coming back for.",
  },
  {
    id: "t8",
    title: "Ordering, delivery and till payments",
    track: "Shopping",
    youtubeId: "dQw4w9WgXcQ",
    duration: "07:44",
    summary: "Checkout end-to-end, tracking your order and paying to the HILOXS till.",
  },
  {
    id: "t9",
    title: "Your first 7 days on HILOXS",
    track: "Getting Started",
    youtubeId: "dQw4w9WgXcQ",
    duration: "20:03",
    summary: "Activate, learn, refer, trade — the exact order I recommend.",
  },
];

export const TRACKS: TrainingTrack[] = [
  "Binary Network Marketing",
  "Trading",
  "Shopping",
  "Getting Started",
];

/** Every payment in or out of HILOXS runs through this single Buy Goods till. */
export const MERCHANT_NAME = "HILOXS";
export const TILL_NUMBER = "1628777";
export const TILL_LABEL = "HILOXS Buy Goods Till";
/** What a client sees on the M-Pesa prompt / receipt. */
export const TILL_DISPLAY = `${MERCHANT_NAME} · Buy Goods Till ${TILL_NUMBER}`;

export const SUPPORT = {
  hours: "Mon–Sat, 8am–7pm EAT",
  email: "help@hiloxs.com",
  phone: "+254 727 375 963",
  phoneHref: "+254727375963",
};
