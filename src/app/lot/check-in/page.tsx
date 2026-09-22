import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { can } from "@/lib/rbac";
import { CheckInForm } from "./CheckInForm";

export const metadata = {
  title: "Check in a vehicle",
};

export default async function LotCheckInPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  // Recording an arrival is open to every role, so there is no gate here.
  // What the form may CLASSIFY is narrower — and these flags only decide what
  // to RENDER. The server action re-checks both from the session before it
  // writes anything, because hiding a control stops nobody from posting it.
  const canSetOwnership = can(session, "vehicle:setOwnership");
  const canSetLotStatus = can(session, "vehicle:setLotStatus");

  return (
    <AppShell
      title="Check in a vehicle"
      subtitle="Record a vehicle arriving on the Hempstead lot"
    >
      <div className="max-w-2xl mx-auto">
        {!canSetOwnership ? (
          <p className="mb-4 text-[12px] text-zinc-500 font-body bg-black/30 border border-white/5 rounded-lg p-3">
            Ownership is set by the office after check-in. Record what you can
            see and they will classify it.
          </p>
        ) : null}
        <CheckInForm
          canSetOwnership={canSetOwnership}
          canSetLotStatus={canSetLotStatus}
        />
      </div>
    </AppShell>
  );
}
