/**
 * 賽程同步服務（獨立於其他功能）：
 * - 只新增／更新比賽本身的欄位，從不觸碰訂單、票券、付款、觀賽紀錄。
 * - 以 externalKey 唯一識別，重複同步不會產生重複比賽。
 * - 取得或解析失敗時整批不寫入，既有賽程完整保留，並記錄失敗原因。
 * - 管理者手動鎖定（manualLock）的比賽，不覆蓋狀態與比分。
 */
import { z } from "zod";
import type { GameStatus } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, invalid } from "@/lib/errors";
import { fetchCpblSeason, normalizeCpblRows, parseCpblResponse, type NormalizedGame } from "@/lib/sync/cpbl";
import { fromTaipei, taipeiParts } from "@/lib/time";
import { type Actor, audit, requireAdmin } from "@/server/context";
import { findOfficialTwin, recordChanges } from "./games";

export interface ApplyResult {
  created: number;
  updated: number;
  unchanged: number;
  changedGameIds: string[];
}

async function teamFor(tx: Tx, league: string, code: string | null, rawName: string) {
  // 官網在對戰剛確定時（例如總冠軍賽）只給球隊代碼、名稱留空，因此空白名稱一律沿用既有資料
  const name = rawName.trim();
  if (code) {
    const byCode = await tx.team.findUnique({ where: { league_code: { league, code } } });
    if (byCode) {
      if (name && byCode.name !== name) {
        // 球隊改名時才更新，且不能撞到其他球隊的名稱
        const clash = await tx.team.findUnique({ where: { league_name: { league, name } } });
        if (!clash) await tx.team.update({ where: { id: byCode.id }, data: { name, shortName: name.replace("7-ELEVEn", "") } });
      }
      return byCode.id;
    }
  }
  if (name) {
    const byName = await tx.team.findUnique({ where: { league_name: { league, name } } });
    if (byName) {
      if (code && !byName.code) await tx.team.update({ where: { id: byName.id }, data: { code } });
      return byName.id;
    }
  }
  const label = name || code || "未定球隊";
  const existing = await tx.team.findUnique({ where: { league_name: { league, name: label } } });
  if (existing) return existing.id;
  const t = await tx.team.create({ data: { league, code, name: label, shortName: label.replace("7-ELEVEn", "") } });
  return t.id;
}

async function venueFor(tx: Tx, sourceName: string | null) {
  if (!sourceName) return null;
  const v =
    (await tx.venue.findUnique({ where: { sourceName } })) ?? (await tx.venue.findUnique({ where: { name: sourceName } }));
  if (v) return v.id;
  return (await tx.venue.create({ data: { name: sourceName, sourceName } })).id;
}

export async function applyNormalizedGames(tx: Tx, games: NormalizedGame[], groupId: string | null = null): Promise<ApplyResult> {
  const res: ApplyResult = { created: 0, updated: 0, unchanged: 0, changedGameIds: [] };
  const now = new Date();
  for (const n of games) {
    const homeTeamId = await teamFor(tx, n.league, n.home.code || null, n.home.name);
    const awayTeamId = await teamFor(tx, n.league, n.away.code || null, n.away.name);
    const venueId = await venueFor(tx, n.venueName);
    const existing = await tx.game.findUnique({ where: { externalKey: n.externalKey } });
    if (!existing) {
      await tx.game.create({
        data: {
          groupId,
          externalKey: n.externalKey,
          source: groupId ? "IMPORT" : "CPBL",
          league: n.league,
          season: n.season,
          kindCode: n.kindCode,
          gameType: n.gameType,
          gameNumber: n.gameNumber,
          startAt: n.startAt,
          homeTeamId,
          awayTeamId,
          venueId,
          status: n.status as GameStatus,
          homeScore: n.homeScore,
          awayScore: n.awayScore,
          resultConfirmed: n.resultConfirmed,
          reserveDate: n.reserveDate,
          note: n.note,
          lastSyncedAt: now,
        },
      });
      res.created++;
      continue;
    }
    if (existing.groupId !== groupId) continue; // 不同範圍的資料不互相覆蓋
    const next = {
      startAt: n.startAt,
      venueId,
      homeTeamId,
      awayTeamId,
      ...(existing.manualLock
        ? {}
        : { status: n.status, homeScore: n.homeScore, awayScore: n.awayScore }),
    };
    const changed = await recordChanges(tx, existing, next, "SYNC", null);
    const extraChanged =
      (!existing.manualLock && existing.resultConfirmed !== n.resultConfirmed) ||
      (existing.reserveDate?.getTime() ?? null) !== (n.reserveDate?.getTime() ?? null) ||
      existing.note !== n.note;
    if (changed.length || extraChanged) {
      await tx.game.update({
        where: { id: existing.id },
        data: {
          ...next,
          status: next.status as GameStatus | undefined,
          ...(existing.manualLock ? {} : { resultConfirmed: n.resultConfirmed }),
          reserveDate: n.reserveDate,
          note: n.note,
          gameType: n.gameType,
          lastSyncedAt: now,
          version: { increment: 1 },
        },
      });
      res.updated++;
      res.changedGameIds.push(existing.id);
    } else {
      await tx.game.update({ where: { id: existing.id }, data: { lastSyncedAt: now } });
      res.unchanged++;
    }
  }
  return res;
}

