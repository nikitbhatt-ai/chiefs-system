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

## First-time setup (minimum to log in)

1. **Pull env from Vercel** (after the project is linked):
   ```sh
   npx vercel link
   npx vercel env pull .env.local
   ```
   That populates `POSTGRES_URL` (and `BLOB_READ_WRITE_TOKEN` if a Blob store
   is set up) from the already-deployed Vercel project.

2. **Set `AUTH_SECRET`** in `.env.local`:
   ```sh
   echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env.local
   ```

3. **Push the schema to Postgres**:
   ```sh
   npm run db:push
   ```

4. **Create your first admin user**:
   ```sh
   npm run user:create -- --email you@chiefspursuitsurplus.com --role admin --name "Your Name"
   ```
   The script prompts for a password (8+ chars). Repeat for each employee
   (use `--role sales | warehouse | tech | accountant | manager`).

   Reset a password later with `npm run user:set-password -- --email …`.

5. **Run dev server** and sign in at http://localhost:3000:
   ```sh
   npm run dev
   ```

That's it for local + Vercel deploy. **Microsoft SSO and email magic-link are
optional and disabled until configured** — see below to enable.

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
