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

## First-time setup (no terminal needed)

You can bootstrap the whole platform from the Vercel dashboard + your
browser. No local install required.

1. **In Vercel, set two env vars** on this project (Settings → Environment
   Variables):
   - `POSTGRES_URL` — auto-populated when you create a Postgres store under
     Storage → Create Database. Pick Postgres / Neon, attach to the project.
   - `AUTH_SECRET` — paste any long random string. From your terminal you
     can generate one with `openssl rand -base64 32`, or use any password
     manager's "Generate" button (32+ chars).

2. **Create the database tables.** Open the Vercel dashboard → your
   Postgres store → **Query** tab. Open
   `_reference/initial-schema.sql` from this repo on GitHub, copy the
   entire file, paste it into the Query box, and click **Run**. You should
   see "CREATE TABLE" messages and no errors.

3. **Redeploy** the project so it picks up the env vars. Vercel →
   Deployments → latest → Redeploy.

4. **Visit `/setup` on your deployed app**, e.g.
   `https://<your-project>.vercel.app/setup`. Fill in your name, email,
   and a password (8+ chars). Click **Create admin and continue**. That
   creates your first admin user.

5. **Sign in** at `/signin` with the email + password you just set.

That's it — you're in. **Microsoft SSO and email magic-link are
optional** and only appear on the sign-in page when their env vars are
set. Add them later (see below).

### Inviting more employees

Until the in-app admin UI lands, more users can be added two ways:

- **Easiest:** in the Vercel Postgres Query console, run
  `INSERT INTO users (email, name, display_name, role, active) VALUES
  ('them@example.com', 'Their Name', 'Their Name', 'sales', true);`
  Then sign them in via Microsoft SSO (if configured) or have an admin
  set their password using the local CLI below.

- **Local CLI** (requires Node + git + cloning the repo on your machine):
  ```sh
  git clone https://github.com/nikitbhatt-ai/chiefs-system.git
  cd chiefs-system
  npm install
  npx vercel link              # connect to your Vercel project
  npx vercel env pull .env.local
  npm run user:create -- --email new@example.com --role sales --name "Their Name"
  npm run user:set-password -- --email new@example.com
  ```
  Roles: `admin | manager | sales | warehouse | tech | accountant`.

### Add Microsoft SSO (optional, later)

1. portal.azure.com → Microsoft Entra ID → App registrations → New
2. Redirect URI (Web): `https://<your-domain>/api/auth/callback/microsoft-entra-id`
3. Issue a client secret; copy the *Value*.
4. Set `AUTH_MICROSOFT_ENTRA_ID_ID`, `_SECRET`, and `_ISSUER`
   (`https://login.microsoftonline.com/<tenant-id>/v2.0`) in Vercel env
   vars and locally.
5. The Microsoft button automatically appears on the sign-in page once
   those env vars are present. Users still need to be pre-provisioned in
   the `users` table (email match, `active = true`).

### Add email magic-link (optional, later)

1. Sign up for Resend (or any SMTP).
2. Set `EMAIL_SERVER_HOST`, `_PORT`, `_USER`, `_PASSWORD`, and
   `EMAIL_FROM` in env.
3. The "send magic link" form auto-appears on the sign-in page.

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
