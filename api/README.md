# HILOXS API

This package is the backend foundation for HILOXS. It is deliberately isolated
from the root frontend package: it has its own manifest, lockfile, TypeScript configuration, tests,
build output, and deployment container.

Phase 1 provides process lifecycle, validated configuration, structured logging, request IDs, safe
errors, PostgreSQL pooling, Drizzle migrations, liveness/readiness endpoints, and CI. Phase 2 adds
PostgreSQL-backed customer identities, verified-email authentication, opaque cookie sessions,
password reset, account-status enforcement, exact-origin CORS, and a safe current-user endpoint.

## Requirements

- Node.js 24
- npm 11 or a compatible npm version shipped with Node 24
- PostgreSQL 17 for the supplied disposable test setup
- Docker Desktop or another Docker Engine only when running the local integration database

## Dependencies

Runtime dependencies are intentionally small:

- `fastify`: HTTP server, request lifecycle, structured Pino logging, injection testing, and graceful
  close support.
- `better-auth`: email/password authentication, verified email, password reset, and opaque sessions.
- `@fastify/cors`: credentialed CORS restricted to explicitly trusted frontend origins.
- `@fastify/helmet`: maintained Fastify integration for baseline HTTP security headers.
- `zod`: runtime environment validation without exposing environment values in client errors.
- `pg`: PostgreSQL connection pool and the lightweight readiness query.
- `drizzle-orm`: typed PostgreSQL schema and deterministic migration execution.

Development dependencies:

- `typescript` and `@types/node`: strict Node 24 compilation.
- `tsx`: direct TypeScript execution for development and controlled migrations.
- `vitest`: unit and real PostgreSQL integration tests.
- `drizzle-kit`: deterministic SQL migration generation and consistency checks.
- `eslint`, `@eslint/js`, and `typescript-eslint`: isolated type-aware backend linting.
- `@types/pg`: PostgreSQL driver types.

No payment, commerce-domain, cloud database, or backend-as-a-service SDK is installed.

## Environment

Copy `.env.example` to an untracked `.env` for local development and change values only as needed.
Never commit `.env`.

| Variable             | Default                         | Notes                                                           |
| -------------------- | ------------------------------- | --------------------------------------------------------------- |
| `NODE_ENV`           | `development`                   | `development`, `test`, or `production`                          |
| `HOST`               | `127.0.0.1`                     | Railway will typically use `0.0.0.0`                            |
| `PORT`               | `3000`                          | Railway's injected `PORT` is respected                          |
| `LOG_LEVEL`          | `info`                          | Pino log level                                                  |
| `DATABASE_URL`       | none                            | Required by the server and migration command; never logged      |
| `BETTER_AUTH_URL`    | `http://127.0.0.1:${PORT}`      | Required as `https://api.hiloxs.co.ke` in production            |
| `BETTER_AUTH_SECRET` | development-only local fallback | Required in production; use a random value of at least 32 chars |

Production starts only with the canonical API origin, a supplied authentication secret, secure
cookies, and a configured transactional authentication email provider. The provider is deliberately
not part of Phase 2, so this remains a deployment prerequisite rather than a silent email failure.

Node 24's `--env-file-if-exists` support loads `.env` for `dev`, `start`, and `db:migrate` without a
runtime dotenv dependency. Production should inject environment variables through the hosting
platform.

## Local development

```bash
cd api
npm ci
npm run dev
```

The server does not run migrations at startup. PostgreSQL may be down while the process is running:
`/health` remains live and `/ready` reports the database state.

## Endpoints

- `GET /health` returns `200 {"status":"ok"}` and never queries PostgreSQL.
- `GET /ready` executes `SELECT 1`. It returns `200` with `database: "up"` or a safe `503` with
  `database: "down"`.
- `POST /api/auth/sign-up/email` registers a customer and sends verification email.
- `POST /api/auth/sign-in/email` creates an opaque cookie session only for a verified, active user.
- `POST /api/auth/sign-out` removes the current session.
- `POST /api/auth/request-password-reset` always gives an enumeration-resistant response.
- `POST /api/auth/reset-password` consumes a one-time reset and revokes existing sessions.
- `POST /api/auth/send-verification-email` sends or resends a verification message.
- `GET /api/v1/users/me` returns only `id`, `name`, `email`, `emailVerified`, `phone`, and `status`.

