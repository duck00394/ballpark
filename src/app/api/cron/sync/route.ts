import { NextResponse, type NextRequest } from "next/server";
import { syncCpbl } from "@/server/services/schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 排程同步（Vercel Cron 會帶 Authorization: Bearer <CRON_SECRET>） */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await syncCpbl({ triggeredBy: "CRON" });
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
