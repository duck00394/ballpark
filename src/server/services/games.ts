import { z } from "zod";
import type { GameStatus, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { addDays, fromTaipei, startOfTaipeiDay, taipeiParts } from "@/lib/time";
import { type Actor, audit, withTx } from "@/server/context";

export const gameInclude = {
  homeTeam: true,
  awayTeam: true,
  venue: true,
} satisfies Prisma.GameInclude;

export type GameWithRefs = Prisma.GameGetPayload<{ include: typeof gameInclude }>;

/** 群組可見的比賽：官方共用賽程 + 本群組手動建立的比賽 */
export function visibleGames(actor: Actor): Prisma.GameWhereInput {
  return { OR: [{ groupId: null }, { groupId: actor.groupId }] };
}

export async function getVisibleGame(actor: Actor, gameId: string, db: Tx = prisma) {
  const g = await db.game.findFirst({ where: { id: gameId, ...visibleGames(actor) }, include: gameInclude });
  if (!g) throw notFound("找不到比賽");
  return g;
}

export interface GameFilter {
  from?: Date;
  to?: Date;
  teamId?: string;
  venueId?: string;
  status?: GameStatus;
  memberId?: string; // 該成員有票或有觀賽紀錄的比賽
  season?: number;
  onlyWithTickets?: boolean;
}

export async function listGames(actor: Actor, f: GameFilter = {}, take = 500) {
  const and: Prisma.GameWhereInput[] = [visibleGames(actor)];
  if (f.from || f.to) and.push({ startAt: { gte: f.from, lt: f.to } });
  if (f.teamId) and.push({ OR: [{ homeTeamId: f.teamId }, { awayTeamId: f.teamId }] });
  if (f.venueId) and.push({ venueId: f.venueId });
  if (f.status) and.push({ status: f.status });
  if (f.season) and.push({ season: f.season });
  if (f.memberId)
    and.push({
      OR: [
        { tickets: { some: { groupId: actor.groupId, holderId: f.memberId, archived: false } } },
        { attendances: { some: { groupId: actor.groupId, userId: f.memberId } } },
      ],
    });
  if (f.onlyWithTickets) and.push({ orders: { some: { groupId: actor.groupId } } });
  return prisma.game.findMany({
    where: { AND: and },
    include: {
      ...gameInclude,
      _count: { select: { orders: { where: { groupId: actor.groupId } } } },
    },
    orderBy: [{ startAt: "asc" }, { gameNumber: "asc" }],
    take,
  });
}

export async function listTeams() {
  return prisma.team.findMany({ where: { active: true }, orderBy: [{ league: "asc" }, { name: "asc" }] });
}
export async function listVenues() {
  return prisma.venue.findMany({ orderBy: { name: "asc" } });
}

export async function createTeam(actor: Actor, input: { name: string; shortName?: string; league?: string }) {
  const name = z.string().trim().min(1, "請輸入球隊名稱").max(40).parse(input.name);
  const t = await prisma.team.create({
    data: { name, shortName: input.shortName?.trim() || name, league: input.league?.trim() || "CPBL" },
  });
  await audit(prisma, actor, "TEAM_CREATE", "Team", t.id, { name });
  return t;
}

export async function createVenue(actor: Actor, input: { name: string; city?: string }) {
  const name = z.string().trim().min(1, "請輸入球場名稱").max(40).parse(input.name);
  const v = await prisma.venue.create({ data: { name, city: input.city?.trim() || null } });
  await audit(prisma, actor, "VENUE_CREATE", "Venue", v.id, { name });
  return v;
}

const statusEnum = z.enum(["SCHEDULED", "IN_PROGRESS", "FINAL", "POSTPONED", "CANCELLED", "SUSPENDED", "OTHER"]);
const score = z.number().int("比分必須是整數").min(0, "比分不可為負數").max(99).nullable();

const gameSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "請選擇比賽日期"),
    time: z.string().regex(/^\d{1,2}:\d{2}$/, "請輸入開賽時間"),
    homeTeamId: z.string().min(1, "請選擇主隊"),
    awayTeamId: z.string().min(1, "請選擇客隊"),
    venueId: z.string().nullable(),
    league: z.string().trim().min(1).max(20).default("CPBL"),
    gameType: z.string().trim().min(1).max(20).default("例行賽"),
    name: z.string().trim().max(60).nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((d) => d.homeTeamId !== d.awayTeamId, { message: "主隊與客隊不可相同" });

