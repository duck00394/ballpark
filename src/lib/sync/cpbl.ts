/**
 * 中華職棒官網賽程資料（https://www.cpbl.com.tw/schedule）
 *
 * 實際觀察（2026-10-12）：賽程頁以 POST /schedule/getgamedatas 取得 JSON，
 * 需附上頁面內嵌的 RequestVerificationToken 標頭與同一次請求取得的防偽 Cookie。
 * 參數：calendar=YYYY/01/01、kindCode（A 例行賽、E 季後挑戰賽、C 總冠軍賽…）、location、teamNo。
 * 回應：{ Success: true, GameDatas: "<JSON 字串陣列>" }。
 *
 * 同一場比賽（GameSno）可能有多列：
 *   GameResult ""  → 尚未開賽（或進行中）
 *   GameResult "0" → 已完賽（PresentStatus 1），比分有效
 *   GameResult "1" → 延賽（此日期未比，之後會有新的一列）
 *   GameResult "2" → 保留比賽（ReserveDate 為續賽時間）
 * 這不是公開文件化的 API，格式可能改變，因此解析一律嚴格驗證，失敗時不寫入任何資料。
 */
import { z } from "zod";
import { parseLocalIso } from "@/lib/time";
import { CPBL_KIND } from "@/lib/labels";

export const CPBL_BASE = "https://www.cpbl.com.tw";

export const cpblRowSchema = z.object({
  GameSno: z.number().int(),
  KindCode: z.string(),
  Year: z.string(),
  GameDate: z.string(),
  PreExeDate: z.string().nullable(),
  GameDateTimeS: z.string().nullable().optional(),
  GameDateTimeE: z.string().nullable().optional(),
  GameResult: z.string(),
  PresentStatus: z.number().nullable().optional(),
  IsPlayBall: z.string().nullable().optional(),
  ReserveDate: z.string().nullable().optional(),
  VisitingTeamCode: z.string(),
  VisitingTeamName: z.string(),
  HomeTeamCode: z.string(),
  HomeTeamName: z.string(),
  FieldAbbe: z.string().nullable(),
  VisitingScore: z.number().nullable().optional(),
  HomeScore: z.number().nullable().optional(),
});
export type CpblRow = z.infer<typeof cpblRowSchema>;

export type NormalizedStatus = "SCHEDULED" | "IN_PROGRESS" | "FINAL" | "POSTPONED" | "SUSPENDED" | "CANCELLED" | "OTHER";

export interface NormalizedGame {
  externalKey: string;
  league: "CPBL";
  season: number;
  kindCode: string;
  gameType: string;
  gameNumber: number;
  startAt: Date;
  home: { code: string; name: string };
  away: { code: string; name: string };
  venueName: string | null;
  status: NormalizedStatus;
  homeScore: number | null;
  awayScore: number | null;
  resultConfirmed: boolean;
  reserveDate: Date | null;
  note: string | null;
}

export function cpblExternalKey(year: number | string, kind: string, sno: number) {
  return `cpbl:${year}:${kind}:${sno}`;
}

function rowStart(r: CpblRow): Date | null {
  const pre = parseLocalIso(r.PreExeDate);
  // 保留比賽的 PreExeDate 只有日期（00:00），改用實際開打時間
  if (pre && !/T00:00(:00)?$/.test(r.PreExeDate ?? "")) return pre;
  return parseLocalIso(r.GameDateTimeS ?? null) ?? pre ?? parseLocalIso(r.GameDate);
}

