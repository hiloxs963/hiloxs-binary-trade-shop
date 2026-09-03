export type PublicCatalogMediaVariant = {
  path: string;
  width: number;
  height: number;
};

export type PublicCatalogMedia = {
  id: string;
  sortOrder: number;
  variants: Partial<Record<"THUMBNAIL" | "MEDIUM" | "LARGE", PublicCatalogMediaVariant>>;
};

export type PublicCatalogProduct = {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  priceMinor: string;
  currency: "KES";
  isPurchasable: boolean;
  media: PublicCatalogMedia[];
};

const configuredApiOrigin = import.meta.env["VITE_API_URL"]?.trim().replace(/\/$/, "");
const API_ORIGIN = configuredApiOrigin || (import.meta.env.DEV ? "" : "https://api.hiloxs.co.ke");

export class CatalogApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CatalogApiError";
    this.status = status;
  }
}

export async function getPublicCatalog(): Promise<PublicCatalogProduct[]> {
  const response = await fetch(`${API_ORIGIN}/api/v1/products`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new CatalogApiError("The product catalog is unavailable", response.status);
  return ((await response.json()) as { products: PublicCatalogProduct[] }).products;
}

export async function getPublicCatalogProduct(slug: string): Promise<PublicCatalogProduct> {
  const response = await fetch(`${API_ORIGIN}/api/v1/products/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new CatalogApiError("The product could not be loaded", response.status);
  return ((await response.json()) as { product: PublicCatalogProduct }).product;
}

export function catalogMediaUrl(path: string): string | null {
  if (!/^\/api\/v1\/products\/[^/]+\/media\/[0-9a-f-]+\/(?:THUMBNAIL|MEDIUM|LARGE)$/i.test(path)) {
    return null;
  }
  return `${API_ORIGIN}${path}`;
}

export function catalogPriceKes(product: PublicCatalogProduct): number {
  return Number(BigInt(product.priceMinor)) / 100;
}
