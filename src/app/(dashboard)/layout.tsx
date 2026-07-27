import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import Navbar from "@/components/layout/Navbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen bg-[#050807] text-white overflow-hidden">
      <Sidebar role={session.user.role} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Navbar user={session.user} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6 fade-in">
          {children}
        </main>
      </div>
    </div>
  );
}
