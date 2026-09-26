import { ImageIcon } from "lucide-react";
import { CATEGORY_EMOJI } from "@/lib/hiloxs";
import { catalogMediaUrl, type PublicCatalogProduct } from "@/lib/catalog-api";
import { cn } from "@/lib/utils";

export function CatalogProductMedia({
  product,
  className,
  imageClassName,
  priority = false,
  compact = false,
}: {
  product: PublicCatalogProduct;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
  /** Thumbnail sizing: shrinks the placeholder and drops its caption. */
  compact?: boolean;
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

  const emoji = CATEGORY_EMOJI[product.category as keyof typeof CATEGORY_EMOJI] ?? "";
  return (
    <div
      className={cn(
        "grid place-items-center overflow-hidden bg-[image:var(--gradient-night)] text-center",
        compact ? "px-1" : "px-4",
        className,
      )}
      role="img"
      aria-label={`Licensed product photo not yet available for ${product.name}`}
    >
      <div>
        {emoji ? (
          <span className={compact ? "text-xl" : "text-5xl"} aria-hidden>
            {emoji}
          </span>
        ) : (
          compact && <ImageIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
        {!compact && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageIcon className="size-3.5" aria-hidden /> Licensed photo pending
          </p>
        )}
      </div>
    </div>
  );
}
