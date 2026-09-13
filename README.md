# HILOXS

HILOXS is a Kenya-focused commerce frontend and API. The repository contains the public product
catalog, authenticated checkout and order flows, seller application and fulfillment foundations,
staff review controls, and a clearly labelled browser-only training/trading prototype.

Production commerce behavior is server-authoritative. Prices, availability, order totals, payment
state, inventory reservations, seller permissions, and staff permissions are not trusted from the
browser. Operational features remain disabled until their explicit server-side flags and external
dependencies have been reviewed.

## Development

The frontend uses Bun. On Windows, `--backend=copyfile` is required; see
[`docs/operations/local-development-environment.md`](docs/operations/local-development-environment.md).

```sh
bun install --frozen-lockfile --backend=copyfile
npm run dev
```

The API has its own npm lockfile and commands:

```sh
cd api
cp .env.example .env
npm ci
npm run db:migrate
npm run dev
```

Use disposable local credentials and PostgreSQL for development. Never commit `.env` files.

## Validation

Frontend:

```sh
npm run lint
npx tsc --noEmit
npm run build
npm run verify:production
```

Backend:

```sh
cd api
npm ci
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run build
npm run db:check
```

Integration tests must only use a disposable PostgreSQL database. Their safety guard rejects missing
or production-looking database URLs.

## Operations

Architecture decisions are in [`docs/adr`](docs/adr). Production and incident runbooks are in
[`docs/operations`](docs/operations). Policy drafts under [`docs/policies`](docs/policies) are
templates only and are not approved public legal terms.

Database migrations are forward-only and explicit. API startup does not run migrations. Railway
Auto Deploy remains disabled, and the static frontend workflow publishes a validated artifact to the
existing `cpanel-deploy` branch.
