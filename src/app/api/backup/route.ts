import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { actorOrNull } from "@/server/session";
import { backupFilename, exportBackup } from "@/server/services/backup";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await actorOrNull();
  if (!actor) return NextResponse.json({ error: "請先登入" }, { status: 401 });
  try {
    const data = await exportBackup(actor);
    return new NextResponse(JSON.stringify(data, null, 1), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(backupFilename("看球帳本-完整備份", "json"))}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 403 });
  }
}
