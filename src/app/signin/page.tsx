import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { microsoftEnabled, emailMagicLinkEnabled } from "@/auth.config";
import { AuthError } from "next-auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? "/";
  const error = params.error;

  async function passwordSignIn(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: callbackUrl,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect(`/signin?error=CredentialsSignin&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      throw err;
    }
  }

  async function microsoftSignIn() {
    "use server";
    await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
  }

  async function emailSignIn(formData: FormData) {
    "use server";
    await signIn("nodemailer", {
      email: formData.get("magic-email"),
      redirectTo: callbackUrl,
    });
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-[#161624] border border-white/5 rounded-xl p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-white">
            Chiefs Pursuit Surplus
          </h1>
          <p className="text-xs text-zinc-500 font-body mt-1">
            Internal workflow platform
          </p>
        </div>

        {error ? (
          <div className="text-xs font-body text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {messageForError(error)}
          </div>
        ) : null}

        <form action={passwordSignIn} className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
              Email
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@chiefspursuitsurplus.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-amber-500 text-black hover:bg-amber-400 font-body text-sm font-semibold h-10 rounded-lg transition-colors"
          >
            Sign in
          </button>
        </form>

        {microsoftEnabled || emailMagicLinkEnabled ? (
          <div className="flex items-center gap-3">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-[10px] text-zinc-600 font-body uppercase tracking-wider">
              or
            </span>
            <div className="h-px bg-white/10 flex-1" />
          </div>
        ) : null}

        {microsoftEnabled ? (
          <form action={microsoftSignIn}>
            <button
              type="submit"
              className="w-full bg-white/5 border border-white/10 text-white hover:bg-white/10 font-body text-sm font-semibold h-10 rounded-lg transition-colors"
            >
              Sign in with Microsoft
            </button>
          </form>
        ) : null}

        {emailMagicLinkEnabled ? (
          <form action={emailSignIn} className="space-y-3">
            <div>
              <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
                Email me a sign-in link
              </label>
              <input
                type="email"
                name="magic-email"
                required
                placeholder="you@example.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-white/5 border border-white/10 text-white hover:bg-white/10 font-body text-sm font-semibold h-10 rounded-lg transition-colors"
            >
              Send magic link
            </button>
          </form>
        ) : null}

        <p className="text-[10px] text-zinc-600 font-body text-center leading-relaxed">
          Accounts are created by an admin. If you don&apos;t have one yet, ask
          your admin to invite you.
        </p>
      </div>
    </main>
  );
}

function messageForError(error: string): string {
  switch (error) {
    case "CredentialsSignin":
      return "Email or password is incorrect.";
    case "AccessDenied":
      return "Your account isn't active. Ask an admin.";
    case "OAuthAccountNotLinked":
      return "That email is already registered with a different sign-in method.";
    default:
      return "Sign in failed. Try again.";
  }
}
