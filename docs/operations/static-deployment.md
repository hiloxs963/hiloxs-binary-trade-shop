# Static Frontend Release Runbook

`npm run build` prerenders the canonical public route manifest, generates the sitemap, copies a
private-route SPA shell, creates a real `404.html`, discovers and hashes generated executable inline
scripts, emits `.htaccess`, writes SHA-256 release checksums, and runs artifact verification. A failed
step prevents artifact publication.

## Security headers and caching

The generated CSP uses `self`, the exact API origin, and build-derived SHA-256 inline-script hashes.
It does not use `unsafe-eval`, `unsafe-inline`, external font hosts, or unconfigured S3 origins. Fonts
and their OFL licenses are vendored under `public/fonts`. HSTS is emitted only for HTTPS and does not
claim `includeSubDomains` or preload. Hashed `_build` assets are immutable; HTML, XML, and text are
no-cache.

The Apache rules issue a 308 redirect from HTTP or `www.hiloxs.co.ke` to the apex HTTPS origin,
serve known prerendered routes/files directly, route only known authenticated paths to `_shell.html`,
and return a real 404 for unknown paths. Verify these rules on the actual cPanel Apache version before
launch.

## Existing branch/cron model

GitHub Actions pins Node, Bun, and action commits; runs lint, typecheck, build, and artifact checks;
stages the complete release in runner temporary storage; then publishes it to the existing
`cpanel-deploy` branch. It does not contact live cPanel directly.

The cPanel-side cron remains an operational concern. Configure it to fetch into a new immutable
release directory named by `release-manifest.json.commit`, verify every checksum, and only then switch
the document-root symlink/indirection atomically. Keep the prior release directory for rollback. Do
not overlay a partially copied release onto the live directory. Because the live cron configuration
is not in this repository, verification of this staging/switch/rollback behavior is a launch blocker.

## Release verification

Run `npm run verify:production` against `dist/client`. Confirm 49 public pages (home, shop, three
public informational routes, and 44 products), no private sitemap entries, correct canonical product
metadata/JSON-LD, all inline scripts covered by CSP hashes, local fonts only, a private SPA shell,
`404.html`, headers/redirect rules, and manifest checksums. After an authorized deployment, test one
known route, one product, one authenticated deep link, one unknown path, HTTP redirect, `www`
redirect, CSP console, and cache headers.
