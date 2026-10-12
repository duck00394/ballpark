import { NextResponse, type NextRequest } from "next/server";
import { actorOrNull } from "@/server/session";

export const dynamic = "force-dynamic";

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i;

/** 檢查售票連結是否還能開啟（只允許 https 公開網址，避免被當成內網探測工具） */
export async function GET(req: NextRequest) {
  if (!(await actorOrNull())) return NextResponse.json({ ok: false, message: "請先登入" }, { status: 401 });
  let url: URL;
  try {
    url = new URL(req.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return NextResponse.json({ ok: false, message: "網址格式錯誤" });
  }
  if (url.protocol !== "https:" || PRIVATE.test(url.hostname)) return NextResponse.json({ ok: false, message: "只能檢查公開的 https 網址" });
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(6000) });
    if (res.status === 405 || res.status === 403) res = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(6000) });
    const ok = res.status < 400;
    return NextResponse.json({ ok, status: res.status, message: ok ? "可以開啟" : `網站回應 ${res.status}${res.status === 404 ? "（找不到頁面）" : ""}` });
  } catch {
    return NextResponse.json({ ok: false, message: "無法連線到網站" });
  }
}
