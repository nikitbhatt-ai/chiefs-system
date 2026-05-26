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
        // Public endpoints authed by shared secret instead of a user
        // session: the lead-capture webhook target and Vercel Cron hits.
        // The route handlers themselves enforce the secret.
        path === "/api/leads/capture" ||
        path.startsWith("/api/cron/");
      if (isPublicRoute) return true;
      return isLoggedIn;
    },
  },
};
