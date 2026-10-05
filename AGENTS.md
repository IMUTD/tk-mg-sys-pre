# Repository Guidelines

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
