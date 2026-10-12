import { z } from "zod";
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { invalid } from "@/lib/errors";
import {
  FEE_MODE_LABEL,
  GAME_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  OUTCOME_LABEL,
  PICKUP_STATUS_LABEL,
  REFUND_STATUS_LABEL,
  ATTENDANCE_LABEL,
  TRANSFER_STATUS_LABEL,
} from "@/lib/labels";
import { computeOrderShares, PAY_STATE_LABEL, type FeeMode } from "@/lib/money";
import { outcomeForTeam } from "@/lib/results";
import { fmtFull, ymd } from "@/lib/time";
import { type Actor, audit, lockGroup, requireAdmin, withTx } from "@/server/context";
import { canSeeSecret } from "./orders";
import { computeLedger } from "./finance";

export const BACKUP_FORMAT = "ballpark-backup";
export const BACKUP_VERSION = 1;

// ───────────── 匯出（CSV / Excel） ─────────────

type Row = Record<string, string | number | null>;
export interface Dataset {
  name: string;
  title: string;
  rows: Row[];
}

export interface ExportOptions {
  from?: Date; // 購票期間（以購票日期，未填則以建立日期）
  to?: Date;
  userId?: string; // 個人觀賽歷史的對象
}

export async function collectExports(actor: Actor, opts: ExportOptions = {}): Promise<Dataset[]> {
  const g = actor.groupId;
  const members = await prisma.groupMember.findMany({ where: { groupId: g }, include: { user: true } });
  const nm = new Map(members.map((m) => [m.userId, m.user.displayName]));
  const n = (id: string | null | undefined) => (id ? (nm.get(id) ?? id) : "");

  const orders = await prisma.ticketOrder.findMany({
    where: { groupId: g },
    include: { tickets: true, platform: true, game: { include: { homeTeam: true, awayTeam: true, venue: true } } },
    orderBy: { createdAt: "asc" },
  });
  const inPeriod = (o: (typeof orders)[number]) => {
    const d = o.purchasedAt ?? o.createdAt;
    return (!opts.from || d >= opts.from) && (!opts.to || d < opts.to);
  };
  const ledger = await computeLedger(prisma, g);
  const stateOf = new Map(ledger.map((r) => [`${r.orderId}|${r.debtorId}`, r.state]));
  const gameLabel = (o: (typeof orders)[number]) => `${o.game.awayTeam.name} @ ${o.game.homeTeam.name}`;

  const orderRows: Row[] = [];
  const ticketRows: Row[] = [];
  for (const o of orders.filter(inPeriod)) {
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
    const live = o.tickets.filter((t) => !t.archived);
    orderRows.push({
      訂單ID: o.id,
      比賽ID: o.gameId,
      比賽時間: fmtFull(o.game.startAt),
      對戰: gameLabel(o),
      球場: o.game.venue?.name ?? "",
      售票平台: o.platform?.name ?? "",
      訂單編號: o.orderNumber,
      購票人: n(o.buyerId),
      購票時間: o.purchasedAt ? fmtFull(o.purchasedAt) : "",
      狀態: ORDER_STATUS_LABEL[o.status],
      票種: o.ticketCategory,
      張數: live.length,
      票價合計: live.reduce((a, t) => a + t.price, 0),
      手續費: o.feeAmount,
      其他費用: o.otherFeeAmount,
      應分攤總額: s.grandTotal,
      實際支付總額: o.actualTotal,
      分攤方式: FEE_MODE_LABEL[o.feeSplitMode],
      備註: o.note,
    });
    for (const t of o.tickets) {
      ticketRows.push({
        票券ID: t.id,
        訂單ID: o.id,
        比賽ID: o.gameId,
        比賽時間: fmtFull(o.game.startAt),
        對戰: gameLabel(o),
        第幾張: t.seq,
        持有人: n(t.holderId),
        原始購票人: n(o.buyerId),
        票價: t.price,
        區域: t.section,
        排: t.rowLabel,
        座號: t.seatNumber,
        票券類型: t.ticketType,
        取票方式: t.pickupMethod,
        分票狀態: TRANSFER_STATUS_LABEL[t.transferStatus],
        取票狀態: PICKUP_STATUS_LABEL[t.pickupStatus],
        持有人付款狀態: t.holderId && t.holderId !== o.buyerId ? PAY_STATE_LABEL[(stateOf.get(`${o.id}|${t.holderId}`) as keyof typeof PAY_STATE_LABEL) ?? "NONE"] ?? "已退款" : "購票人自付",
        已移除: t.archived ? "是" : "",
        票券識別資訊: canSeeSecret(actor, t, o) ? t.secretInfo : t.secretInfo ? "（無權限檢視）" : "",
        備註: t.note,
      });
    }
  }

  const [payments, refunds, settlements] = await Promise.all([
    prisma.payment.findMany({ where: { groupId: g }, orderBy: { createdAt: "asc" } }),
    prisma.refund.findMany({ where: { groupId: g }, orderBy: { createdAt: "asc" } }),
    prisma.settlement.findMany({ where: { groupId: g }, include: { items: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const moneyRows: Row[] = [
    ...payments.map((p) => ({
      類型: p.settlementId ? "結算付款" : "付款",
      紀錄ID: p.id,
      訂單ID: p.orderId,
      結算ID: p.settlementId,
      付款人: n(p.payerId),
      收款人: n(p.payeeId),
      金額: p.amount,
      狀態: p.status === "VALID" ? "有效" : "已撤銷",
      時間: fmtFull(p.paidAt),
      方式: p.method,
      付款人確認: p.payerConfirmedAt ? fmtFull(p.payerConfirmedAt) : "",
      收款人確認: p.payeeConfirmedAt ? fmtFull(p.payeeConfirmedAt) : "",
      備註: [p.note, p.revokeReason ? `撤銷原因：${p.revokeReason}` : null].filter(Boolean).join("；"),
    })),
    ...refunds.map((r) => ({
      類型: r.kind === "PLATFORM" ? "平台退款" : "朋友退款",
      紀錄ID: r.id,
      訂單ID: r.orderId,
      結算ID: null,
      付款人: r.kind === "PLATFORM" ? "售票平台" : n(r.fromUserId),
      收款人: n(r.toUserId),
      金額: r.amount,
      狀態: REFUND_STATUS_LABEL[r.status],
      時間: fmtFull(r.completedAt ?? r.createdAt),
      方式: r.method,
      付款人確認: "",
      收款人確認: "",
      備註: r.note,
    })),
  ];
  const settlementRows: Row[] = settlements.flatMap((s) =>
    s.items.map((i) => ({
      結算ID: s.id,
      結算時間: fmtFull(s.createdAt),
      結算狀態: s.status === "COMPLETED" ? "已完成" : "已取消",
      淨額付款人: n(s.payerId),
      淨額收款人: n(s.payeeId),
      淨額: s.netAmount,
      明細訂單ID: i.orderId,
      明細應付人: n(i.debtorId),
      明細收款人: n(i.creditorId),
      明細金額: i.amount,
    })),
  );
  const balanceRows: Row[] = ledger.map((r) => ({
    訂單ID: r.orderId,
    應付人: n(r.debtorId),
    收款人: n(r.creditorId),
    應付: r.due,
    已付: r.paid,
    已退回: r.refunded,
    退款處理中: r.refundPending,
    已結算: r.settled,
    尚欠: r.outstanding,
    狀態: r.state === "REFUNDED" ? "已退款" : PAY_STATE_LABEL[r.state],
  }));

  const attendUser = opts.userId ?? actor.userId;
  const atts = await prisma.gameAttendance.findMany({
    where: { groupId: g, userId: attendUser },
    include: { game: { include: { homeTeam: true, awayTeam: true, venue: true } }, supportTeam: true },
  });
  atts.sort((a, b) => +a.game.startAt - +b.game.startAt);
  const attendanceRows: Row[] = atts.map((a) => ({
    比賽ID: a.gameId,
    成員: n(a.userId),
    比賽時間: fmtFull(a.game.startAt),
    客隊: a.game.awayTeam.name,
    主隊: a.game.homeTeam.name,
    球場: a.game.venue?.name ?? "",
    支持球隊: a.supportTeam?.name ?? "",
    觀賽狀態: ATTENDANCE_LABEL[a.status],
    比賽狀態: GAME_STATUS_LABEL[a.game.status],
    客隊得分: a.game.awayScore,
    主隊得分: a.game.homeScore,
    個人結果: a.status === "ATTENDED" ? OUTCOME_LABEL[outcomeForTeam(a.game, a.supportTeamId)] : "不計",
  }));

  const gameIds = new Set([...orders.map((o) => o.gameId), ...atts.map((a) => a.gameId)]);
  const allAtt = await prisma.gameAttendance.findMany({ where: { groupId: g }, select: { gameId: true } });
  for (const a of allAtt) gameIds.add(a.gameId);
  const games = await prisma.game.findMany({
    where: { id: { in: [...gameIds] } },
    include: { homeTeam: true, awayTeam: true, venue: true },
    orderBy: { startAt: "asc" },
  });
  const gameRows: Row[] = games.map((x) => ({
    比賽ID: x.id,
    外部編號: x.externalKey,
    聯盟: x.league,
    賽季: x.season,
    賽事類型: x.gameType,
    比賽時間: fmtFull(x.startAt),
    客隊: x.awayTeam.name,
    主隊: x.homeTeam.name,
    球場: x.venue?.name ?? "",
    狀態: GAME_STATUS_LABEL[x.status],
    客隊得分: x.awayScore,
    主隊得分: x.homeScore,
    正式確認: x.resultConfirmed ? "是" : "否",
    資料來源: x.source,
  }));
  const allAttRows = await prisma.gameAttendance.findMany({ where: { groupId: g }, include: { supportTeam: true } });
  const supportRows: Row[] = allAttRows.map((a) => ({
    比賽ID: a.gameId,
    成員: n(a.userId),
    支持球隊: a.supportTeam?.name ?? "",
    觀賽狀態: ATTENDANCE_LABEL[a.status],
  }));

  return [
    { name: "orders", title: "購票訂單", rows: orderRows },
    { name: "tickets", title: "票券", rows: ticketRows },
    { name: "money", title: "付款與退款", rows: moneyRows },
    { name: "settlements", title: "結算明細", rows: settlementRows },
    { name: "balances", title: "應收應付", rows: balanceRows },
    { name: "attendance", title: "個人觀賽歷史", rows: attendanceRows },
    { name: "games", title: "比賽結果", rows: gameRows },
    { name: "supports", title: "成員觀賽與支持球隊", rows: supportRows },
  ];
}

function csvCell(v: string | number | null | undefined) {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = `'${s}`; // 防止 CSV 公式注入
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[]): string {
  if (!rows.length) return "﻿";
  const cols = Object.keys(rows[0]);
  const lines = [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export async function toXlsx(sets: Dataset[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "棒球觀賽管理";
  for (const s of sets) {
    const ws = wb.addWorksheet(s.title);
    const cols = s.rows.length ? Object.keys(s.rows[0]) : ["（無資料）"];
    ws.columns = cols.map((c) => ({ header: c, key: c, width: Math.max(10, Math.min(30, c.length * 2 + 4)) }));
    ws.getRow(1).font = { bold: true };
    for (const r of s.rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ───────────── 完整備份（JSON） ─────────────

export async function buildBackup(db: Tx, groupId: string) {
  const group = await db.group.findUniqueOrThrow({ where: { id: groupId } });
  const members = await db.groupMember.findMany({ where: { groupId }, include: { user: true } });
  const orders = await db.ticketOrder.findMany({ where: { groupId } });
  const tickets = await db.ticket.findMany({ where: { groupId } });
  const ticketIds = tickets.map((t) => t.id);
  const attendances = await db.gameAttendance.findMany({ where: { groupId } });
  const gameIds = [...new Set([...orders.map((o) => o.gameId), ...attendances.map((a) => a.gameId)])];
  const games = await db.game.findMany({ where: { OR: [{ id: { in: gameIds } }, { groupId }] } });
  const teamIds = [...new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]).concat(members.map((m) => m.user.favoriteTeamId).filter(Boolean) as string[]))];
  const venueIds = [...new Set(games.map((g) => g.venueId).filter(Boolean) as string[])];
  const settlements = await db.settlement.findMany({ where: { groupId } });
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    group: { id: group.id, name: group.name },
    members: members.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      displayName: m.user.displayName,
      role: m.role,
      active: m.active,
      favoriteTeamId: m.user.favoriteTeamId,
      followedTeamIds: m.user.followedTeamIds,
      trackOtherTeams: m.user.trackOtherTeams,
    })),
    teams: await db.team.findMany({ where: { id: { in: teamIds } } }),
    venues: await db.venue.findMany({ where: { id: { in: venueIds } } }),
    games,
    gameChanges: await db.gameChange.findMany({ where: { gameId: { in: games.filter((g) => g.groupId === groupId).map((g) => g.id) } } }),
    platforms: await db.ticketPlatform.findMany({ where: { groupId } }),
    platformRefs: await db.ticketPlatform.findMany({ where: { groupId: null, id: { in: orders.map((o) => o.platformId).filter(Boolean) as string[] } } }),
    paymentMethods: await db.paymentMethod.findMany({ where: { groupId } }),
    orders,
    tickets,
    transfers: await db.ticketTransfer.findMany({ where: { ticketId: { in: ticketIds } } }),
    obligations: await db.obligation.findMany({ where: { groupId } }),
    payments: await db.payment.findMany({ where: { groupId } }),
    refunds: await db.refund.findMany({ where: { groupId } }),
    settlements,
    settlementItems: await db.settlementItem.findMany({ where: { settlementId: { in: settlements.map((s) => s.id) } } }),
    attendances,
    auditLogs: await db.auditLog.findMany({ where: { groupId }, orderBy: { createdAt: "asc" } }),
  };
}

export async function exportBackup(actor: Actor) {
  requireAdmin(actor);
  const data = await buildBackup(prisma, actor.groupId);
  await audit(prisma, actor, "BACKUP_EXPORT", "Group", actor.groupId);
  return data;
}

const anyRec = z.record(z.string(), z.unknown());
const idRec = anyRec.and(z.object({ id: z.string() }));
const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT, { error: "不是本 APP 的備份檔" }),
  version: z.number().int().max(BACKUP_VERSION, "備份檔版本比目前 APP 新，無法還原"),
  exportedAt: z.string(),
  group: z.object({ id: z.string(), name: z.string() }),
  members: z.array(z.object({ userId: z.string(), username: z.string(), displayName: z.string(), role: z.enum(["ADMIN", "MEMBER"]), active: z.boolean() }).passthrough()),
  teams: z.array(idRec),
  venues: z.array(idRec),
  games: z.array(idRec),
  gameChanges: z.array(idRec).default([]),
  platforms: z.array(idRec),
  platformRefs: z.array(idRec).default([]),
  paymentMethods: z.array(idRec).default([]),
  orders: z.array(idRec),
  tickets: z.array(idRec),
  transfers: z.array(idRec),
  obligations: z.array(idRec),
  payments: z.array(idRec),
  refunds: z.array(idRec),
  settlements: z.array(idRec),
  settlementItems: z.array(idRec),
  attendances: z.array(idRec),
  auditLogs: z.array(idRec).default([]),
});
type Backup = z.infer<typeof backupSchema>;
type R = Record<string, unknown> & { id: string };

export interface RestorePlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
  current: Record<string, number>;
  backupGroupName: string;
  exportedAt: string;
}

