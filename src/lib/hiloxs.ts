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

export function findProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((product) => productSlug(product) === slug);
}

export const PRODUCTS: Product[] = [
  {
    id: "lp-01",
    name: "HP EliteBook 840 G8 · i7 16GB/512GB",
    category: "Laptops",
    priceKes: 78_500,
    blurb: 'Business ultrabook, backlit keyboard, 14" FHD.',
    emoji: "💻",
  },
  {
    id: "lp-02",
    name: "Dell Latitude 5420 · i5 8GB/256GB",
    category: "Laptops",
    priceKes: 52_000,
    blurb: "Reliable daily driver for school and office.",
    emoji: "💻",
  },
  {
    id: "lp-03",
    name: "Lenovo ThinkPad X1 Carbon Gen 9",
    category: "Laptops",
    priceKes: 118_000,
    blurb: "Carbon-fibre flagship, 1.1kg, 16GB RAM.",
    emoji: "💻",
  },
  {
    id: "lp-04",
    name: "MacBook Air M2 · 8GB/256GB",
    category: "Laptops",
    priceKes: 152_000,
    blurb: "All-day battery, silent fanless design.",
    emoji: "💻",
  },
  {
    id: "sc-01",
    name: 'Samsung 55" Crystal UHD 4K Smart TV',
    category: "Screens",
    priceKes: 62_900,
    blurb: "HDR10+, Tizen apps, voice remote.",
    emoji: "📺",
  },
  {
    id: "sc-02",
    name: 'LG UltraGear 27" 165Hz Gaming Monitor',
    category: "Screens",
    priceKes: 41_500,
    blurb: "1ms IPS, G-Sync compatible, height adjust.",
    emoji: "🖥️",
  },
  {
    id: "sc-03",
    name: 'Dell P2422H 24" IPS Office Monitor',
    category: "Screens",
    priceKes: 23_900,
    blurb: "Flicker-free, pivot stand, HDMI + DP.",
    emoji: "🖥️",
  },
  {
    id: "sc-04",
    name: 'Hisense 43" Smart Frameless TV',
    category: "Screens",
    priceKes: 34_800,
    blurb: "Netflix & YouTube built in, bezel-less.",
    emoji: "📺",
  },
  {
    id: "wf-01",
    name: "JBL Bar 5.1 Soundbar + Wireless Woofer",
    category: "Woofers",
    priceKes: 89_000,
    blurb: "550W, detachable surround speakers.",
    emoji: "🔊",
  },
  {
    id: "wf-02",
    name: "Sony SA-SW3 200W Active Subwoofer",
    category: "Woofers",
    priceKes: 46_500,
    blurb: "Deep bass module for home theatre.",
    emoji: "🔊",
  },
  {
    id: "wf-03",
    name: "Vitron 3.1CH Home Theatre Woofer",
    category: "Woofers",
    priceKes: 18_900,
    blurb: "Bluetooth, USB, FM — the estate favourite.",
    emoji: "🔊",
  },
  {
    id: "wf-04",
    name: "Edifier R1280DB Studio Monitors",
    category: "Woofers",
    priceKes: 21_400,
    blurb: "Bookshelf pair with optical + Bluetooth.",
    emoji: "🔉",
  },
  {
    id: "ac-01",
    name: "Anker 65W GaN Charger + USB-C Cable",
    category: "Accessories",
    priceKes: 4_900,
    blurb: "Charges laptop and phone from one brick.",
    emoji: "🔌",
  },
  {
    id: "ac-02",
    name: "Logitech MX Keys S Wireless Keyboard",
    category: "Accessories",
    priceKes: 13_500,
    blurb: "Backlit, multi-device, USB-C.",
    emoji: "⌨️",
  },
  {
    id: "ac-03",
    name: "1500VA Line-Interactive UPS",
    category: "Accessories",
    priceKes: 16_800,
    blurb: "Keeps the shop running through blackouts.",
    emoji: "🔋",
  },
  {
    id: "ac-04",
    name: "HDMI 2.1 8K Braided Cable · 3m",
    category: "Accessories",
    priceKes: 2_300,
    blurb: "48Gbps for screens and consoles.",
    emoji: "🧵",
  },

  {
    id: "ph-01",
    name: "20000mAh Fast Power Bank",
    category: "Phones & Tablets",
    priceKes: 2_199,
    blurb: "22.5W fast charge, triple output.",
    emoji: "🔋",
  },
  {
    id: "ph-02",
    name: 'Smart 6.7" Android Phone 128GB',
    category: "Phones & Tablets",
    priceKes: 18_499,
    blurb: "5000mAh battery, 50MP camera.",
    emoji: "📱",
  },
  {
    id: "ph-03",
    name: "AirPulse Wireless Earbuds",
    category: "Phones & Tablets",
    priceKes: 3_499,
    blurb: "ENC calls, 30h case, USB-C.",
    emoji: "🎧",
  },
  {
    id: "ph-04",
    name: '10" Kids Learning Tablet',
    category: "Phones & Tablets",
    priceKes: 12_999,
    blurb: "Parental controls and a tough case.",
    emoji: "📲",
  },

  {
    id: "hk-01",
    name: "6L Digital Air Fryer",
    category: "Home & Kitchen",
    priceKes: 7_499,
    blurb: "8 presets, non-stick basket.",
    emoji: "🍟",
  },
  {
    id: "hk-02",
    name: "Non-Stick Cookware Set · 7pc",
    category: "Home & Kitchen",
    priceKes: 4_899,
    blurb: "Pots, pans and glass lids.",
    emoji: "🍳",
  },
  {
    id: "hk-03",
    name: "Stainless Steel Cutlery 24pc",
    category: "Home & Kitchen",
    priceKes: 1_899,
    blurb: "Rust-free family set.",
    emoji: "🍴",
  },
  {
    id: "hk-04",
    name: "2L Electric Kettle · Cordless",
    category: "Home & Kitchen",
    priceKes: 2_299,
    blurb: "Auto shut-off, fast boil.",
    emoji: "🫖",
  },

  {
    id: "fa-01",
    name: "Men's Classic Polo Shirt",
    category: "Fashion",
    priceKes: 1_299,
    blurb: "Breathable cotton pique.",
    emoji: "👕",
  },
  {
    id: "fa-02",
    name: "Urban Canvas Sneakers",
    category: "Fashion",
    priceKes: 3_299,
    blurb: "Everyday street sneakers.",
    emoji: "👟",
  },
  {
    id: "fa-03",
    name: "Ladies Ankara Maxi Dress",
    category: "Fashion",
    priceKes: 2_499,
    blurb: "Vibrant print, all sizes.",
    emoji: "👗",
  },
  {
    id: "fa-04",
    name: "Minimalist Steel Watch",
    category: "Fashion",
    priceKes: 2_899,
    blurb: "Sapphire-look glass, 3ATM.",
    emoji: "⌚",
  },

  {
    id: "bh-01",
    name: "Vitamin C Brightening Serum",
    category: "Beauty & Health",
    priceKes: 1_499,
    blurb: "30ml, hyaluronic blend.",
    emoji: "🧴",
  },
  {
    id: "bh-02",
    name: "Shea & Argan Body Butter",
    category: "Beauty & Health",
    priceKes: 999,
    blurb: "Deep moisture, natural.",
    emoji: "🧈",
  },
  {
    id: "bh-03",
    name: "Digital Bathroom Scale",
    category: "Beauty & Health",
    priceKes: 1_799,
    blurb: "Tempered glass, 180kg.",
    emoji: "⚖️",
  },
  {
    id: "bh-04",
    name: "Rechargeable Hair Clipper",
    category: "Beauty & Health",
    priceKes: 2_450,
    blurb: "Cordless, 8 guards.",
    emoji: "💈",
  },

  {
    id: "so-01",
    name: "School Backpack · Waterproof",
    category: "School & Office",
    priceKes: 1_650,
    blurb: "Padded laptop sleeve.",
    emoji: "🎒",
  },
  {
    id: "so-02",
    name: "A4 Exercise Books · 10 pack",
    category: "School & Office",
    priceKes: 780,
    blurb: "200 pages, squared or ruled.",
    emoji: "📚",
  },
  {
    id: "so-03",
    name: "Scientific Calculator FX-991",
    category: "School & Office",
    priceKes: 1_450,
    blurb: "417 functions, exam ready.",
    emoji: "🧮",
  },
  {
    id: "so-04",
    name: "Office Desk Organiser Set",
    category: "School & Office",
    priceKes: 1_250,
    blurb: "Trays, pen pots and file rack.",
    emoji: "🗂️",
  },

  {
    id: "gr-01",
    name: "Premium AA Arabica Coffee 1kg",
    category: "Groceries",
    priceKes: 1_899,
    blurb: "Roasted beans, Kenyan grown.",
    emoji: "☕",
  },
  {
    id: "gr-02",
    name: "Sunflower Cooking Oil 5L",
    category: "Groceries",
    priceKes: 1_450,
    blurb: "Cholesterol free, family size.",
    emoji: "🛢️",
  },
  {
    id: "gr-03",
    name: "Long Grain Pishori Rice 5kg",
    category: "Groceries",
    priceKes: 1_290,
    blurb: "Aromatic Mwea rice.",
    emoji: "🍚",
  },
  {
    id: "gr-04",
    name: "Assorted Spice Rack 12 jars",
    category: "Groceries",
    priceKes: 1_150,
    blurb: "Everyday kitchen spices.",
    emoji: "🧂",
  },

  {
    id: "sp-01",
    name: "Adjustable Dumbbell Set 20kg",
    category: "Sports & Outdoors",
    priceKes: 6_900,
    blurb: "Home gym starter kit.",
    emoji: "🏋️",
  },
  {
    id: "sp-02",
    name: "Size 5 Match Football",
    category: "Sports & Outdoors",
    priceKes: 1_350,
    blurb: "Hand-stitched, all surfaces.",
    emoji: "⚽",
  },
  {
    id: "sp-03",
    name: "6mm Yoga Mat + Strap",
    category: "Sports & Outdoors",
    priceKes: 1_690,
    blurb: "Non-slip, easy to roll.",
    emoji: "🧘",
  },
  {
    id: "sp-04",
    name: "4-Person Camping Tent",
    category: "Sports & Outdoors",
    priceKes: 7_800,
    blurb: "Waterproof, quick pitch.",
    emoji: "⛺",
  },
];

export const ELECTRONICS_PRODUCTS = PRODUCTS.filter((p) =>
  (ELECTRONIC_CATEGORIES as readonly string[]).includes(p.category),
);

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
