import { redirect } from "next/navigation";
import { auth } from "@/auth";

// Admin-only chokepoint for the entire accounting module. Every page under
// /accounting renders inside this layout, so the role check here covers the
// overview, chart of accounts, journal, and any future accounting screens.
// The matching API routes under /api/accounting enforce the same rule, so the
// data is protected even if someone hits the endpoints directly.
export default async function AccountingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (session.user.role !== "admin") redirect("/");
  return <>{children}</>;
}
