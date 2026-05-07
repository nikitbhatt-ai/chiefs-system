# Chiefs Pursuit Surplus — ERP/CRM

Internal Next.js + Drizzle + Neon Postgres app deployed on Vercel.

## Before doing anything

**Read `docs/REQUIREMENTS.md` first.** It is the running spec of every
feature requirement the user has asked for. When building or extending
a module, consult that file's section for that module first.

When the user adds a new requirement during a session, append it to
`docs/REQUIREMENTS.md` in the same commit so the next session sees it.

## Build patterns

- Server components for list/detail pages; server actions for form mutations.
- Every entity gets:
  - `src/app/{section}/page.tsx` — list + create form
  - `src/app/{section}/[id]/edit/page.tsx` — edit form (pre-filled)
  - `src/app/api/{section}/route.ts` — GET/POST JSON
  - `src/app/api/{section}/[id]/route.ts` — GET/PATCH/DELETE JSON
- Use `AppShell` from `@/components/AppShell` for the page chrome.
- Auth is enforced by `src/middleware.ts`; API routes additionally check
  `auth()` and return 401 if unauthenticated.
- Database client: `import { db } from "@/db"` and tables from
  `import { ... } from "@/db/schema"`.

## When schema changes

The Neon database is already populated. Schema changes require an
`ALTER TABLE` SQL the user must run in Neon's SQL Editor. Always:
1. Update `src/db/schema.ts`.
2. Tell the user the exact SQL to run.
3. Update the form/API/page that needs the new field.

## Things NOT to do

- Don't run `drizzle-kit push` or `migrate` — schema is live; we use SQL
  the user runs manually.
- Don't change auth or env vars.
- Don't pin `next` below `^15.5.0` (CVE-2025-29927).
