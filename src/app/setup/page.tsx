import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await prisma.user.count()) > 0) redirect("/login");
  return (
    <main className="app-main pt-12">
      <h1 className="text-2xl font-bold">首次設定</h1>
      <p className="text-muted mt-1 mb-6">建立第一位管理者與你們的私人群組。之後由管理者在「個人 &gt; 成員管理」新增朋友。</p>
      <SetupForm />
    </main>
  );
}
