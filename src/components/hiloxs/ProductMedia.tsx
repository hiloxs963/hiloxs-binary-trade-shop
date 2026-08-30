import { ImageIcon } from "lucide-react";
import type { Product } from "@/lib/hiloxs";
import { productImages } from "@/lib/hiloxs";
import { cn } from "@/lib/utils";

export function ProductMedia({
  product,
  className,
  imageClassName,
  priority = false,
}: {
  product: Product;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  const image = productImages(product)[0];

  if (image) {
    return (
      <div className={cn("overflow-hidden bg-secondary", className)}>
        <img
          src={image.src}
          alt={image.alt}
          className={cn("size-full object-contain", imageClassName)}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
      </div>
    );
  }

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
        <span className="text-5xl" aria-hidden>
          {product.emoji}
        </span>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" aria-hidden /> Licensed photo pending
        </p>
      </div>
    </div>
  );
}
