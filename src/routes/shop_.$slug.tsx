import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronRight, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { CatalogProductMedia } from "@/components/hiloxs/CatalogProductMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CatalogApiError,
  catalogMediaUrl,
  catalogPriceKes,
  getPublicCatalog,
  getPublicCatalogProduct,
  type PublicCatalogProduct,
} from "@/lib/catalog-api";
import { PRODUCTS, discountPct, kes, productImages } from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-context";
import { absoluteUrl, pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/shop_/$slug")({
  loader: async ({ params }) => {
    try {
      const [product, catalog] = await Promise.all([
        getPublicCatalogProduct(params.slug),
        getPublicCatalog(),
      ]);
      return {
        product,
        related: catalog
          .filter(
            (candidate) => candidate.category === product.category && candidate.id !== product.id,
          )
          .slice(0, 3),
      };
    } catch (error) {
      if (error instanceof CatalogApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) {
      return pageSeo({
        title: "Product Not Found | HILOXS",
        description: "The requested product listing is not available.",
        path: `/shop/${params.slug}`,
        noindex: true,
      });
    }
    const { product } = loaderData;
    const path = `/shop/${product.slug}`;
    const productUrl = absoluteUrl(path);
    const legacy = legacyProduct(product);
    const mediaPath = product.media[0]?.variants.LARGE?.path;
    const image =
      (mediaPath && catalogMediaUrl(mediaPath)) ||
      (legacy ? productImages(legacy)[0]?.src : undefined);
    const productData: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description: product.description,
      sku: product.id,
      category: product.category,
      url: productUrl,
      ...(image ? { image: [absoluteUrl(image)] } : {}),
      ...(product.isPurchasable
        ? {
            offers: {
              "@type": "Offer",
              url: productUrl,
              priceCurrency: product.currency,
              price: catalogPriceKes(product).toFixed(2),
            },
          }
        : {}),
    };
    return pageSeo({
      title: `${product.name} | HILOXS Shop`,
      description: `${product.description} View the listed price and product details on HILOXS.`,
      path,
      type: "product",
      ...(image ? { image } : {}),
      structuredData: [
        productData,
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
            { "@type": "ListItem", position: 2, name: "Shop", item: absoluteUrl("/shop") },
            { "@type": "ListItem", position: 3, name: product.name, item: productUrl },
          ],
        },
      ],
    });
  },
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { product, related } = Route.useLoaderData();
  const { addToCart } = useHiloxs();
  const legacy = legacyProduct(product);
  const priceKes = catalogPriceKes(product);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
      >
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <ChevronRight className="size-4" aria-hidden />
        <Link to="/shop" className="hover:text-foreground">
          Shop
        </Link>
        <ChevronRight className="size-4" aria-hidden />
        <span aria-current="page" className="line-clamp-1 text-foreground">
          {product.name}
        </span>
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
        <CatalogProductMedia
          product={product}
          {...(legacy ? { fallbackProduct: legacy } : {})}
          priority
          className="aspect-square rounded-lg border border-border"
        />
        <section aria-labelledby="product-title" className="lg:py-3">
          <Badge variant="secondary">{product.category}</Badge>
          <h1 id="product-title" className="mt-3 text-3xl font-bold sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{product.description}</p>
          <div className="mt-6 border-y border-border py-5">
            <p className="text-2xl font-bold text-primary">{kes(priceKes)}</p>
            {legacy?.oldPriceKes && (
              <p className="mt-1 text-sm text-muted-foreground">
                Previously listed at <span className="line-through">{kes(legacy.oldPriceKes)}</span>{" "}
                ({discountPct(legacy)}% difference)
              </p>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              {product.isPurchasable
                ? "Availability is confirmed before checkout."
                : "Currently unavailable"}
            </p>
          </div>
          {product.isPurchasable && (
            <>
              <Button
                variant="hero"
                size="lg"
                className="mt-6 w-full sm:w-auto"
                onClick={() => {
                  addToCart(product.id);
                  toast.success(`${product.name} added to cart`);
                }}
              >
                <ShoppingCart aria-hidden /> Add to cart
              </Button>
              <Button asChild variant="outline" size="lg" className="mt-3 w-full sm:ml-3 sm:w-auto">
                <Link to="/shop" hash="cart">
                  View cart
                </Link>
              </Button>
            </>
          )}
        </section>
      </div>

      {related.length > 0 && (
        <section className="mt-14" aria-labelledby="related-products">
          <h2 id="related-products" className="text-2xl font-bold">
            More in {product.category}
          </h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {related.map((item) => (
              <Link
                key={item.id}
                to="/shop/$slug"
                params={{ slug: item.slug }}
                className="panel p-4 transition-colors hover:border-primary"
              >
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="mt-2 text-sm font-bold text-primary">{kes(catalogPriceKes(item))}</p>
                {!item.isPurchasable && (
                  <p className="mt-2 text-xs font-medium">Currently unavailable</p>
                )}
                <span className="mt-3 inline-block text-xs text-muted-foreground">
                  View product details
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function legacyProduct(product: PublicCatalogProduct) {
  return PRODUCTS.find((candidate) => candidate.id === product.id);
}
