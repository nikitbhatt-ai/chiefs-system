import { signIn } from "@/auth";

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  return <SignInForm searchParams={searchParams} />;
}

async function SignInForm({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? "/";
  const error = params.error;

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
            {error === "AccessDenied"
              ? "Your account isn't provisioned yet. Ask an admin to invite you."
              : "Sign in failed. Try again."}
          </div>
        ) : null}

        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: callbackUrl });
          }}
        >
          <button
            type="submit"
            className="w-full bg-amber-500 text-black hover:bg-amber-400 font-body text-sm font-semibold h-10 rounded-lg transition-colors"
          >
            Sign in with Microsoft
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="h-px bg-white/10 flex-1" />
          <span className="text-[10px] text-zinc-600 font-body uppercase tracking-wider">
            or
          </span>
          <div className="h-px bg-white/10 flex-1" />
        </div>

        <form
          action={async (formData) => {
            "use server";
            await signIn("nodemailer", formData);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <div>
            <label className="text-[10px] text-zinc-500 font-body block mb-1 uppercase tracking-wider">
              Personal email
            </label>
            <input
              type="email"
              name="email"
              required
              placeholder="you@example.com"
              className="w-full bg-white/5 border border-white/10 rounded-lg text-sm text-white font-body py-2 px-3 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-white/5 border border-white/10 text-white hover:bg-white/10 font-body text-sm font-semibold h-10 rounded-lg transition-colors"
          >
            Email me a sign-in link
          </button>
        </form>

        <p className="text-[10px] text-zinc-600 font-body text-center leading-relaxed">
          You must be invited by an admin before you can sign in.
        </p>
      </div>
    </main>
  );
}
