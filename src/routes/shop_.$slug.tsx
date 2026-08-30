import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronRight, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { ProductMedia } from "@/components/hiloxs/ProductMedia";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PRODUCTS,
  discountPct,
  findProductBySlug,
  kes,
  productImages,
  productSlug,
} from "@/lib/hiloxs";
import { useHiloxs } from "@/lib/hiloxs-context";
import { absoluteUrl, pageSeo } from "@/lib/seo";

export const Route = createFileRoute("/shop_/$slug")({
  loader: ({ params }) => {
    const product = findProductBySlug(params.slug);
    if (!product) throw notFound();
    return product;
  },
  head: ({ params }) => {
    const product = findProductBySlug(params.slug);
    if (!product) {
      return pageSeo({
        title: "Product Not Found | HILOXS",
        description: "The requested product listing is not available.",
        path: `/shop/${params.slug}`,
        noindex: true,
      });
    }
    const path = `/shop/${productSlug(product)}`;
    const image = productImages(product)[0]?.src;
    const productUrl = absoluteUrl(path);
    return pageSeo({
      title: `${product.name} | HILOXS Shop`,
      description: `${product.blurb} View the listed price and product details on HILOXS.`,
      path,
      type: "product",
      ...(image && !image.startsWith("data:") ? { image } : {}),
      structuredData: [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          description: product.blurb,
          sku: product.id,
          category: product.category,
          url: productUrl,
          ...(image ? { image: [absoluteUrl(image)] } : {}),
          offers: {
            "@type": "Offer",
            url: productUrl,
            priceCurrency: "KES",
            price: product.priceKes.toFixed(2),
          },
        },
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
  const product = Route.useLoaderData();
  const { addToCart } = useHiloxs();
  const related = PRODUCTS.filter(
    (candidate) => candidate.category === product.category && candidate.id !== product.id,
  ).slice(0, 3);

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
        <ProductMedia
          product={product}
          priority
          className="aspect-square rounded-lg border border-border"
        />

        <section aria-labelledby="product-title" className="lg:py-3">
          <Badge variant="secondary">{product.category}</Badge>
          <h1 id="product-title" className="mt-3 text-3xl font-bold sm:text-4xl">
            {product.name}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">{product.blurb}</p>

          <div className="mt-6 border-y border-border py-5">
            <p className="text-2xl font-bold text-primary">{kes(product.priceKes)}</p>
            {product.oldPriceKes && (
              <p className="mt-1 text-sm text-muted-foreground">
                Previously listed at{" "}
                <span className="line-through">{kes(product.oldPriceKes)}</span> (
                {discountPct(product)}% difference)
              </p>
            )}
            <p className="mt-3 text-sm text-muted-foreground">
              Availability is confirmed before checkout.
            </p>
          </div>

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
                params={{ slug: productSlug(item) }}
                className="panel p-4 transition-colors hover:border-primary"
              >
                <p className="text-sm font-semibold">{item.name}</p>
                <p className="mt-2 text-sm font-bold text-primary">{kes(item.priceKes)}</p>
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
