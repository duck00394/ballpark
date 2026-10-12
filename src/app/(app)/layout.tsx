import { BottomNav } from "@/components/bottom-nav";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireActor();
  return (
    <>
      <main className="app-main">{children}</main>
      <BottomNav />
    </>
  );
}
