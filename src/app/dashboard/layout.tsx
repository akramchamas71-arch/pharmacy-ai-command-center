import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/authServer";
import { UserProvider } from "@/lib/userContext";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <UserProvider user={user}>
      <DashboardShell>{children}</DashboardShell>
    </UserProvider>
  );
}
