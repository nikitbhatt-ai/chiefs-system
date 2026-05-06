# Chiefs Pursuit Surplus — ERP/CRM

Internal-only platform for Chiefs Pursuit Surplus: full sales-cycle CRM,
dealer-lot management, upfitting workflow, parts inventory, time clocks,
accounting, and per-customer file storage. Per-department AI agents are
planned as the final phase.

## Stack

- **Next.js 15** (App Router) + **TypeScript** + **React 19**
- **Tailwind v4** (CSS-first config in `src/app/globals.css`)
- **Drizzle ORM** + **Vercel Postgres** (Neon under the hood)
- **Auth.js v5** with **Microsoft Entra ID** + **email magic-link**
- **Vercel Blob** for invoice / build-spec storage
- Deploy on **Vercel** (already connected to this GitHub repo)

## Repository layout

```
src/
  app/                  Next.js App Router pages + API routes
    api/auth/[...nextauth]/route.ts   Auth.js handlers
    signin/             Sign-in screens (Microsoft + email magic-link)
    page.tsx            Dashboard (protected by middleware)
  auth.ts               Auth.js config (providers + callbacks)
  middleware.ts         Auth gate for every non-auth route
  db/
    schema.ts           Drizzle schema (users + domain tables)
    index.ts            Drizzle client
  lib/
    utils.ts            cn() helper

drizzle.config.ts       drizzle-kit config
_reference/
  SPEC.md               Recovered spec from the original Perplexity build
  deobfuscated.js       Deobfuscated source bundle (read-only reference)
  old-build/            Original compiled assets
```

## First-time setup

1. **Pull env from Vercel** (after the project is linked):
   ```sh
   npx vercel link
   npx vercel env pull .env.local
   ```
   That populates `POSTGRES_URL` and `BLOB_READ_WRITE_TOKEN` from the
   already-deployed Vercel project.

2. **Fill in the auth env vars** in `.env.local` (see `.env.example`):
   - `AUTH_SECRET` — `openssl rand -base64 32`
   - Microsoft Entra app registration values (tenant ID, client ID, secret)
   - SMTP credentials for the magic-link provider

3. **Push the schema to Postgres**:
   ```sh
   npm run db:push
   ```

4. **Pre-provision admin users** (one-time, until we build the admin UI):
   ```sh
   npm run db:studio
   ```
   In Drizzle Studio, insert a row in `users` with your email and
   `role = 'admin'`. Auth rejects anyone not in the table.

5. **Run dev server**:
   ```sh
   npm run dev
   ```

## Auth model

- All users are internal employees. **Customers and vendors do not log in.**
- Two sign-in paths, both gated by the `users` table:
  - **Microsoft SSO** for `@chiefspursuitsurplus.com` accounts.
  - **Email magic-link** for personal-email employees.
- Roles: `admin`, `manager`, `sales`, `warehouse`, `tech`, `accountant`.
- Anyone whose email isn't pre-provisioned (or who is `active = false`)
  is rejected at sign-in.

## Migration plan

The original Perplexity build exists in `_reference/old-build/` (compiled).
The deobfuscated source is at `_reference/deobfuscated.js` — JSX, Tailwind
classes, API endpoints, and field names are intact. We're transcribing it
screen-by-screen into clean Next.js components, keeping `data-testid`
attributes for parity.

See `_reference/SPEC.md` for the full recovered API surface, enum values,
and per-screen plan.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TS check (no emit) |
| `npm run lint` | ESLint |
| `npm run db:push` | Push Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations |
| `npm run db:studio` | Open Drizzle Studio |
