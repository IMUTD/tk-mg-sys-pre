# Repository Guidelines

## Mandatory Integration Boundaries

- Only this repository may be modified. `IMUTD/hmg-init-tool` and
  `IMUTD/hmg-RPA-agent` are read-only references; do not edit their source,
  wire protocols, or behavior.
- Preserve completed business behavior, skill semantics, guard order, delays,
  per-slot execution order, and existing UI layout and interactions.
- Frontend exceptions authorized for this work are limited to necessary API
  data wiring, behavior-preserving type fixes, and stale test fixtures. Do not
  redesign pages, invent undefined business workflows, delete tests, or weaken
  assertions. Any further exception needs explicit user authorization.
- On 2026-10-07 the user explicitly authorized replacing group/category filters
  with the box-management label-row style and sharing remark/group catalogs in
  one database table. This exception covers the necessary classification UI,
  API, additive migration, and tests only. Preserve existing assignments and
  unrelated workflows. Business labels must never replace authorization
  `access_group` membership or weaken administrator isolation.
- On 2026-10-07 the user authorized correcting classification visibility to
  match the read-only reference investigation. One shared table does not mean
  one global catalog: isolate device, account group, account tag, proxy, resource,
  and registration classifications. Account-pool selectors reuse account
  classifications; task device selectors reuse device classifications. Free-text
  record notes are not classification catalogs. Preserve IDs and assignments;
  retain ambiguous unused legacy labels for reconciliation instead of guessing
  their origin or deleting them. Do not invent unverified video/material sharing.
  Preserve the existing label-row UI, administrator isolation and page permissions.
- On 2026-10-07 the user authorized aligning proxy configuration, API and
  persistence with the read-only reference proxy page, enabling V2 acceleration
  and optional HTTP/SOCKS5 acceleration, and adding real egress IP detection.
  This exception covers proxy forms, API wiring, validation, additive schema,
  probe transport and tests. Do not modify the reference website or repositories,
  implement vendor purchasing, or change device/Agent execution contracts.
  The original connectivity-probe interpretation is superseded by the explicit
  IP-only lookup authorization below. Never report server egress or simulated
  results as the configured IP or as proof of proxy connectivity.
  Keep secrets encrypted and out of list responses/logs. Block private/reserved
  probe destinations, validate acceleration ownership and cycles, and discard
  results if any configuration used by the probe changed during detection.
- On 2026-10-07 the user explicitly corrected detection to mean IP-information
  lookup only, without connecting to the proxy node. Query the configured public
  IP (or its validated public DNS answer) using fixed HTTPS provider endpoints.
  Do not send proxy ports, credentials or accelerator configuration to providers,
  use a proxy tunnel, or treat an IP lookup as proof of proxy availability.
  This exception authorizes detection API/service, result metadata/UI, automatic
  lookup after creation/import with bounded batches, related tests and docs.
  Preserve ownership checks, encrypted credentials, history, existing proxy
  configuration semantics, private/reserved-address checks and database safeguards.
- The initializer database and business database must remain separate. Read
  initializer tables with read-only credentials; never copy plaintext passwords.
  Failed source reads must not be interpreted as deletions.
- Use additive database migrations only. Preserve existing data and history;
  do not rewrite published migrations or automatically import `docs/public.sql`.
- Destructive tests must target disposable databases named `tk_mg_test_*`.
  Never run schema-reset helpers against a business or initializer database.
- The backend must not directly execute box RPA or Android commands. Unknown
  execution outcomes require reconciliation, not automatic replay.
- Test machine: Debian 13. Use an authorized SSH channel for deployment. Never
  commit credentials or put them in logs, and never register this machine as a
  runner for untrusted pull requests. Software-only acceptance is not proof of
  real hardware execution.
- Work on `fix/backend-business-integration`, based on `15dcafb`. Never modify
  `main`, create a commit, push, open a PR, or merge without a subsequent explicit
  user request after verification. Implementation approval is not commit approval.
- On 2026-10-08, after the verification report, the user explicitly authorized
  committing and pushing the reviewed changes with commit notes to the separate
  `fix/backend-business-integration` branch. This one-time authorization does not
  permit modifying or pushing `main`, opening a PR, merging, or unrelated future
  commits.
- On 2026-10-08 the user authorized completing account-pool management,
  additive persistence, necessary frontend API wiring, and simulated fixtures
  in disposable `tk_mg_test_*` databases. Preserve existing page interactions
  and the separate account-lease contract. Never change the reference Agent
  protocol or present simulated consumption as hardware execution. This work
  must remain uncommitted and unpushed until the user completes manual
  acceptance and explicitly authorizes its submission.
