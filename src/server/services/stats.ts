import { z } from "zod";
import { prisma } from "@/lib/db";
import { forbidden, invalid } from "@/lib/errors";
import type { Outcome } from "@/lib/labels";
import { computeOrderShares, type FeeMode } from "@/lib/money";
import { outcomeForTeam, winPct } from "@/lib/results";
import { taipeiParts } from "@/lib/time";
import { type Actor, assertGroupMember, audit, withTx } from "@/server/context";
import { computeLedger } from "./finance";
import { getVisibleGame } from "./games";

const attendanceSchema = z.object({
  status: z.enum(["PLANNED", "ATTENDED", "ABSENT"]),
  supportTeamId: z.string().nullable(),
});

/** 設定觀賽紀錄（本人；管理者可代為修正） */
export async function setAttendance(actor: Actor, gameId: string, userId: string, input: z.input<typeof attendanceSchema>) {
  const d = attendanceSchema.parse(input);
  if (userId !== actor.userId && actor.role !== "ADMIN") throw forbidden("只能設定自己的觀賽紀錄");
  return withTx(async (tx) => {
    await assertGroupMember(tx, actor.groupId, userId);
    const g = await getVisibleGame(actor, gameId, tx);
    if (d.supportTeamId && d.supportTeamId !== g.homeTeamId && d.supportTeamId !== g.awayTeamId)
      throw invalid("支持球隊必須是本場參賽球隊");
    const a = await tx.gameAttendance.upsert({
      where: { groupId_gameId_userId: { groupId: actor.groupId, gameId, userId } },
      create: { groupId: actor.groupId, gameId, userId, ...d },
      update: d,
    });
    await audit(tx, actor, "ATTENDANCE_SET", "GameAttendance", a.id, { ...d, userId });
    return a;
  });
}

export async function removeAttendance(actor: Actor, gameId: string, userId: string) {
  if (userId !== actor.userId && actor.role !== "ADMIN") throw forbidden();
  await prisma.gameAttendance.deleteMany({ where: { groupId: actor.groupId, gameId, userId } });
  await audit(prisma, actor, "ATTENDANCE_REMOVE", "GameAttendance", null, { gameId, userId });
}

type Rec = { w: number; l: number; t: number; games: number };
const emptyRec = (): Rec => ({ w: 0, l: 0, t: 0, games: 0 });
function bump(r: Rec, o: Outcome) {
  if (o === "WIN") r.w++;
  else if (o === "LOSS") r.l++;
  else if (o === "TIE") r.t++;
}

/**
 * 個人統計定義：
 * - 到場場次：觀賽紀錄為「已到場」的不重複比賽（同場多筆訂單只算一場）。
 * - 到場勝敗和：只計入「已到場」且比賽「正式確認結束」、且支持球隊有參賽的比賽；
 *   延期、取消、保留、未開賽、未確認皆不計。勝率 = 勝 ÷（勝＋敗），和局不列入。
 * - 主／客場：以支持球隊在該場是主隊或客隊計算（依資料來源的主客隊定義）。
 * - 個人負擔：依分攤規則，自己持有的票價＋分到的手續費（只計「已購票／退票處理中」訂單，已退票票券不計）。
 */
export async function personalStats(actor: Actor, userId: string, year?: number) {
  await assertGroupMember(prisma, actor.groupId, userId);
  const atts = await prisma.gameAttendance.findMany({
    where: { groupId: actor.groupId, userId, status: "ATTENDED" },
    include: { game: { include: { homeTeam: true, awayTeam: true, venue: true } }, supportTeam: true },
  });
  const inYear = (d: Date) => !year || taipeiParts(d).year === year;
  const attended = atts.filter((a) => inYear(a.game.startAt)).sort((a, b) => +a.game.startAt - +b.game.startAt);

  const total = emptyRec();
  const bySupport = new Map<string, Rec & { name: string }>();
  const byTeamSeen = new Map<string, { name: string; games: number }>();
  const byVenue = new Map<string, { name: string; games: number }>();
  const byYear = new Map<number, Rec>();
  let home = 0;
  let away = 0;
  const history: { gameId: string; startAt: Date; label: string; venue: string | null; support: string | null; outcome: Outcome; score: string }[] = [];

  for (const a of attended) {
    const g = a.game;
    total.games++;
    const y = taipeiParts(g.startAt).year;
    const yr = byYear.get(y) ?? (byYear.set(y, emptyRec()), byYear.get(y)!);
    yr.games++;
    const o = outcomeForTeam(g, a.supportTeamId);
    bump(total, o);
    bump(yr, o);
    if (a.supportTeamId) {
      const s = bySupport.get(a.supportTeamId) ?? (bySupport.set(a.supportTeamId, { ...emptyRec(), name: a.supportTeam!.name }), bySupport.get(a.supportTeamId)!);
      s.games++;
      bump(s, o);
      if (a.supportTeamId === g.homeTeamId) home++;
      else if (a.supportTeamId === g.awayTeamId) away++;
    }
    for (const t of [g.homeTeam, g.awayTeam]) {
      const x = byTeamSeen.get(t.id) ?? (byTeamSeen.set(t.id, { name: t.name, games: 0 }), byTeamSeen.get(t.id)!);
      x.games++;
    }
    if (g.venue) {
      const v = byVenue.get(g.venue.id) ?? (byVenue.set(g.venue.id, { name: g.venue.name, games: 0 }), byVenue.get(g.venue.id)!);
      v.games++;
    }
    history.push({
      gameId: g.id,
      startAt: g.startAt,
      label: `${g.awayTeam.shortName} @ ${g.homeTeam.shortName}`,
      venue: g.venue?.name ?? null,
      support: a.supportTeam?.name ?? null,
      outcome: o,
      score: g.homeScore != null && g.awayScore != null ? `${g.awayScore}:${g.homeScore}` : "",
    });
  }

  // 共同觀賽次數
  const gameIds = attended.map((a) => a.gameId);
  const others = await prisma.gameAttendance.findMany({
    where: { groupId: actor.groupId, gameId: { in: gameIds }, status: "ATTENDED", userId: { not: userId } },
    select: { userId: true },
  });
  const together = new Map<string, number>();
  for (const o of others) together.set(o.userId, (together.get(o.userId) ?? 0) + 1);

  const spending = await personalSpending(actor.groupId, userId, year);
  const top = <T extends { games: number }>(m: Map<string, T>) => [...m.values()].sort((a, b) => b.games - a.games);

  return {
    year: year ?? null,
    total: { ...total, pct: winPct(total.w, total.l) },
    home,
    away,
    bySupport: top(bySupport).map((r) => ({ ...r, pct: winPct(r.w, r.l) })),
    byTeamSeen: top(byTeamSeen),
    byVenue: top(byVenue),
    byYear: [...byYear].sort((a, b) => b[0] - a[0]).map(([y, r]) => ({ year: y, ...r, pct: winPct(r.w, r.l) })),
    together,
    history: history.reverse(),
    spending,
    avgPerGame: spending.gamesWithCost ? Math.round(spending.burden / spending.gamesWithCost) : null,
  };
}

