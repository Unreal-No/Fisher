# Fisher ERP — AI working notes (keep short; read this instead of scanning the repo)

## Map
- `packages/shared/src` — **single source**: enums.ts (must match Prisma enums), labels.ts (Thai), permissions.ts (RBAC + ROLE_DEFS), schemas.ts (Zod for web+api), trip-state.ts, format.ts (พ.ศ./Asia/Bangkok)
- `apps/api/src` — app.ts (plugins/routes), plugins/auth.ts (session, CSRF, `app.can`), lib/{errors,audit,http,storage,settings,seed-core,mail}.ts (mail: SMTP or simulated outbox), admin/system.ts (wipe-before-go-live), modules/<m>/routes.ts (+service.ts when logic is non-trivial); gps/{adapters,geo,service,mqtt,voyage,simulator}.ts (HTTP and MQTT share adapters + `ingest`; `gpsBus` feeds the SSE `/gps/stream`; `analyzeVoyage` = legs/stops; simulator positions are is_demo), fuel/service.ts (tank ledger, FOR UPDATE), inventory/stock.ts (`postMovement` = only way to change stock), purchasing/service.ts (PR→PO→GR), sales/{lots,service}.ts (lot availability + advisory lock; any catch/loss change must call `lockLots`+`assertLotsAvailable`), maintenance/service.ts (`logEngineHours` = only way to record meter readings), payroll/{calc,service}.ts (pure calc helpers; calculate/approve/pay/cancel; advance recoveries applied only on approve), accounting/{ledger,autopost,reports,ap,bank,assets,yearend}.ts (AP bills/payments, bank reconciliation, fixed assets/depreciation, year-end close — YEAR_END entries are excluded from P&L/cash flow; `createEntry`/`reverseEntry` = only way to write the ledger; posted entries immutable by DB trigger; new operational document types need a collector in autopost.ts)
- `apps/api/prisma` — schema.prisma, migrations (custom SQL appended: partial unique idx, CHECKs, audit trigger), seed.ts
- `apps/web/src` — router.tsx, lib/{api,auth,hooks,lookups,offline-queue,export}.ts, components/ui/*, features/<m>/*
- `docs/` — PRD, architecture, schema, API, UI, security, roadmap

## Commands
`pnpm dev` · `pnpm check` (typecheck+lint+test+build) · `pnpm e2e` (Playwright against running dev servers; never run `playwright install` locally) · `pnpm db:migrate` · `pnpm db:seed` · API tests need `TEST_DATABASE_URL` (db name must end `_test`)
New migration non-interactively: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<ts>_<name>/migration.sql` then `npx prisma migrate deploy`
Never run `prisma migrate reset` against non-test DBs.

## Conventions
- Validation: add/modify Zod schema in shared → used by form (zodResolver) and route (`parse(schema, req.body)`)
- Blank form value → `null` (clears field); unparsable number → error `กรุณากรอกตัวเลข`
- Every mutation: `prisma.$transaction` + `audit(tx, req, {...})`; transactions are never hard-deleted (cancel/void/REPLACED)
- Guards: `{ preHandler: app.can('x.y') }`; vessel scope via `vesselWhere(req)` / `assertVesselScope`
- Auth: 2FA in modules/auth (lib/totp, secrets encrypted with lib/crypto); exports via components/ui/export-menu (CSV/XLSX)
- PDPA fields: nationalIdNo, bankAccountNo, documentNo → encrypted at rest by the Prisma extension in lib/prisma + lib/pii (key rotation: lib/crypto key ids + `reencryptAll`) (never filter/sort on them in SQL; raw SQL sees ciphertext) → `maskEmployee` / audit `redact`
- Errors thrown as `AppError` with Thai message; Decimal returned as string
- UI: Thai labels from shared `*_TH`; list state in URL (`useListParams`); mutations via `useAction` (toast + invalidate)
- No fake buttons/numbers; unimplemented modules are hidden

## Token-saving workflow (model routing)
- Lookups/"where is X" → subagent `explorer` (haiku, read-only)
- Mechanical module scaffolding following an existing module → subagent `implementer` (sonnet)
- Architecture, business rules, security review → main model / `reviewer`
- New module checklist → skill `.claude/skills/new-module`
- Read only the files you change; prefer Grep over full reads; reply concisely (Thai)