/** 任何成員都可以手動新增比賽（只屬於自己的群組） */
/** 找出同一天（台灣時間）、同樣兩隊的官方比賽，不分主客 */
export async function findOfficialTwin(db: Tx, startAt: Date, teamA: string, teamB: string) {
  const day = startOfTaipeiDay(startAt);
  const list = await db.game.findMany({
    where: {
      groupId: null,
      startAt: { gte: day, lt: addDays(day, 1) },
      OR: [
        { homeTeamId: teamA, awayTeamId: teamB },
        { homeTeamId: teamB, awayTeamId: teamA },
      ],
    },
  });
  // 同一天有兩場（雙重賽）時，取開賽時間最接近的
  return list.sort((x, y) => Math.abs(+x.startAt - +startAt) - Math.abs(+y.startAt - +startAt))[0] ?? null;
}

export async function createManualGame(actor: Actor, input: z.input<typeof gameSchema>) {
  const d = gameSchema.parse(input);
  const startAt = fromTaipei(d.date, d.time);
  await assertTeamsVenue(d.homeTeamId, d.awayTeamId, d.venueId);
  if (await findOfficialTwin(prisma, startAt, d.homeTeamId, d.awayTeamId))
    throw invalid("官方賽程已經有這場比賽（同一天、同樣兩隊），請直接到「賽事」點選那場比賽購票，避免重複。");
  return withTx(async (tx) => {
    const g = await tx.game.create({
      data: {
        groupId: actor.groupId,
        source: "MANUAL",
        league: d.league,
        season: taipeiParts(startAt).year,
        gameType: d.gameType,
        name: d.name || null,
        note: d.note || null,
        startAt,
        homeTeamId: d.homeTeamId,
        awayTeamId: d.awayTeamId,
        venueId: d.venueId,
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, "GAME_CREATE", "Game", g.id);
    return g;
  });
}

async function assertTeamsVenue(home: string, away: string, venueId: string | null) {
  const n = await prisma.team.count({ where: { id: { in: [home, away] } } });
  if (n !== 2) throw invalid("球隊不存在");
  if (venueId && !(await prisma.venue.findUnique({ where: { id: venueId } }))) throw invalid("球場不存在");
}

function canEditGame(actor: Actor, g: { groupId: string | null }) {
  if (g.groupId === actor.groupId) return true; // 本群組手動比賽：成員皆可修改
  return g.groupId === null && actor.role === "ADMIN"; // 官方賽程：只有管理者可手動修正
}

/** 修改比賽基本資料（僅限手動建立的比賽；官方賽程由同步維護） */
export async function updateGameInfo(actor: Actor, gameId: string, version: number, input: z.input<typeof gameSchema>) {
  const d = gameSchema.parse(input);
  await assertTeamsVenue(d.homeTeamId, d.awayTeamId, d.venueId);
  return withTx(async (tx) => {
    const g = await getVisibleGame(actor, gameId, tx);
    if (g.groupId !== actor.groupId) throw forbidden("官方賽程的基本資料由同步維護，只能修正比分與狀態");
    const startAt = fromTaipei(d.date, d.time);
    const res = await tx.game.updateMany({
      where: { id: gameId, version },
      data: {
        startAt,
        season: taipeiParts(startAt).year,
        homeTeamId: d.homeTeamId,
        awayTeamId: d.awayTeamId,
        venueId: d.venueId,
        league: d.league,
        gameType: d.gameType,
        name: d.name || null,
        note: d.note || null,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw conflict();
    await recordChanges(tx, g, { startAt, venueId: d.venueId, homeTeamId: d.homeTeamId, awayTeamId: d.awayTeamId }, "MANUAL", actor.userId);
    await audit(tx, actor, "GAME_UPDATE", "Game", gameId, d);
  });
}

const resultSchema = z
  .object({
    status: statusEnum,
    homeScore: score,
    awayScore: score,
    resultConfirmed: z.boolean(),
    manualLock: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.status === "FINAL" && (d.homeScore == null || d.awayScore == null))
      ctx.addIssue({ code: "custom", message: "比賽結束必須填寫雙方比分" });
    if (d.resultConfirmed && d.status !== "FINAL")
      ctx.addIssue({ code: "custom", message: "只有比賽結束才能正式確認結果" });
  });

/** 手動更新比賽狀態與比分（含官方更正）。統計一律即時由比賽資料計算，因此修正後自動更新且不會重複計入。 */
export async function updateGameResult(actor: Actor, gameId: string, version: number, input: z.input<typeof resultSchema>) {
  const d = resultSchema.parse(input);
  return withTx(async (tx) => {
    const g = await getVisibleGame(actor, gameId, tx);
    if (!canEditGame(actor, g)) throw forbidden("官方賽程的比分只有管理者可以手動修正");
    const lock = g.groupId === null ? (d.manualLock ?? true) : false;
    const res = await tx.game.updateMany({
      where: { id: gameId, version },
      data: {
        status: d.status,
        homeScore: d.homeScore,
        awayScore: d.awayScore,
        resultConfirmed: d.resultConfirmed,
        manualLock: lock,
        ...(d.note !== undefined ? { note: d.note || null } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw conflict();
    await recordChanges(tx, g, { status: d.status, homeScore: d.homeScore, awayScore: d.awayScore }, "MANUAL", actor.userId);
    await audit(tx, actor, "GAME_RESULT", "Game", gameId, d);
  });
}

type Changeable = {
  startAt?: Date;
  venueId?: string | null;
  status?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  homeTeamId?: string;
  awayTeamId?: string;
};

/** 寫入比賽異動紀錄，回傳有變動的欄位 */
export async function recordChanges(
  tx: Tx,
  before: Changeable & { id: string },
  after: Changeable,
  source: "SYNC" | "MANUAL",
  actorId: string | null,
): Promise<string[]> {
  const changed: string[] = [];
  const rows: Prisma.GameChangeCreateManyInput[] = [];
  for (const key of Object.keys(after) as (keyof Changeable)[]) {
    const a = before[key];
    const b = after[key];
    const av = a instanceof Date ? a.toISOString() : a == null ? null : String(a);
    const bv = b instanceof Date ? b.toISOString() : b == null ? null : String(b);
    if (av !== bv) {
      changed.push(key);
      rows.push({ gameId: before.id, field: key, oldValue: av, newValue: bv, source, actorId });
    }
  }
  if (rows.length) await tx.gameChange.createMany({ data: rows });
  return changed;
}

/** 球隊正式賽季戰績（官方所有正式結果，與個人到場戰績分開） */
export async function teamSeasonRecords(season: number, kindCode = "A") {
  const games = await prisma.game.findMany({
    where: { groupId: null, season, kindCode, status: "FINAL", resultConfirmed: true },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const rec = new Map<string, { w: number; l: number; t: number }>();
  const get = (id: string) => rec.get(id) ?? (rec.set(id, { w: 0, l: 0, t: 0 }), rec.get(id)!);
  for (const g of games) {
    if (g.homeScore == null || g.awayScore == null) continue;
    const h = get(g.homeTeamId);
    const a = get(g.awayTeamId);
    if (g.homeScore > g.awayScore) {
      h.w++;
      a.l++;
    } else if (g.homeScore < g.awayScore) {
      h.l++;
      a.w++;
    } else {
      h.t++;
      a.t++;
    }
  }
  return rec;
}