/** 把官網多列資料整併為「一場比賽一筆」 */
export function normalizeCpblRows(raw: unknown[], now = new Date()): { games: NormalizedGame[]; skipped: number } {
  const rows: CpblRow[] = [];
  let skipped = 0;
  for (const r of raw) {
    const p = cpblRowSchema.safeParse(r);
    if (p.success) rows.push(p.data);
    else skipped++;
  }
  const groups = new Map<string, CpblRow[]>();
  for (const r of rows) {
    const k = cpblExternalKey(r.Year, r.KindCode, r.GameSno);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const games: NormalizedGame[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => (rowStart(a)?.getTime() ?? 0) - (rowStart(b)?.getTime() ?? 0));
    const finals = list.filter((r) => r.GameResult === "0");
    const pick = finals.length ? finals[finals.length - 1] : list[list.length - 1];
    const startAt = rowStart(pick);
    if (!startAt) {
      skipped++;
      continue;
    }
    let status: NormalizedStatus;
    let note: string | null = null;
    switch (pick.GameResult) {
      case "0":
        status = "FINAL";
        break;
      case "1":
        status = "POSTPONED";
        break;
      case "2":
        status = "SUSPENDED";
        break;
      case "": {
        const playing = pick.IsPlayBall === "Y" && !pick.GameDateTimeE && startAt <= now;
        status = playing ? "IN_PROGRESS" : "SCHEDULED";
        break;
      }
      default:
        status = "OTHER";
        note = `官網狀態代碼 ${pick.GameResult}`;
    }
    const postponedTimes = list.filter((r) => r.GameResult === "1").length;
    if (postponedTimes && status !== "POSTPONED") note = `曾延賽 ${postponedTimes} 次`;
    const final = status === "FINAL";
    const hasScore = status === "FINAL" || status === "SUSPENDED" || status === "IN_PROGRESS";
    games.push({
      externalKey: key,
      league: "CPBL",
      season: Number(pick.Year),
      kindCode: pick.KindCode,
      gameType: CPBL_KIND[pick.KindCode] ?? `賽事類型 ${pick.KindCode}`,
      gameNumber: pick.GameSno,
      startAt,
      home: { code: pick.HomeTeamCode, name: pick.HomeTeamName },
      away: { code: pick.VisitingTeamCode, name: pick.VisitingTeamName },
      venueName: pick.FieldAbbe?.trim() || null,
      status,
      homeScore: hasScore ? (pick.HomeScore ?? null) : null,
      awayScore: hasScore ? (pick.VisitingScore ?? null) : null,
      resultConfirmed: final && pick.HomeScore != null && pick.VisitingScore != null,
      reserveDate: status === "SUSPENDED" ? parseLocalIso(pick.ReserveDate ?? null) : null,
      note,
    });
  }
  return { games, skipped };
}

/** 從官網取得某賽季某賽事類型的原始資料 */
export async function fetchCpblSeason(year: number, kindCode: string, fetchImpl: typeof fetch = fetch): Promise<unknown[]> {
  const ctrl = AbortSignal.timeout(20_000);
  const ua = "Mozilla/5.0 (private baseball tracker; low-frequency schedule sync)";
  const page = await fetchImpl(`${CPBL_BASE}/schedule`, { headers: { "User-Agent": ua }, signal: ctrl });
  if (!page.ok) throw new Error(`官網賽程頁回應 ${page.status}`);
  const html = await page.text();
  const m = /getgamedatas['"][\s\S]{0,600}?RequestVerificationToken:\s*['"]([^'"]+)['"]/.exec(html);
  if (!m) throw new Error("官網頁面格式已改變，找不到驗證資訊");
  const setCookies =
    (page.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (page.headers.get("set-cookie") ? [page.headers.get("set-cookie")!] : []);
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const body = new URLSearchParams({ calendar: `${year}/01/01`, location: "", kindCode, teamNo: "" });
  const res = await fetchImpl(`${CPBL_BASE}/schedule/getgamedatas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      RequestVerificationToken: m[1],
      Cookie: cookie,
      Referer: `${CPBL_BASE}/schedule`,
      "User-Agent": ua,
    },
    body,
    signal: ctrl,
  });
  if (!res.ok) throw new Error(`官網賽程資料回應 ${res.status}`);
  return parseCpblResponse(await res.text());
}

/** 解析官網回應或使用者貼上的 JSON（接受完整回應物件或 GameDatas 陣列） */
export function parseCpblResponse(text: string): unknown[] {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("賽程資料不是有效的 JSON");
  }
  if (Array.isArray(j)) return j;
  const obj = z.object({ Success: z.boolean(), GameDatas: z.string().nullable().optional() }).safeParse(j);
  if (!obj.success) throw new Error("賽程資料格式不符");
  if (!obj.data.Success) throw new Error("官網回應失敗（Success=false）");
  const arr = JSON.parse(obj.data.GameDatas || "[]");
  if (!Array.isArray(arr)) throw new Error("賽程資料格式不符");
  return arr;
}