const s = (r: R, k: string) => r[k] as string;
const sn = (r: R, k: string) => (r[k] as string | null | undefined) ?? null;

/** 驗證備份：格式、內部關聯、成員對應、重複資料。不寫入任何資料。 */
export async function analyzeBackup(actor: Actor, json: string): Promise<{ plan: RestorePlan; data?: Backup; userMap?: Map<string, string> }> {
  requireAdmin(actor);
  const errors: string[] = [];
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { plan: emptyPlan(["檔案不是有效的 JSON"]) };
  }
  const p = backupSchema.safeParse(parsed);
  if (!p.success) return { plan: emptyPlan(p.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}：${i.message}`)) };
  const d = p.data;

  // 重複 ID
  for (const k of ["teams", "venues", "games", "orders", "tickets", "obligations", "payments", "refunds", "settlements", "settlementItems", "attendances", "transfers"] as const) {
    const ids = (d[k] as R[]).map((x) => x.id);
    if (new Set(ids).size !== ids.length) errors.push(`${k} 有重複的 ID`);
  }
  // 內部關聯
  const set = (arr: R[]) => new Set(arr.map((x) => x.id));
  const games = set(d.games as R[]);
  const orders = set(d.orders as R[]);
  const tickets = set(d.tickets as R[]);
  const settlements = set(d.settlements as R[]);
  const teams = set(d.teams as R[]);
  const memberIds = new Set(d.members.map((m) => m.userId));
  const platforms = new Set([...(d.platforms as R[]), ...(d.platformRefs as R[])].map((x) => x.id));
  const check = (cond: boolean, msg: string) => {
    if (!cond && errors.length < 30) errors.push(msg);
  };
  for (const g of d.games as R[]) check(teams.has(s(g, "homeTeamId")) && teams.has(s(g, "awayTeamId")), `比賽 ${g.id} 的球隊不存在於備份`);
  for (const o of d.orders as R[]) {
    check(games.has(s(o, "gameId")), `訂單 ${o.id} 的比賽不存在於備份`);
    check(memberIds.has(s(o, "buyerId")), `訂單 ${o.id} 的購票人不是備份中的成員`);
    check(!sn(o, "platformId") || platforms.has(s(o, "platformId")), `訂單 ${o.id} 的售票平台不存在於備份`);
  }
  for (const t of d.tickets as R[]) {
    check(orders.has(s(t, "orderId")), `票券 ${t.id} 的訂單不存在於備份`);
    check(!sn(t, "holderId") || memberIds.has(s(t, "holderId")), `票券 ${t.id} 的持有人不是備份中的成員`);
  }
  for (const x of d.transfers as R[]) check(tickets.has(s(x, "ticketId")), `分票紀錄 ${x.id} 的票券不存在`);
  for (const x of d.obligations as R[]) check(orders.has(s(x, "orderId")), `應付款 ${x.id} 的訂單不存在`);
  for (const x of d.payments as R[]) {
    check(!sn(x, "orderId") || orders.has(s(x, "orderId")), `付款 ${x.id} 的訂單不存在`);
    check(!sn(x, "settlementId") || settlements.has(s(x, "settlementId")), `付款 ${x.id} 的結算不存在`);
    check(Number.isInteger(x.amount), `付款 ${x.id} 金額不是整數`);
  }
  for (const x of d.refunds as R[]) check(!sn(x, "orderId") || orders.has(s(x, "orderId")), `退款 ${x.id} 的訂單不存在`);
  for (const x of d.settlementItems as R[]) {
    check(settlements.has(s(x, "settlementId")), `結算明細 ${x.id} 的結算不存在`);
    check(orders.has(s(x, "orderId")), `結算明細 ${x.id} 的訂單不存在`);
  }
  for (const x of d.attendances as R[]) check(games.has(s(x, "gameId")), `觀賽紀錄 ${x.id} 的比賽不存在`);

  // 成員對應（以帳號名稱對應到目前系統的使用者）
  const userMap = new Map<string, string>();
  const missing: string[] = [];
  for (const m of d.members) {
    const u = await prisma.user.findUnique({ where: { username: m.username } });
    if (u) userMap.set(m.userId, u.id);
    else missing.push(m.username);
  }
  if (missing.length) errors.push(`以下帳號在目前系統不存在，請先由管理者建立後再還原：${missing.join("、")}`);
  if (!userMap.has(d.members.find((m) => m.role === "ADMIN")?.userId ?? "") )
    warnings.push("備份中的管理者帳號無法對應，還原後請確認管理者設定");
  if (!d.members.some((m) => userMap.get(m.userId) === actor.userId))
    errors.push("你的帳號不在備份的成員名單中，無法還原（避免還原後失去管理權限）");

  // 與其他群組的 ID 衝突
  const conflictIds = await prisma.ticketOrder.count({
    where: { id: { in: [...orders] }, groupId: { not: actor.groupId } },
  });
  if (conflictIds) errors.push("備份資料與其他群組的資料 ID 衝突，無法還原到此群組");
  if (d.group.id !== actor.groupId) warnings.push(`備份來自其他群組「${d.group.name}」，將還原到目前群組`);

  const counts: Record<string, number> = {
    成員: d.members.length,
    比賽: d.games.length,
    訂單: d.orders.length,
    票券: d.tickets.length,
    付款: d.payments.length,
    退款: d.refunds.length,
    結算: d.settlements.length,
    觀賽紀錄: d.attendances.length,
  };
  const g = actor.groupId;
  const current: Record<string, number> = {
    成員: await prisma.groupMember.count({ where: { groupId: g } }),
    比賽: await prisma.game.count({ where: { groupId: g } }),
    訂單: await prisma.ticketOrder.count({ where: { groupId: g } }),
    票券: await prisma.ticket.count({ where: { groupId: g } }),
    付款: await prisma.payment.count({ where: { groupId: g } }),
    退款: await prisma.refund.count({ where: { groupId: g } }),
    結算: await prisma.settlement.count({ where: { groupId: g } }),
    觀賽紀錄: await prisma.gameAttendance.count({ where: { groupId: g } }),
  };
  return {
    plan: { ok: errors.length === 0, errors, warnings, counts, current, backupGroupName: d.group.name, exportedAt: d.exportedAt },
    data: d,
    userMap,
  };
}

function emptyPlan(errors: string[]): RestorePlan {
  return { ok: false, errors, warnings: [], counts: {}, current: {}, backupGroupName: "", exportedAt: "" };
}

export const RESTORE_CONFIRM_TEXT = "確認還原";

/** 以備份「取代」目前群組的資料。整個過程在單一交易中，失敗則完全不變；還原前自動保存目前資料快照。 */
export async function restoreBackup(actor: Actor, json: string, confirmText: string) {
  requireAdmin(actor);
  if (confirmText.trim() !== RESTORE_CONFIRM_TEXT) throw invalid(`請輸入「${RESTORE_CONFIRM_TEXT}」以確認還原`);
  const { plan, data: d, userMap } = await analyzeBackup(actor, json);
  if (!plan.ok || !d || !userMap) throw invalid(`備份檔驗證失敗：${plan.errors.join("；")}`);
  const g = actor.groupId;
  const U = (id: string | null | undefined) => (id ? (userMap.get(id) ?? id) : null);

  await withTx(async (tx) => {
    await lockGroup(tx, g);
    const snapshot = await buildBackup(tx, g);
    await tx.auditLog.create({
      data: { groupId: g, actorId: actor.userId, action: "RESTORE_PRE_SNAPSHOT", entityType: "Group", entityId: g, detail: JSON.parse(JSON.stringify(snapshot)) },
    });

    // 1. 刪除目前群組資料（依相依順序）
    const orderIds = (await tx.ticketOrder.findMany({ where: { groupId: g }, select: { id: true } })).map((o) => o.id);
    const ticketIds = (await tx.ticket.findMany({ where: { groupId: g }, select: { id: true } })).map((t) => t.id);
    await tx.settlementItem.deleteMany({ where: { settlement: { groupId: g } } });
    await tx.payment.deleteMany({ where: { groupId: g } });
    await tx.settlement.deleteMany({ where: { groupId: g } });
    await tx.refund.deleteMany({ where: { groupId: g } });
    await tx.obligation.deleteMany({ where: { groupId: g } });
    await tx.ticketTransfer.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await tx.ticket.deleteMany({ where: { groupId: g } });
    await tx.ticketOrder.deleteMany({ where: { id: { in: orderIds } } });
    await tx.gameAttendance.deleteMany({ where: { groupId: g } });
    await tx.game.deleteMany({ where: { groupId: g, orders: { none: {} }, tickets: { none: {} } } });
    await tx.ticketPlatform.deleteMany({ where: { groupId: g } });
    await tx.paymentMethod.deleteMany({ where: { groupId: g } });

    // 2. 球隊、球場：以既有資料對應，沒有才建立
    const teamMap = new Map<string, string>();
    for (const t of d.teams as R[]) {
      const league = s(t, "league") ?? "CPBL";
      const ex =
        (await tx.team.findUnique({ where: { id: t.id } })) ??
        (sn(t, "code") ? await tx.team.findUnique({ where: { league_code: { league, code: s(t, "code") } } }) : null) ??
        (await tx.team.findUnique({ where: { league_name: { league, name: s(t, "name") } } }));
      teamMap.set(t.id, ex ? ex.id : (await tx.team.create({ data: { id: t.id, league, code: sn(t, "code"), name: s(t, "name"), shortName: s(t, "shortName") ?? s(t, "name") } })).id);
    }
    const venueMap = new Map<string, string>();
    for (const v of d.venues as R[]) {
      const ex = (await tx.venue.findUnique({ where: { id: v.id } })) ?? (await tx.venue.findUnique({ where: { name: s(v, "name") } }));
      venueMap.set(v.id, ex ? ex.id : (await tx.venue.create({ data: { id: v.id, name: s(v, "name"), sourceName: sn(v, "sourceName"), city: sn(v, "city") } })).id);
    }
    // 3. 比賽：官方賽程以 externalKey 對應既有資料（不覆蓋），群組比賽重新建立
    const gameMap = new Map<string, string>();
    for (const x of d.games as R[]) {
      const ext = sn(x, "externalKey");
      const byId = await tx.game.findUnique({ where: { id: x.id } });
      const byExt = ext ? await tx.game.findUnique({ where: { externalKey: ext } }) : null;
      const ex = byExt ?? byId;
      if (ex) {
        gameMap.set(x.id, ex.id);
        continue;
      }
      const created = await tx.game.create({
        data: {
          id: x.id,
          groupId: x.groupId ? g : null,
          externalKey: ext,
          source: s(x, "source") as Prisma.GameCreateInput["source"],
          league: s(x, "league"),
          season: x.season as number,
          kindCode: sn(x, "kindCode"),
          gameType: s(x, "gameType"),
          gameNumber: (x.gameNumber as number | null) ?? null,
          name: sn(x, "name"),
          startAt: new Date(s(x, "startAt")),
          homeTeamId: teamMap.get(s(x, "homeTeamId"))!,
          awayTeamId: teamMap.get(s(x, "awayTeamId"))!,
          venueId: sn(x, "venueId") ? (venueMap.get(s(x, "venueId")) ?? null) : null,
          status: s(x, "status") as Prisma.GameCreateInput["status"],
          homeScore: (x.homeScore as number | null) ?? null,
          awayScore: (x.awayScore as number | null) ?? null,
          resultConfirmed: !!x.resultConfirmed,
          reserveDate: sn(x, "reserveDate") ? new Date(s(x, "reserveDate")) : null,
          manualLock: !!x.manualLock,
          note: sn(x, "note"),
          createdById: U(sn(x, "createdById")),
        },
      });
      gameMap.set(x.id, created.id);
    }
    const G = (id: string) => gameMap.get(id) ?? id;

    // 4. 成員設定
    for (const m of d.members) {
      const uid = userMap.get(m.userId)!;
      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId: g, userId: uid } },
        create: { groupId: g, userId: uid, role: m.role, active: m.active },
        update: { role: uid === actor.userId ? "ADMIN" : m.role, active: uid === actor.userId ? true : m.active },
      });
    }

    // 5. 平台、付款方式
    const platformMap = new Map<string, string>();
    for (const p of d.platformRefs as R[]) {
      const ex = (await tx.ticketPlatform.findUnique({ where: { id: p.id } })) ?? (await tx.ticketPlatform.findFirst({ where: { groupId: null, name: s(p, "name") } }));
      platformMap.set(p.id, ex ? ex.id : (await tx.ticketPlatform.create({ data: { name: s(p, "name"), webUrl: sn(p, "webUrl"), appUrl: sn(p, "appUrl"), groupId: g } })).id);
    }
    for (const p of d.platforms as R[]) {
      const created = await tx.ticketPlatform.create({ data: { id: p.id, groupId: g, name: s(p, "name"), webUrl: sn(p, "webUrl"), appUrl: sn(p, "appUrl"), note: sn(p, "note") } });
      platformMap.set(p.id, created.id);
    }
    for (const p of d.paymentMethods as R[]) await tx.paymentMethod.create({ data: { groupId: g, name: s(p, "name") } });

    // 6. 訂單、票券、分票紀錄
    const dt = (r: R, k: string) => (sn(r, k) ? new Date(s(r, k)) : null);
    for (const o of d.orders as R[])
      await tx.ticketOrder.create({
        data: {
          id: o.id,
          groupId: g,
          gameId: G(s(o, "gameId")),
          platformId: sn(o, "platformId") ? (platformMap.get(s(o, "platformId")) ?? null) : null,
          purchaseUrl: sn(o, "purchaseUrl"),
          purchasedAt: dt(o, "purchasedAt"),
          buyerId: U(s(o, "buyerId"))!,
          createdById: U(s(o, "createdById"))!,
          orderNumber: sn(o, "orderNumber"),
          ticketCategory: sn(o, "ticketCategory"),
          feeAmount: o.feeAmount as number,
          otherFeeAmount: o.otherFeeAmount as number,
          actualTotal: (o.actualTotal as number | null) ?? null,
          feeSplitMode: s(o, "feeSplitMode") as Prisma.TicketOrderCreateInput["feeSplitMode"],
          customFeeSplit: o.customFeeSplit
            ? Object.fromEntries(Object.entries(o.customFeeSplit as Record<string, number>).map(([k, v]) => [U(k)!, v]))
            : undefined,
          status: s(o, "status") as Prisma.TicketOrderCreateInput["status"],
          pickupDeadline: dt(o, "pickupDeadline"),
          note: sn(o, "note"),
          createdAt: dt(o, "createdAt") ?? undefined,
        },
      });
    for (const t of d.tickets as R[])
      await tx.ticket.create({
        data: {
          id: t.id,
          groupId: g,
          orderId: s(t, "orderId"),
          gameId: G(s(t, "gameId")),
          seq: t.seq as number,
          holderId: U(sn(t, "holderId")),
          price: t.price as number,
          section: sn(t, "section"),
          rowLabel: sn(t, "rowLabel"),
          seatNumber: sn(t, "seatNumber"),
          ticketType: s(t, "ticketType"),
          pickupMethod: sn(t, "pickupMethod"),
          secretInfo: sn(t, "secretInfo"),
          transferStatus: s(t, "transferStatus") as Prisma.TicketCreateInput["transferStatus"],
          pickupStatus: s(t, "pickupStatus") as Prisma.TicketCreateInput["pickupStatus"],
          receivedConfirmedAt: dt(t, "receivedConfirmedAt"),
          note: sn(t, "note"),
          archived: !!t.archived,
        },
      });
    if (d.transfers.length)
      await tx.ticketTransfer.createMany({
        data: (d.transfers as R[]).map((x) => ({
          id: x.id,
          ticketId: s(x, "ticketId"),
          action: s(x, "action"),
          fromUserId: U(sn(x, "fromUserId")),
          toUserId: U(sn(x, "toUserId")),
          actorId: U(s(x, "actorId"))!,
          note: sn(x, "note"),
          createdAt: new Date(s(x, "createdAt")),
        })),
      });

    // 7. 財務
    if (d.obligations.length)
      await tx.obligation.createMany({
        data: (d.obligations as R[]).map((x) => ({
          id: x.id,
          groupId: g,
          orderId: s(x, "orderId"),
          ticketId: sn(x, "ticketId"),
          debtorId: U(s(x, "debtorId"))!,
          creditorId: U(s(x, "creditorId"))!,
          kind: s(x, "kind") as "TICKET" | "FEE",
          amount: x.amount as number,
          active: !!x.active,
          voidedAt: dt(x, "voidedAt"),
          voidReason: sn(x, "voidReason"),
          createdAt: new Date(s(x, "createdAt")),
        })),
      });
    for (const x of d.settlements as R[])
      await tx.settlement.create({
        data: {
          id: x.id,
          groupId: g,
          payerId: U(s(x, "payerId"))!,
          payeeId: U(s(x, "payeeId"))!,
          netAmount: x.netAmount as number,
          status: s(x, "status") as "COMPLETED" | "CANCELLED",
          note: sn(x, "note"),
          createdById: U(s(x, "createdById"))!,
          cancelledAt: dt(x, "cancelledAt"),
          cancelledById: U(sn(x, "cancelledById")),
          cancelReason: sn(x, "cancelReason"),
          createdAt: new Date(s(x, "createdAt")),
        },
      });
    if (d.settlementItems.length)
      await tx.settlementItem.createMany({
        data: (d.settlementItems as R[]).map((x) => ({
          id: x.id,
          settlementId: s(x, "settlementId"),
          orderId: s(x, "orderId"),
          debtorId: U(s(x, "debtorId"))!,
          creditorId: U(s(x, "creditorId"))!,
          amount: x.amount as number,
        })),
      });
    for (const x of d.payments as R[])
      await tx.payment.create({
        data: {
          id: x.id,
          groupId: g,
          payerId: U(s(x, "payerId"))!,
          payeeId: U(s(x, "payeeId"))!,
          orderId: sn(x, "orderId"),
          settlementId: sn(x, "settlementId"),
          amount: x.amount as number,
          method: sn(x, "method"),
          paidAt: new Date(s(x, "paidAt")),
          status: s(x, "status") as "VALID" | "REVOKED",
          payerConfirmedAt: dt(x, "payerConfirmedAt"),
          payeeConfirmedAt: dt(x, "payeeConfirmedAt"),
          revokedAt: dt(x, "revokedAt"),
          revokedById: U(sn(x, "revokedById")),
          revokeReason: sn(x, "revokeReason"),
          note: sn(x, "note"),
          createdById: U(s(x, "createdById"))!,
          createdAt: new Date(s(x, "createdAt")),
        },
      });
    for (const x of d.refunds as R[])
      await tx.refund.create({
        data: {
          id: x.id,
          groupId: g,
          kind: s(x, "kind") as "PLATFORM" | "MEMBER",
          orderId: sn(x, "orderId"),
          fromUserId: U(sn(x, "fromUserId")),
          toUserId: U(s(x, "toUserId"))!,
          amount: x.amount as number,
          status: s(x, "status") as "PROCESSING" | "COMPLETED" | "CANCELLED",
          method: sn(x, "method"),
          note: sn(x, "note"),
          createdById: U(s(x, "createdById"))!,
          completedAt: dt(x, "completedAt"),
          createdAt: new Date(s(x, "createdAt")),
        },
      });
    if (d.attendances.length)
      await tx.gameAttendance.createMany({
        data: (d.attendances as R[]).map((x) => ({
          id: x.id,
          groupId: g,
          gameId: G(s(x, "gameId")),
          userId: U(s(x, "userId"))!,
          supportTeamId: sn(x, "supportTeamId") ? (teamMap.get(s(x, "supportTeamId")) ?? null) : null,
          status: s(x, "status") as "PLANNED" | "ATTENDED" | "ABSENT",
        })),
      });
    await audit(tx, actor, "BACKUP_RESTORE", "Group", g, plan.counts);
  });
  return plan;
}

export function backupFilename(prefix: string, ext: string) {
  return `${prefix}-${ymd(new Date())}.${ext}`;
}
