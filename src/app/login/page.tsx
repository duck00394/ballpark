import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentSession } from "@/server/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string; m?: string }> }) {
  if ((await prisma.user.count()) === 0) redirect("/setup");
  const s = await currentSession();
  const sp = await searchParams;
  if (s && sp.e !== "nogroup") redirect("/");
  return (
    <main className="app-main pt-16">
      <h1 className="text-2xl font-bold">看球帳本</h1>
      <p className="text-muted mt-1 mb-8">朋友間的觀賽、票券與分帳</p>
      {sp.e === "nogroup" ? <p className="msg msg-error mb-4">你的帳號目前沒有加入任何群組，請聯絡管理者。</p> : null}
      {sp.m === "pw" ? <p className="msg msg-ok mb-4">密碼已更新，請用新密碼登入。</p> : null}
      <LoginForm />
    </main>
  );
}
