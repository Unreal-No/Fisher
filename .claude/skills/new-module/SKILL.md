---
name: new-module
description: Checklist for adding a new ERP module/entity (e.g. suppliers, fuel tanks, sales orders) end-to-end in Fisher ERP following existing patterns.
---
# Add a module (mirror `vessels` for simple CRUD, `trips` for workflows)

1. **Shared** `packages/shared/src`: enums (+`*_TH` labels), Zod schema in schemas.ts, permissions in permissions.ts (+ROLE_DEFS), response types if shared.
2. **DB** `apps/api/prisma/schema.prisma`: snake_case `@@map/@map`, UUIDv7, Decimal for money/weight, timestamps, `deletedAt` for master data, indexes, FKs. `pnpm db:migrate --name <x> --create-only`, append raw SQL for partial indexes/CHECKs, then `pnpm db:migrate`.
3. **API** `apps/api/src/modules/<m>/routes.ts` (+service.ts if rules): guard `app.can`, `parse(schema)`, `$transaction` + `audit`, scope (`vesselWhere`), Thai `AppError`s; register in `app.ts`. Seed reference data in `lib/seed-core.ts` (idempotent upserts).
4. **Tests** `apps/api/test/<m>.test.ts`: happy path, validation 400, RBAC 403, business-rule 409/422, audit row exists.
5. **Web** `apps/web/src/features/<m>/`: list page (DataTable + useListParams), detail (Tabs), form (zodResolver + shared schema), add route in router.tsx with `P perm`, nav item in components/layout/nav.ts.
6. **Docs**: one row each in docs/API_SPECIFICATION.md, docs/DATABASE_SCHEMA.md; update DEVELOPMENT_ROADMAP.md status.
7. Run `pnpm check`. Report briefly.
