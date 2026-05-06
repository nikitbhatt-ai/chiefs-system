import type { NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Edge-safe Auth.js config. No DB adapter, no Node-only providers (Nodemailer
// requires Node APIs and lives in the full config). Middleware imports this.
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/signin",
    error: "/signin",
    verifyRequest: "/signin/check-email",
  },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const path = request.nextUrl.pathname;
      const isAuthRoute =
        path.startsWith("/signin") || path.startsWith("/api/auth");
      if (isAuthRoute) return true;
      return isLoggedIn;
    },
  },
};
