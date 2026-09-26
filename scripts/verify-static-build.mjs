import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CLIENT_DIR,
  EXPECTED_PLATFORM_PRODUCT_COUNT,
  EXPECTED_PUBLIC_PAGE_COUNT,
  SITE_ORIGIN,
  assert,
  exists,
  expectedHtmlPath,
  listFiles,
  parseSitemap,
  readHtmlFiles,
} from "./static-build-lib.mjs";

const sitemapXml = await readFile(path.join(CLIENT_DIR, "sitemap.xml"), "utf8");
const urls = parseSitemap(sitemapXml);
assert(
  urls.length === EXPECTED_PUBLIC_PAGE_COUNT,
  `Expected 49 sitemap URLs, found ${urls.length}`,
);
assert(new Set(urls).size === urls.length, "Sitemap contains duplicate URLs");

const privatePaths = [
  "/account",
  "/checkout",
  "/my-orders",
  "/staff",
  "/sell-with-us",
  "/verify-email",
  "/reset-password",
  "/login",
  "/register",
  "/forgot-password",
];
for (const rawUrl of urls) {
  const url = new URL(rawUrl);
  assert(
    url.origin === SITE_ORIGIN && !url.search && !url.hash,
    `Invalid canonical sitemap URL: ${rawUrl}`,
  );
  assert(
    !privatePaths.some((route) => url.pathname === route || url.pathname.startsWith(`${route}/`)),
    `Private route in sitemap: ${url.pathname}`,
  );
  assert(
    await exists(expectedHtmlPath(url.pathname)),
    `Missing prerendered HTML for ${url.pathname}`,
  );
}

const productUrls = urls.filter((rawUrl) => new URL(rawUrl).pathname.startsWith("/shop/"));
assert(
  productUrls.length === EXPECTED_PLATFORM_PRODUCT_COUNT,
  `Expected ${EXPECTED_PLATFORM_PRODUCT_COUNT} product URLs, found ${productUrls.length}`,
);

const htmlFiles = await readHtmlFiles();
for (const { file, html } of htmlFiles) {
  assert(
    !/fonts\.(?:googleapis|gstatic)\.com/i.test(html),
    `External Google font reference in ${file}`,
  );
  assert(!/<script\b[^>]+src=["']https?:\/\//i.test(html), `External script in ${file}`);
}

for (const rawUrl of productUrls) {
  const url = new URL(rawUrl);
  const html = await readFile(expectedHtmlPath(url.pathname), "utf8");
  assert(
    html.includes(`<link rel="canonical" href="${rawUrl}"`),
    `Wrong product canonical: ${url.pathname}`,
  );
  assert(html.includes('"@type":"Product"'), `Missing Product JSON-LD: ${url.pathname}`);
  assert(
    !/aggregateRating|reviewCount|inventoryLevel|priceValidUntil/i.test(html),
    `Unsupported Product claim: ${url.pathname}`,
  );
}

const robots = await readFile(path.join(CLIENT_DIR, "robots.txt"), "utf8");
assert(
  robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`),
  "robots.txt has the wrong sitemap URL",
);
assert(!robots.includes("Disallow: /shop"), "robots.txt blocks the public shop");

const htaccess = await readFile(path.join(CLIENT_DIR, ".htaccess"), "utf8");
for (const required of [
  "Strict-Transport-Security",
  'X-Content-Type-Options "nosniff"',
  'Referrer-Policy "strict-origin-when-cross-origin"',
  'X-Frame-Options "DENY"',
  "frame-ancestors 'none'",
  "default-src 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "https://api.hiloxs.co.ke",
  "R=404",
])
  assert(htaccess.includes(required), `Missing static security/deployment rule: ${required}`);
// 'unsafe-eval' must never appear anywhere in the CSP.
assert(!htaccess.includes("'unsafe-eval'"), "CSP contains 'unsafe-eval'");

// CSP spec §8.2: when a directive contains hash or nonce values, 'unsafe-inline' is silently
// ignored. script-src must carry 'unsafe-inline' with NO sha256 hashes — having both is the
// failure mode that caused the production outage.
assert(/script-src\s+[^;]*'unsafe-inline'/.test(htaccess), "script-src is missing 'unsafe-inline'");
assert(
  !/script-src\s+[^;]*'sha256-/.test(htaccess),
  "script-src contains sha256 hashes alongside 'unsafe-inline' — per CSP spec, hashes suppress 'unsafe-inline'",
);

// style-src must include 'unsafe-inline': React injects inline styles at runtime; they have
// no build-time HTML representation and cannot be pre-hashed on a static host.
assert(
  /style-src\s+[^;]*'unsafe-inline'/.test(htaccess),
  "style-src is missing 'unsafe-inline' (required for React runtime inline styles)",
);

// Phase 12 uploads a file straight from the browser to R2 with a presigned PUT. If the R2
// origin is dropped from connect-src that fetch is blocked by CSP and uploads fail silently.
assert(
  /connect-src\s+[^;]*https:\/\/8e21c80244678cbc435f75750047fea7\.r2\.cloudflarestorage\.com/.test(
    htaccess,
  ),
  "connect-src is missing the R2 origin - direct browser presigned PUT uploads will be blocked by CSP",
);

assert(await exists(path.join(CLIENT_DIR, "404.html")), "404.html is missing");
assert(await exists(path.join(CLIENT_DIR, "_shell.html")), "Private-route SPA shell is missing");

const manifestPath = path.join(CLIENT_DIR, "release-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert(/^[0-9a-f]{40}$/i.test(manifest.commit), "Release manifest commit is invalid");
for (const file of await listFiles()) {
  if (file === manifestPath) continue;
  const relative = path.relative(CLIENT_DIR, file).split(path.sep).join("/");
  const digest = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  assert(manifest.checksums[relative] === digest, `Release checksum mismatch: ${relative}`);
}

await smokeTestStaticRoutes(productUrls[0]);

console.log(
  `Verified ${urls.length} prerendered public pages, ${productUrls.length} products, and release checksums.`,
);

async function smokeTestStaticRoutes(productUrl) {
  const privateRoutes = new Set([
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/checkout",
    "/my-orders",
    "/sell-with-us",
    "/staff",
    "/account/security",
  ]);
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    let file = privateRoutes.has(pathname)
      ? path.join(CLIENT_DIR, "_shell.html")
      : expectedHtmlPath(pathname);
    if (pathname !== "/" && (await exists(path.join(CLIENT_DIR, pathname.slice(1))))) {
      file = path.join(CLIENT_DIR, pathname.slice(1));
    }
    if (!(await exists(file))) {
      response.statusCode = 404;
      file = path.join(CLIENT_DIR, "404.html");
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(await readFile(file));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert(address && typeof address === "object", "Static smoke server did not bind");
    const origin = `http://127.0.0.1:${address.port}`;
    const checks = [
      ["/", 200],
      ["/shop", 200],
      // Product pages are served from the live catalog, so there may be none prerendered.
      ...(productUrl ? [[new URL(productUrl).pathname, 200]] : []),
      ["/login", 200],
      ["/definitely-not-a-hiloxs-route", 404],
    ];
    for (const [pathname, status] of checks) {
      const response = await fetch(`${origin}${pathname}`);
      assert(
        response.status === status,
        `Static HTTP ${pathname}: expected ${status}, got ${response.status}`,
      );
    }
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
