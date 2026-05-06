import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

// Edge-safe auth middleware. Uses the slim auth.config (no DB adapter, no
// Nodemailer) — the `authorized` callback there gates every non-auth route.
export const { auth: middleware } = NextAuth(authConfig);

export default middleware((req) => {
  // Default behavior is handled by `authorized` in auth.config.ts.
  return undefined;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