- On 2026-10-09, after the account-pool verification and acceptance report,
  the user explicitly authorized committing and pushing this work to a new
  branch with commit notes and the integration documentation. Use
  `feat/account-pool-persistence`, based on the verified business-integration
  branch. This one-time authorization excludes unrelated workspace changes,
  modifying or pushing `main`, opening a PR, merging, and future commits.
- On 2026-11-07 the user authorized implementing the points mall and merchant
  center backend and wiring these pages to it: wallet, append-only ledger, manual
  recharge and adjustment, products, purchases, shipping, account and proxy
  transfer, and invoice review. Decided rules: points belong to an `access_group`,
  1 yuan = 100 points, products are priced in points, company invoices require a
  tax number, per-task point charges are out of scope for now. The
  platform is `role=administrator` and not `restrictGroups`; `/merchant/*` and its
  APIs are platform-only and return 404 to anyone else. This exception covers the
  necessary pages, API, additive migrations and tests only. It does not permit
  commits, pushes or PRs without a subsequent explicit request. Later the same
  day the user also asked to finish the remaining items: Alipay recharge, order
  export, refunds of shipped orders and linking stock to real inventory. Alipay
  stays off until `ALIPAY_*` is configured; its keys belong in the deployment
  environment only.
- Deliver `docs/后端完善与联调说明.md` with compatibility, configuration,
  migrations, verification, rollback, and honestly reported remaining gaps.

## Project Structure & Module Organization

This TypeScript monorepo uses pnpm workspaces:

- `apps/web/src/`: React/Ant Design frontend: `features/`, `components/`, `app/`, and `assets/`.
- `apps/api/src/`: Hono/Bun API. Keep routes, services, and repositories in `modules/`; schemas and migrations live in `db/`.
- `packages/storage-adapter/`: shared NAS storage interfaces and implementations.
- Future device integrations belong in `packages/device-adapter/`; its contract must stay independent of a vendor protocol.
- `infra/`: Docker Compose, nginx, environment templates, and smoke scripts.
- `docs/设计约束/`: architecture, database, and local startup documentation.

Keep browser requests behind `/api`; isolate storage and device protocols in their adapter packages.

## Build, Test, and Development Commands

Use pnpm `10.28.2` and Bun. Run from the repository root unless noted.

- `pnpm install`: install workspace dependencies.
- `pnpm --filter @tk-mg/web dev`: start Vite; `/api` proxies to port 3000.
- `bun src/main.ts` from `apps/api/`: start the API after configuration and migrations.
- `pnpm --filter @tk-mg/web build`: produce the frontend production bundle.
- `pnpm lint`: run Biome checks; `pnpm exec biome check --write .` applies fixes.
- `pnpm typecheck`: check all workspace packages.
- `pnpm test`: run workspace unit and integration suites.
- `pnpm --filter @tk-mg/web test:e2e`: run Playwright Chromium tests; configuration builds and serves the frontend.

## Coding Style & Naming Conventions

Follow Biome: two-space indentation, 100-column lines, double quotes, and optional semicolons. Use strict TypeScript, type imports, and named exports. Avoid `any`, non-null assertions, and unused imports.

Use kebab-case filenames such as `list-page.tsx`, PascalCase components/types, and camelCase functions/variables. Preserve route/service/repository boundaries.

## Device Adapter Boundaries

Follow `docs/设计约束/设备适配器.md` for device execution. Adapters translate vendor-neutral commands and normalize results only. Authorization, task lifecycle, persistence, audit, retries, and UI state stay in the API domain layer. Add an in-memory adapter and contract tests before a vendor SDK or network protocol.

## Testing Guidelines

Colocate `*.test.ts` and `*.test.tsx`. Frontend tests use Vitest/Testing Library; API and adapter tests use Bun. Browser scenarios belong in `apps/web/e2e/*.spec.ts`.

PostgreSQL integration tests need `TEST_DATABASE_URL` targeting disposable `tk_mg_test_*`; helpers recreate schemas. They skip without configuration. Cover changed behavior, authorization, and failures.

## Commit & Pull Request Guidelines

Recent commits use `feat:`, `fix:`, and `docs:` with English or Chinese summaries. Keep commits focused.

PRs explain behavior, linked issues, validation, and UI screenshots. Document migration or configuration changes.

## Security & Configuration

Copy `infra/.env.example` to `infra/.env`, replace placeholders, and never commit credentials. `SECRET_ENCRYPTION_KEY` must be exactly 32 UTF-8 bytes.
