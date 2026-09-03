import { ImageIcon } from "lucide-react";
import type { Product } from "@/lib/hiloxs";
import { CATEGORY_EMOJI } from "@/lib/hiloxs";
import { catalogMediaUrl, type PublicCatalogProduct } from "@/lib/catalog-api";
import { cn } from "@/lib/utils";
import { ProductMedia } from "./ProductMedia";

export function CatalogProductMedia({
  product,
  fallbackProduct,
  className,
  imageClassName,
  priority = false,
}: {
  product: PublicCatalogProduct;
  fallbackProduct?: Product;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  const media = product.media[0];
  const medium = media?.variants.MEDIUM ? catalogMediaUrl(media.variants.MEDIUM.path) : null;
  const large = media?.variants.LARGE ? catalogMediaUrl(media.variants.LARGE.path) : null;
  const thumbnail = media?.variants.THUMBNAIL
    ? catalogMediaUrl(media.variants.THUMBNAIL.path)
    : null;
  const source = medium ?? large ?? thumbnail;

  if (source) {
    const sourceSet = [
      thumbnail && media?.variants.THUMBNAIL
        ? `${thumbnail} ${media.variants.THUMBNAIL.width}w`
        : null,
      medium && media?.variants.MEDIUM ? `${medium} ${media.variants.MEDIUM.width}w` : null,
      large && media?.variants.LARGE ? `${large} ${media.variants.LARGE.width}w` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return (
      <div className={cn("overflow-hidden bg-secondary", className)}>
        <img
          src={source}
          srcSet={sourceSet || undefined}
          sizes="(min-width: 1024px) 50vw, 100vw"
          alt={product.name}
          className={cn("size-full object-contain", imageClassName)}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
      </div>
    );
  }

  if (fallbackProduct) {
    return (
      <ProductMedia
        product={fallbackProduct}
        {...(className ? { className } : {})}
        {...(imageClassName ? { imageClassName } : {})}
        priority={priority}
      />
    );
  }

  const emoji = CATEGORY_EMOJI[product.category as keyof typeof CATEGORY_EMOJI] ?? "";
  return (
    <div
      className={cn(
        "grid place-items-center bg-[image:var(--gradient-night)] px-4 text-center",
        className,
      )}
      role="img"
      aria-label={`Licensed product photo not yet available for ${product.name}`}
    >
      <div>
        {emoji && (
          <span className="text-5xl" aria-hidden>
            {emoji}
          </span>
        )}
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" aria-hidden /> Licensed photo pending
        </p>
      </div>
    </div>
  );
}
