export const SITE_NAME = "HILOXS";
export const SITE_URL = "https://hiloxs.co.ke";

export function absoluteUrl(path = "/"): string {
  return new URL(path, SITE_URL).toString();
}

type PageSeoOptions = {
  title: string;
  description: string;
  path: string;
  type?: "website" | "product";
  image?: string;
  noindex?: boolean;
  structuredData?: Record<string, unknown> | Record<string, unknown>[];
};

export function pageSeo({
  title,
  description,
  path,
  type = "website",
  image,
  noindex = false,
  structuredData,
}: PageSeoOptions) {
  const canonical = absoluteUrl(path);
  const socialImage = image ? absoluteUrl(image) : undefined;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: noindex ? "noindex, nofollow" : "index, follow" },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: type },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: canonical },
      ...(socialImage ? [{ property: "og:image", content: socialImage }] : []),
      { name: "twitter:card", content: socialImage ? "summary_large_image" : "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      ...(socialImage ? [{ name: "twitter:image", content: socialImage }] : []),
    ],
    links: [{ rel: "canonical", href: canonical }],
    scripts: structuredData
      ? [
          {
            type: "application/ld+json",
            children: JSON.stringify(structuredData).replaceAll("<", "\\u003c"),
          },
        ]
      : [],
  };
}