/**
 * 支出定義（三者不可混用）：
 * - 購票支出 purchased：自己當購票人所付出的訂單金額（票價＋手續費）。
 * - 個人負擔 burden：分攤後自己實際應負擔的金額。
 * - 代墊 advanced：購票支出中由他人應負擔的部分；尚未收回 uncollected：他人尚欠自己的金額。
 */
export async function personalSpending(groupId: string, userId: string, year?: number) {
  const orders = await prisma.ticketOrder.findMany({
    where: {
      groupId,
      status: { in: ["PURCHASED", "REFUNDING"] },
      OR: [{ buyerId: userId }, { tickets: { some: { holderId: userId } } }],
    },
    include: { tickets: true, game: { include: { homeTeam: true, awayTeam: true, venue: true } } },
  });
  let purchased = 0;
  let burden = 0;
  const byMonth = new Map<string, number>();
  const byTeam = new Map<string, { name: string; amount: number }>();
  const byVenue = new Map<string, { name: string; amount: number }>();
  const gamesWithCost = new Set<string>();
  for (const o of orders) {
    const at = o.game.startAt;
    if (year && taipeiParts(at).year !== year) continue;
    const s = computeOrderShares(
      {
        buyerId: o.buyerId,
        status: o.status,
        feeAmount: o.feeAmount,
        otherFeeAmount: o.otherFeeAmount,
        feeSplitMode: o.feeSplitMode as FeeMode,
        customFeeSplit: (o.customFeeSplit as Record<string, number> | null) ?? null,
      },
      o.tickets,
    );
    if (o.buyerId === userId) purchased += s.grandTotal;
    const mine = s.byUser.get(userId);
    const amt = mine ? mine.ticket + mine.fee : 0;
    if (amt <= 0) continue;
    burden += amt;
    gamesWithCost.add(o.gameId);
    const p = taipeiParts(o.purchasedAt ?? o.createdAt);
    const mk = `${p.year}-${String(p.month).padStart(2, "0")}`;
    byMonth.set(mk, (byMonth.get(mk) ?? 0) + amt);
    for (const t of [o.game.homeTeam, o.game.awayTeam]) {
      const x = byTeam.get(t.id) ?? (byTeam.set(t.id, { name: t.name, amount: 0 }), byTeam.get(t.id)!);
      x.amount += amt;
    }
    if (o.game.venue) {
      const v = byVenue.get(o.game.venue.id) ?? (byVenue.set(o.game.venue.id, { name: o.game.venue.name, amount: 0 }), byVenue.get(o.game.venue.id)!);
      v.amount += amt;
    }
  }
  const rows = await computeLedger(prisma, groupId, { userId });
  let advanced = 0;
  let uncollected = 0;
  let collected = 0;
  let iOwe = 0;
  for (const r of rows) {
    if (r.creditorId === userId) {
      advanced += r.due;
      collected += r.paid + r.settled - r.refunded;
      if (r.outstanding > 0) uncollected += r.outstanding;
    } else if (r.debtorId === userId && r.outstanding > 0) iOwe += r.outstanding;
  }
  return {
    purchased,
    burden,
    advanced,
    uncollected,
    collected,
    iOwe,
    gamesWithCost: gamesWithCost.size,
    byMonth: [...byMonth].sort((a, b) => b[0].localeCompare(a[0])),
    byTeam: [...byTeam.values()].sort((a, b) => b.amount - a.amount),
    byVenue: [...byVenue.values()].sort((a, b) => b.amount - a.amount),
  };
}
