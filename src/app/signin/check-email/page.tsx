export default function CheckEmailPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-[#161624] border border-white/5 rounded-xl p-8 space-y-3 text-center">
        <h1 className="text-xl font-display font-bold text-white">
          Check your email
        </h1>
        <p className="text-xs text-zinc-400 font-body leading-relaxed">
          A sign-in link has been sent. Click it to finish signing in. The link
          expires in 24 hours.
        </p>
      </div>
    </main>
  );
}