Development and test email messages are written to the ignored `api/.dev-emails/` sink or captured
in memory by tests. Verification and reset URLs are never logged. Do not use the development sink in
production.

Every response has an `x-request-id` header. Structured error bodies include the same request ID.
Unknown internal errors never expose stacks, SQL, environment values, file paths, credentials, or
internal database errors.

## Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run test` runs unit tests without PostgreSQL.

## Test PostgreSQL

The Compose service uses disposable tmpfs storage, local port `55432`, database `hiloxs_test`, and
non-sensitive development credentials.

```bash
docker compose -f docker-compose.test.yml up -d --wait
```

Set these values in the current shell before integration commands:

```text
NODE_ENV=test
DATABASE_URL=postgresql://hiloxs:hiloxs_test@localhost:55432/hiloxs_test
```

Then run:

```bash
npm run db:migrate
npm run test:integration
docker compose -f docker-compose.test.yml down -v
```

Integration tests refuse to run unless `NODE_ENV=test`, the database name ends in `_test`, and the
host is an explicitly allowed local or CI PostgreSQL host. They use the real `pg` driver and apply
the real Drizzle migrations; PostgreSQL is not mocked.

## Migrations

The schema source is `src/db/schema/` and generated SQL belongs in `src/db/migrations/`.

```bash
npm run db:generate
npm run db:check
npm run db:migrate
```

Review generated SQL before applying it. `db:migrate` requires `DATABASE_URL`. Migrations are never
run automatically on application startup and should eventually be a controlled deployment step.

## Docker and Railway readiness

Build from this directory:

```bash
docker build -t hiloxs-api .
docker run --rm -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e DATABASE_URL=postgresql://user:password@host:5432/database \
  hiloxs-api
```

The multi-stage image uses Node 24, deterministic `npm ci`, production-only runtime dependencies,
and the non-root `node` user. It copies no `.env` or test data. Railway can inject `PORT`, `HOST`,
and `DATABASE_URL`; no Railway project, credentials, or deployment configuration exists yet.

## Security boundaries

- Browser sessions are opaque, HttpOnly, SameSite=Lax cookies. Production cookies are Secure. The
  frontend does not persist authentication tokens or session state in localStorage.
- Credentialed CORS and Better Auth trusted-origin checks allow exactly `https://hiloxs.co.ke` in
  production. Development additionally allows `http://localhost:8080`; wildcard origins are never
  used.
- Registration, login, password-reset request, and verification resend have in-memory rate limits.
  These limits are per API process and must move to shared durable storage before horizontally
  scaling beyond one instance. On Railway, Better Auth keys them from Railway's edge-set
  `X-Real-IP` header and groups IPv6 clients by `/64`; arbitrary `X-Forwarded-For` values are ignored.
- Email addresses and phone numbers are normalized before persistence. Passwords require at least 12
  characters including lower case, upper case, a number, and a symbol.
- Email verification is required before sign-in. Verification links are backed by hashed,
  single-use records in the existing verification table. Suspended or disabled users cannot create
  sessions; an existing session is revoked when current-user access detects a non-active account.
- Request bodies are limited to 1 MiB and server/request timeouts are bounded.
- Helmet supplies baseline security headers; Fastify does not emit `x-powered-by`.
- Authorization, cookies, passwords, tokens, secrets, and database URLs are redacted from structured
  logs. Authentication tokens in request paths or query strings are also redacted. Client errors
  receive only stable codes and safe messages.
- The general and authentication trust-boundary decisions are recorded in
  `../docs/adr/0001-backend-trust-boundary.md` and
  `../docs/adr/0002-authentication-trust-model.md`.

## Intentionally not implemented

There are no application roles, products, carts, orders, checkout, payments, M-Pesa integration,
wallets, ledgers, withdrawals, referrals, bonuses, sellers, document storage, training APIs, trading
APIs, or admin APIs. Phase 2 introduces only authentication-owned users, sessions, accounts, and
verification records alongside the infrastructure-owned `system_metadata` table.
