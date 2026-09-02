export const PRODUCT_CATEGORIES = [
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

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
