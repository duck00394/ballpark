import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { fromTaipei } from "@/lib/time";
import { actorOrNull } from "@/server/session";
import { backupFilename, collectExports, toCsv, toXlsx } from "@/server/services/backup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actor = await actorOrNull();
  if (!actor) return NextResponse.json({ error: "請先登入" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const date = (k: string) => {
    const v = sp.get(k);
    if (!v) return undefined;
    try {
      return fromTaipei(v);
    } catch {
      return undefined;
    }
  };
  const to = date("to");
  let userId = sp.get("user") || undefined;
  if (userId && !(await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: actor.groupId, userId } } }))) userId = undefined;
  const sets = await collectExports(actor, { from: date("from"), to: to ? new Date(to.getTime() + 86400_000) : undefined, userId });
  const headers = (name: string, type: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    "Cache-Control": "no-store",
  });
  if (sp.get("format") === "xlsx") {
    const buf = await toXlsx(sets);
    return new NextResponse(new Uint8Array(buf), { headers: headers(backupFilename("看球帳本", "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") });
  }
  const set = sets.find((s) => s.name === sp.get("set")) ?? sets[0];
  return new NextResponse(toCsv(set.rows), { headers: headers(backupFilename(`看球帳本-${set.title}`, "csv"), "text/csv; charset=utf-8") });
}