/**
 * 合併重複比賽：群組自建（或 CSV 匯入）的比賽，如果官方賽程已有同一天、同樣兩隊的比賽，
 * 把訂單、票券、觀賽紀錄移到官方那場，再刪除自建的那場。金額與付款紀錄都掛在訂單上，不受影響。
 */
export async function mergeDuplicateGames(tx: Tx): Promise<number> {
  const manual = await tx.game.findMany({ where: { groupId: { not: null } } });
  let merged = 0;
  for (const m of manual) {
    const official = await findOfficialTwin(tx, m.startAt, m.homeTeamId, m.awayTeamId);
    if (!official) continue;
    await tx.ticketOrder.updateMany({ where: { gameId: m.id }, data: { gameId: official.id } });
    await tx.ticket.updateMany({ where: { gameId: m.id }, data: { gameId: official.id } });
    const atts = await tx.gameAttendance.findMany({ where: { gameId: m.id } });
    for (const a of atts) {
      const exists = await tx.gameAttendance.findUnique({
        where: { groupId_gameId_userId: { groupId: a.groupId, gameId: official.id, userId: a.userId } },
      });
      if (exists) await tx.gameAttendance.delete({ where: { id: a.id } });
      else await tx.gameAttendance.update({ where: { id: a.id }, data: { gameId: official.id } });
    }
    await tx.game.delete({ where: { id: m.id } });
    await tx.auditLog.create({
      data: { groupId: m.groupId, action: "GAME_MERGE", entityType: "Game", entityId: official.id, detail: { mergedFrom: m.id, startAt: m.startAt.toISOString() } },
    });
    merged++;
  }
  return merged;
}

const DEFAULT_KINDS = ["A", "E", "C"];

export function configuredKinds(): string[] {
  const env = process.env.SYNC_KIND_CODES?.split(",").map((s) => s.trim()).filter(Boolean);
  return env?.length ? env : DEFAULT_KINDS;
}

/** 從官網同步（排程或手動觸發）。每個賽事類型獨立處理，一個失敗不影響其他。 */
export async function syncCpbl(opts: {
  season?: number;
  kinds?: string[];
  triggeredBy: string;
  fetchImpl?: typeof fetch;
}) {
  const season = opts.season ?? taipeiParts(new Date()).year;
  const results: { kind: string; ok: boolean; message: string }[] = [];
  for (const kind of opts.kinds ?? configuredKinds()) {
    const log = await prisma.scheduleSyncLog.create({
      data: { source: "CPBL", scope: `${season}:${kind}`, triggeredBy: opts.triggeredBy },
    });
    try {
      const raw = await fetchCpblSeason(season, kind, opts.fetchImpl);
      const { games, skipped } = normalizeCpblRows(raw);
      if (raw.length > 0 && games.length === 0) throw new Error("資料格式無法解析，未寫入任何資料");
      const r = await prisma.$transaction(
        async (tx) => ({ ...(await applyNormalizedGames(tx, games)), merged: await mergeDuplicateGames(tx) }),
        { timeout: 120_000 },
      );
      const msg = `取得 ${raw.length} 列、${games.length} 場；新增 ${r.created}、更新 ${r.updated}、未變 ${r.unchanged}${r.merged ? `、合併 ${r.merged} 場重複的自建比賽` : ""}${skipped ? `、略過 ${skipped} 列格式不符` : ""}`;
      await prisma.scheduleSyncLog.update({
        where: { id: log.id },
        data: { finishedAt: new Date(), success: true, fetched: games.length, created: r.created, updated: r.updated, unchanged: r.unchanged, message: msg },
      });
      results.push({ kind, ok: true, message: msg });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.scheduleSyncLog.update({
        where: { id: log.id },
        data: { finishedAt: new Date(), success: false, message: msg.slice(0, 500) },
      });
      results.push({ kind, ok: false, message: msg });
    }
  }
  return results;
}

const MIN_MANUAL_INTERVAL_MS = 3 * 60_000;

/** 成員手動觸發同步（有頻率限制，避免對官網造成負擔） */
export async function manualSync(actor: Actor, fetchImpl?: typeof fetch) {
  const last = await prisma.scheduleSyncLog.findFirst({ where: { source: "CPBL" }, orderBy: { startedAt: "desc" } });
  if (last && Date.now() - last.startedAt.getTime() < MIN_MANUAL_INTERVAL_MS)
    throw new AppError("RATE_LIMIT", "剛剛已同步過，請 3 分鐘後再試");
  const r = await syncCpbl({ triggeredBy: actor.userId, fetchImpl });
  await audit(prisma, actor, "SCHEDULE_SYNC", "ScheduleSyncLog", null, r);
  return r;
}

