import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";

// Edge-safe Auth.js config. No DB adapter, no Node-only providers — those are
// added in auth.ts. Middleware imports this for the `authorized` callback.

type Providers = NonNullable<NextAuthConfig["providers"]>;

const providers: Providers = [
  // Credentials provider runs everywhere; password verification happens in
  // auth.ts where bcrypt + db are available. Here we just declare the shape.
  Credentials({
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    // Real authorize() is overridden in auth.ts.
    authorize: async () => null,
  }),
];

if (
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
) {
  providers.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

export const microsoftEnabled =
  !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
  !!process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;

export const emailMagicLinkEnabled =
  !!process.env.EMAIL_SERVER_HOST && !!process.env.EMAIL_FROM;

const SHOPIFY_LEAD_FORM_PATHS = new Set([
  "/api/leads/contact",
  "/api/leads/parts-inquiry",
  "/api/leads/inventory-inquiry",
  "/api/leads/vehicle-inquiry",
]);

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/signin",
    error: "/signin",
    verifyRequest: "/signin/check-email",
  },
  session: { strategy: "jwt" },
  providers,
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;
      const isPublicRoute =
        path.startsWith("/signin") ||
        path.startsWith("/setup") ||
        path.startsWith("/api/auth") ||
        // Public endpoints authed by shared secret (or by Origin
        // allowlist on the /web variant) instead of a user session.
        // The route handlers themselves enforce the relevant check.
        path.startsWith("/api/leads/capture") ||
        path.startsWith("/api/cron/") ||
        // Shopify storefront form posts (anonymous, cross-domain). Exact
        // paths only — the rest of /api/leads stays behind login.
        SHOPIFY_LEAD_FORM_PATHS.has(path);
      if (isPublicRoute) return true;
      return isLoggedIn;
    },
  },
};
