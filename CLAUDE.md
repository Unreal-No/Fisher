# Fisher ERP — AI working notes (keep short; read this instead of scanning the repo)

## Map
- `packages/shared/src` — **single source**: enums.ts (must match Prisma enums), labels.ts (Thai), permissions.ts (RBAC + ROLE_DEFS), schemas.ts (Zod for web+api), trip-state.ts, format.ts (พ.ศ./Asia/Bangkok)
- `apps/api/src` — app.ts (plugins/routes), plugins/auth.ts (session, CSRF, `app.can`), lib/{errors,audit,http,storage,settings,seed-core}.ts, modules/<m>/routes.ts (+service.ts when logic is non-trivial); gps/{adapters,geo,service}.ts, fuel/service.ts (tank ledger, FOR UPDATE), inventory/stock.ts (`postMovement` = only way to change stock), purchasing/service.ts (PR→PO→GR), sales/{lots,service}.ts (lot availability + advisory lock; any catch/loss change must call `lockLots`+`assertLotsAvailable`)
- `apps/api/prisma` — schema.prisma, migrations (custom SQL appended: partial unique idx, CHECKs, audit trigger), seed.ts
- `apps/web/src` — router.tsx, lib/{api,auth,hooks,lookups,offline-queue,export}.ts, components/ui/*, features/<m>/*
- `docs/` — PRD, architecture, schema, API, UI, security, roadmap

## Commands
`pnpm dev` · `pnpm check` (typecheck+lint+test+build) · `pnpm db:migrate` · `pnpm db:seed` · API tests need `TEST_DATABASE_URL` (db name must end `_test`)
New migration non-interactively: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql` then `npx prisma migrate deploy`
Never run `prisma migrate reset` against non-test DBs.

## Conventions
- Validation: add/modify Zod schema in shared → used by form (zodResolver) and route (`parse(schema, req.body)`)
- Blank form value → `null` (clears field); unparsable number → error `กรุณากรอกตัวเลข`
- Every mutation: `prisma.$transaction` + `audit(tx, req, {...})`; transactions are never hard-deleted (cancel/void/REPLACED)
- Guards: `{ preHandler: app.can('x.y') }`; vessel scope via `vesselWhere(req)` / `assertVesselScope`
- PDPA fields: nationalIdNo, bankAccountNo, documentNo → `maskEmployee` / audit `redact`
- Errors thrown as `AppError` with Thai message; Decimal returned as string
- UI: Thai labels from shared `*_TH`; list state in URL (`useListParams`); mutations via `useAction` (toast + invalidate)
- No fake buttons/numbers; unimplemented modules are hidden

## Token-saving workflow (model routing)
- Lookups/"where is X" → subagent `explorer` (haiku, read-only)
- Mechanical module scaffolding following an existing module → subagent `implementer` (sonnet)
- Architecture, business rules, security review → main model / `reviewer`
- New module checklist → skill `.claude/skills/new-module`
- Read only the files you change; prefer Grep over full reads; reply concisely (Thai)