/** 管理者貼上官網 JSON 匯入（官網無法從伺服器連線時的替代方案），寫入共用官方賽程 */
export async function importCpblJson(actor: Actor, text: string) {
  requireAdmin(actor);
  const raw = parseCpblResponse(text);
  const { games, skipped } = normalizeCpblRows(raw);
  if (!games.length) throw invalid("沒有可匯入的比賽");
  const log = await prisma.scheduleSyncLog.create({ data: { source: "CPBL_JSON", scope: "import", triggeredBy: actor.userId } });
  const r = await prisma.$transaction(
    async (tx) => ({ ...(await applyNormalizedGames(tx, games)), merged: await mergeDuplicateGames(tx) }),
    { timeout: 120_000 },
  );
  const msg = `匯入 ${games.length} 場；新增 ${r.created}、更新 ${r.updated}、未變 ${r.unchanged}${r.merged ? `；合併 ${r.merged} 場重複的自建比賽（票券與付款已移到官方賽程）` : ""}${skipped ? `、略過 ${skipped} 列` : ""}`;
  await prisma.scheduleSyncLog.update({
    where: { id: log.id },
    data: { finishedAt: new Date(), success: true, fetched: games.length, created: r.created, updated: r.updated, unchanged: r.unchanged, message: msg },
  });
  await audit(prisma, actor, "SCHEDULE_IMPORT", "ScheduleSyncLog", log.id, { msg });
  return msg;
}

/**
 * CSV 匯入（群組自有賽程）：欄位
 * 日期,時間,客隊,主隊,球場,狀態,客隊得分,主隊得分,編號,賽事類型
 * 狀態可填：尚未開賽／比賽結束／延期／取消／保留比賽（留空 = 尚未開賽）。
 * 「編號」用來避免重複匯入；同編號再次匯入會更新該場。
 */
export async function importCsvGames(actor: Actor, csv: string) {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw invalid("CSV 至少需要標題列與一列資料");
  const header = splitCsv(lines[0]);
  const idx = (name: string) => header.indexOf(name);
  for (const need of ["日期", "時間", "客隊", "主隊"]) if (idx(need) < 0) throw invalid(`CSV 缺少「${need}」欄位`);
  const statusMap: Record<string, GameStatus> = {
    "": "SCHEDULED",
    尚未開賽: "SCHEDULED",
    比賽結束: "FINAL",
    延期: "POSTPONED",
    取消: "CANCELLED",
    保留比賽: "SUSPENDED",
  };
  const games: NormalizedGame[] = [];
  const errors: string[] = [];
  for (const [i, line] of lines.slice(1).entries()) {
    const c = splitCsv(line);
    const get = (n: string) => (idx(n) >= 0 ? (c[idx(n)] ?? "").trim() : "");
    try {
      const date = get("日期").replace(/\//g, "-");
      const startAt = fromTaipei(date, get("時間") || "18:35");
      const st = statusMap[get("狀態")];
      if (!st) throw new Error(`狀態「${get("狀態")}」無法辨識`);
      const sc = (s: string) => (s === "" ? null : z.coerce.number().int().min(0).parse(s));
      const hs = sc(get("主隊得分"));
      const as = sc(get("客隊得分"));
      if (st === "FINAL" && (hs == null || as == null)) throw new Error("比賽結束需要比分");
      const no = get("編號") || `${date}-${get("客隊")}-${get("主隊")}`;
      const key = `import:${actor.groupId}:${no}`;
      games.push({
        externalKey: key,
        league: "CPBL",
        season: taipeiParts(startAt).year,
        kindCode: "",
        gameType: get("賽事類型") || "例行賽",
        gameNumber: Number(get("編號")) || 0,
        startAt,
        home: { code: "", name: get("主隊") },
        away: { code: "", name: get("客隊") },
        venueName: get("球場") || null,
        status: st as NormalizedGame["status"],
        homeScore: hs,
        awayScore: as,
        resultConfirmed: st === "FINAL",
        reserveDate: null,
        note: null,
      });
      if (!get("主隊") || !get("客隊")) throw new Error("缺少球隊");
    } catch (e) {
      errors.push(`第 ${i + 2} 列：${e instanceof Error ? e.message : e}`);
    }
  }
  if (errors.length) throw invalid(`CSV 有錯誤，未匯入任何資料：\n${errors.slice(0, 10).join("\n")}`);
  const r = await prisma.$transaction(async (tx) => ({ ...(await applyNormalizedGames(tx, games, actor.groupId)), merged: await mergeDuplicateGames(tx) }), { timeout: 60_000 });
  await audit(prisma, actor, "SCHEDULE_CSV_IMPORT", "Game", null, r);
  return `匯入 ${games.length} 場；新增 ${r.created}、更新 ${r.updated}、未變 ${r.unchanged}${r.merged ? `；其中 ${r.merged} 場與官方賽程重複，已合併` : ""}`;
}

export function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function latestSyncLogs(take = 10) {
  return prisma.scheduleSyncLog.findMany({ orderBy: { startedAt: "desc" }, take });
}
