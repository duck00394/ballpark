import { z } from "zod";
import type { Prisma, Ticket } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { computeOrderShares, type FeeMode } from "@/lib/money";
import { fromTaipei } from "@/lib/time";
import { type Actor, assertGroupMember, audit, lockGroup, withTx } from "@/server/context";
import { getVisibleGame } from "./games";

const money = (label: string) =>
  z.number({ error: `${label}必須是數字` }).int(`${label}必須是整數`).min(0, `${label}不可為負數`).max(10_000_000);

const statusEnum = z.enum(["PENDING", "BUYING", "PURCHASED", "FAILED", "CANCELLED", "REFUNDING", "REFUNDED"]);
const feeModeEnum = z.enum(["BUYER_ABSORBS", "EQUAL_HOLDERS", "PER_TICKET", "CUSTOM"]);
const optStr = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const urlStr = z
  .string()
  .trim()
  .max(1000)
  .nullable()
  .optional()
  .transform((v) => v || null)
  .refine((v) => !v || /^https:\/\//i.test(v), "購票連結必須以 https:// 開頭");

const ticketInput = z.object({
  holderId: z.string().nullable().optional().transform((v) => v || null),
  price: money("票價").optional(),
  section: optStr(40),
  rowLabel: optStr(20),
  seatNumber: optStr(20),
  ticketType: optStr(20),
  pickupMethod: optStr(40),
  secretInfo: optStr(1000),
  note: optStr(300),
});

const orderFields = {
  platformId: z.string().nullable().optional().transform((v) => v || null),
  purchaseUrl: urlStr,
  purchasedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  purchasedTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  buyerId: z.string().min(1),
  orderNumber: optStr(60),
  ticketCategory: optStr(40),
  feeAmount: money("手續費"),
  otherFeeAmount: money("其他費用"),
  actualTotal: money("實際支付總額").nullable().optional(),
  feeSplitMode: feeModeEnum,
  customFeeSplit: z.record(z.string(), money("分攤金額")).nullable().optional(),
  status: statusEnum,
  pickupDeadlineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  pickupDeadlineTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(),
  note: optStr(1000),
};

const createSchema = z.object({
  gameId: z.string().min(1, "請選擇比賽"),
  ...orderFields,
  pricePerTicket: money("每張票價"),
  tickets: z.array(ticketInput).min(1, "至少一張票").max(30, "一筆訂單最多 30 張票"),
  clientRequestId: z.string().min(8).max(100).optional(),
});

function dt(date?: string | null, time?: string | null) {
  return date ? fromTaipei(date, time || "00:00") : null;
}

export function canEditOrder(actor: Actor, o: { createdById: string; buyerId: string }) {
  return actor.role === "ADMIN" || o.createdById === actor.userId || o.buyerId === actor.userId;
}

/** 依目前訂單與票券重新產生應付款：不同的舊紀錄作廢（保留歷史），新的建立 */
export async function syncObligations(tx: Tx, orderId: string, reason: string) {
  const order = await tx.ticketOrder.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: true } });
  const shares = computeOrderShares(
    {
      buyerId: order.buyerId,
      status: order.status,
      feeAmount: order.feeAmount,
      otherFeeAmount: order.otherFeeAmount,
      feeSplitMode: order.feeSplitMode as FeeMode,
      customFeeSplit: (order.customFeeSplit as Record<string, number> | null) ?? null,
    },
    order.tickets,
  );
  const existing = await tx.obligation.findMany({ where: { orderId, active: true } });
  const key = (o: { debtorId: string; kind: string; ticketId: string | null; amount: number }) =>
    `${o.kind}|${o.ticketId ?? "-"}|${o.debtorId}|${o.amount}`;
  const desired = new Map(shares.obligations.map((o) => [key(o), o]));
  const keep = new Set<string>();
  const toVoid: string[] = [];
  for (const e of existing) {
    const k = key(e);
    if (desired.has(k) && !keep.has(k) && e.creditorId === order.buyerId) keep.add(k);
    else toVoid.push(e.id);
  }
  if (toVoid.length)
    await tx.obligation.updateMany({
      where: { id: { in: toVoid } },
      data: { active: false, voidedAt: new Date(), voidReason: reason },
    });
  const create = [...desired].filter(([k]) => !keep.has(k)).map(([, o]) => o);
  if (create.length)
    await tx.obligation.createMany({
      data: create.map((o) => ({
        groupId: order.groupId,
        orderId,
        ticketId: o.ticketId,
        debtorId: o.debtorId,
        creditorId: order.buyerId,
        kind: o.kind,
        amount: o.amount,
      })),
    });
  return shares;
}

/** 持票人自動建立「預計到場」紀錄，支持球隊預設為最支持且有參賽的球隊 */
export async function ensureAttendance(tx: Tx, groupId: string, gameId: string, userId: string) {
  const exists = await tx.gameAttendance.findUnique({ where: { groupId_gameId_userId: { groupId, gameId, userId } } });
  if (exists) return exists;
  const [game, user] = await Promise.all([
    tx.game.findUniqueOrThrow({ where: { id: gameId } }),
    tx.user.findUniqueOrThrow({ where: { id: userId } }),
  ]);
  const fav = user.favoriteTeamId;
  const support = fav && (fav === game.homeTeamId || fav === game.awayTeamId) ? fav : null;
  return tx.gameAttendance.create({ data: { groupId, gameId, userId, supportTeamId: support, status: "PLANNED" } });
}

async function validateMembers(tx: Tx, groupId: string, ids: (string | null | undefined)[]) {
  for (const id of new Set(ids.filter(Boolean) as string[])) await assertGroupMember(tx, groupId, id, "持有人或購票人");
}

export async function createOrder(actor: Actor, input: z.input<typeof createSchema>) {
  const d = createSchema.parse(input);
  if (d.clientRequestId) {
    const dup = await prisma.ticketOrder.findUnique({ where: { clientRequestId: d.clientRequestId } });
    if (dup) {
      if (dup.groupId !== actor.groupId) throw conflict("重複的請求");
      return dup; // 重複送出：回傳原本的訂單，不建立新的
    }
  }
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const game = await getVisibleGame(actor, d.gameId, tx);
    await validateMembers(tx, actor.groupId, [d.buyerId, ...d.tickets.map((t) => t.holderId)]);
    if (d.platformId) await assertPlatform(tx, actor, d.platformId);
    if (d.feeSplitMode === "CUSTOM") await validateMembers(tx, actor.groupId, Object.keys(d.customFeeSplit ?? {}));
    const order = await tx.ticketOrder.create({
      data: {
        groupId: actor.groupId,
        gameId: game.id,
        platformId: d.platformId,
        purchaseUrl: d.purchaseUrl,
        purchasedAt: dt(d.purchasedDate, d.purchasedTime),
        buyerId: d.buyerId,
        createdById: actor.userId,
        orderNumber: d.orderNumber,
        ticketCategory: d.ticketCategory,
        feeAmount: d.feeAmount,
        otherFeeAmount: d.otherFeeAmount,
        actualTotal: d.actualTotal ?? null,
        feeSplitMode: d.feeSplitMode,
        customFeeSplit: d.feeSplitMode === "CUSTOM" ? (d.customFeeSplit ?? {}) : undefined,
        status: d.status,
        pickupDeadline: dt(d.pickupDeadlineDate, d.pickupDeadlineTime),
        note: d.note,
        clientRequestId: d.clientRequestId,
      },
    });
    for (const [i, t] of d.tickets.entries()) {
      const ticket = await tx.ticket.create({
        data: {
          groupId: actor.groupId,
          orderId: order.id,
          gameId: game.id,
          seq: i + 1,
          holderId: t.holderId,
          price: t.price ?? d.pricePerTicket,
          section: t.section,
          rowLabel: t.rowLabel,
          seatNumber: t.seatNumber,
          ticketType: t.ticketType || "電子票",
          pickupMethod: t.pickupMethod,
          secretInfo: t.secretInfo,
          note: t.note,
          transferStatus: t.holderId ? "ASSIGNED" : "UNASSIGNED",
        },
      });
      if (t.holderId) {
        await tx.ticketTransfer.create({
          data: { ticketId: ticket.id, action: "ASSIGN", toUserId: t.holderId, actorId: actor.userId },
        });
        await ensureAttendance(tx, actor.groupId, game.id, t.holderId);
      }
    }
    await syncObligations(tx, order.id, "建立訂單");
    await audit(tx, actor, "ORDER_CREATE", "TicketOrder", order.id, { tickets: d.tickets.length });
    return order;
  });
}

async function assertPlatform(tx: Tx, actor: Actor, platformId: string) {
  const p = await tx.ticketPlatform.findFirst({
    where: { id: platformId, OR: [{ groupId: null }, { groupId: actor.groupId }] },
  });
  if (!p) throw invalid("售票平台不存在");
}

const updateSchema = z.object(orderFields);

export async function updateOrder(actor: Actor, orderId: string, version: number, input: z.input<typeof updateSchema>) {
  const d = updateSchema.parse(input);
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const o = await getOrderForActor(tx, actor, orderId);
    if (!canEditOrder(actor, o)) throw forbidden("只有訂單建立者、購票人或管理者可以修改訂單");
    await validateMembers(tx, actor.groupId, [d.buyerId]);
    if (d.platformId) await assertPlatform(tx, actor, d.platformId);
    if (d.feeSplitMode === "CUSTOM") await validateMembers(tx, actor.groupId, Object.keys(d.customFeeSplit ?? {}));
    const res = await tx.ticketOrder.updateMany({
      where: { id: orderId, version },
      data: {
        platformId: d.platformId,
        purchaseUrl: d.purchaseUrl,
        purchasedAt: dt(d.purchasedDate, d.purchasedTime),
        buyerId: d.buyerId,
        orderNumber: d.orderNumber,
        ticketCategory: d.ticketCategory,
        feeAmount: d.feeAmount,
        otherFeeAmount: d.otherFeeAmount,
        actualTotal: d.actualTotal ?? null,
        feeSplitMode: d.feeSplitMode,
        customFeeSplit: d.feeSplitMode === "CUSTOM" ? (d.customFeeSplit ?? {}) : undefined,
        status: d.status,
        pickupDeadline: dt(d.pickupDeadlineDate, d.pickupDeadlineTime),
        note: d.note,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw conflict();
    try {
      await syncObligations(tx, orderId, "修改訂單");
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : "分攤設定錯誤");
    }
    await audit(tx, actor, "ORDER_UPDATE", "TicketOrder", orderId, {
      before: { status: o.status, fee: o.feeAmount, other: o.otherFeeAmount, mode: o.feeSplitMode, buyerId: o.buyerId },
      after: { status: d.status, fee: d.feeAmount, other: d.otherFeeAmount, mode: d.feeSplitMode, buyerId: d.buyerId },
    });
  });
}

export async function getOrderForActor(db: Tx, actor: Actor, orderId: string) {
  const o = await db.ticketOrder.findFirst({ where: { id: orderId, groupId: actor.groupId } });
  if (!o) throw notFound("找不到訂單");
  return o;
}

export async function addTicket(actor: Actor, orderId: string, price?: number) {
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const o = await getOrderForActor(tx, actor, orderId);
    if (!canEditOrder(actor, o)) throw forbidden();
    const last = await tx.ticket.findFirst({ where: { orderId }, orderBy: { seq: "desc" } });
    if ((await tx.ticket.count({ where: { orderId, archived: false } })) >= 30) throw invalid("一筆訂單最多 30 張票");
    const t = await tx.ticket.create({
      data: {
        groupId: actor.groupId,
        orderId,
        gameId: o.gameId,
        seq: (last?.seq ?? 0) + 1,
        price: money("票價").parse(price ?? last?.price ?? 0),
        ticketType: last?.ticketType ?? "電子票",
      },
    });
    await tx.ticketOrder.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
    await syncObligations(tx, orderId, "新增票券");
    await audit(tx, actor, "TICKET_ADD", "Ticket", t.id);
    return t;
  });
}

/** 移除票券：不實體刪除，只封存並作廢其應付款；既有付款保留，多付的部分會顯示為待退款 */
export async function archiveTicket(actor: Actor, ticketId: string) {
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const t = await getTicketForActor(tx, actor, ticketId);
    const o = await tx.ticketOrder.findUniqueOrThrow({ where: { id: t.orderId } });
    if (!canEditOrder(actor, o)) throw forbidden();
    await tx.ticket.update({ where: { id: ticketId }, data: { archived: true, version: { increment: 1 } } });
    await tx.ticketTransfer.create({ data: { ticketId, action: "ARCHIVE", fromUserId: t.holderId, actorId: actor.userId } });
    await syncObligations(tx, t.orderId, "移除票券");
    await audit(tx, actor, "TICKET_ARCHIVE", "Ticket", ticketId);
  });
}

export async function getTicketForActor(db: Tx, actor: Actor, ticketId: string) {
  const t = await db.ticket.findFirst({ where: { id: ticketId, groupId: actor.groupId } });
  if (!t) throw notFound("找不到票券");
  return t;
}

const ticketUpdateSchema = ticketInput.extend({
  price: money("票價"),
  transferStatus: z.enum(["UNASSIGNED", "ASSIGNED", "DELIVERED", "REVOKED"]),
  pickupStatus: z.enum(["NOT_PICKED", "PICKED", "FAILED", "REFUNDED", "NOT_APPLICABLE"]),
});

/** 訂單管理者修改票券（座位、持有人、狀態、票價…） */
export async function updateTicket(actor: Actor, ticketId: string, version: number, input: z.input<typeof ticketUpdateSchema>) {
  const d = ticketUpdateSchema.parse(input);
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const t = await getTicketForActor(tx, actor, ticketId);
    if (t.archived) throw invalid("此票券已移除");
    const o = await tx.ticketOrder.findUniqueOrThrow({ where: { id: t.orderId } });
    if (!canEditOrder(actor, o)) throw forbidden("只有訂單建立者、購票人或管理者可以修改票券");
    if (d.holderId) await assertGroupMember(tx, actor.groupId, d.holderId, "持有人");

    let transferStatus = d.transferStatus;
    let received = t.receivedConfirmedAt;
    const logs: Prisma.TicketTransferCreateManyInput[] = [];
    if (d.holderId !== t.holderId) {
      if (t.holderId) logs.push({ ticketId, action: "REVOKE", fromUserId: t.holderId, toUserId: d.holderId, actorId: actor.userId });
      if (d.holderId) logs.push({ ticketId, action: "ASSIGN", fromUserId: t.holderId, toUserId: d.holderId, actorId: actor.userId });
      received = null;
      // 換人時交付狀態重新開始（不沿用前一位的「已交付」）
      transferStatus = d.holderId ? (d.transferStatus === "DELIVERED" ? "DELIVERED" : "ASSIGNED") : t.holderId ? "REVOKED" : "UNASSIGNED";
    }
    if (!d.holderId && (transferStatus === "ASSIGNED" || transferStatus === "DELIVERED"))
      throw invalid("尚未指定持有人，不能設為「已指定」或「已交付」");
    if (transferStatus === "DELIVERED" && t.transferStatus !== "DELIVERED")
      logs.push({ ticketId, action: "DELIVER", toUserId: d.holderId, actorId: actor.userId });
    if (d.pickupStatus !== t.pickupStatus)
      logs.push({ ticketId, action: `PICKUP:${d.pickupStatus}`, toUserId: d.holderId, actorId: actor.userId });

    const res = await tx.ticket.updateMany({
      where: { id: ticketId, version },
      data: {
        holderId: d.holderId,
        price: d.price,
        section: d.section,
        rowLabel: d.rowLabel,
        seatNumber: d.seatNumber,
        ticketType: d.ticketType || "電子票",
        pickupMethod: d.pickupMethod,
        secretInfo: d.secretInfo,
        note: d.note,
        transferStatus,
        pickupStatus: d.pickupStatus,
        receivedConfirmedAt: received,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw conflict();
    if (logs.length) await tx.ticketTransfer.createMany({ data: logs });
    if (d.holderId) await ensureAttendance(tx, actor.groupId, t.gameId, d.holderId);
    await syncObligations(tx, t.orderId, "修改票券");
    await audit(tx, actor, "TICKET_UPDATE", "Ticket", ticketId, {
      before: pickAudit(t),
      after: { holderId: d.holderId, price: d.price, transferStatus, pickupStatus: d.pickupStatus },
    });
  });
}

function pickAudit(t: Ticket) {
  return { holderId: t.holderId, price: t.price, transferStatus: t.transferStatus, pickupStatus: t.pickupStatus };
}

/** 持有人確認已收到票券 */
export async function confirmTicketReceived(actor: Actor, ticketId: string) {
  return withTx(async (tx) => {
    const t = await getTicketForActor(tx, actor, ticketId);
    if (t.holderId !== actor.userId) throw forbidden("只有票券持有人可以確認收到");
    if (t.receivedConfirmedAt) return;
    await tx.ticket.update({
      where: { id: ticketId },
      data: { receivedConfirmedAt: new Date(), transferStatus: "DELIVERED", version: { increment: 1 } },
    });
    await tx.ticketTransfer.create({ data: { ticketId, action: "CONFIRM_RECEIVED", toUserId: actor.userId, actorId: actor.userId } });
    await audit(tx, actor, "TICKET_RECEIVED", "Ticket", ticketId);
  });
}

/** 持有人或訂單管理者更新取票狀態 */
export async function setPickupStatus(actor: Actor, ticketId: string, status: "NOT_PICKED" | "PICKED" | "FAILED" | "NOT_APPLICABLE") {
  z.enum(["NOT_PICKED", "PICKED", "FAILED", "NOT_APPLICABLE"]).parse(status);
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const t = await getTicketForActor(tx, actor, ticketId);
    const o = await tx.ticketOrder.findUniqueOrThrow({ where: { id: t.orderId } });
    if (t.holderId !== actor.userId && !canEditOrder(actor, o)) throw forbidden();
    if (t.pickupStatus === "REFUNDED") throw invalid("已退票的票券不能更改取票狀態");
    await tx.ticket.update({ where: { id: ticketId }, data: { pickupStatus: status, version: { increment: 1 } } });
    await tx.ticketTransfer.create({ data: { ticketId, action: `PICKUP:${status}`, toUserId: t.holderId, actorId: actor.userId } });
    await audit(tx, actor, "TICKET_PICKUP", "Ticket", ticketId, { status });
  });
}

/** 票券敏感資訊只給購票人、建立者、持有人與管理者 */
export function canSeeSecret(actor: Actor, t: { holderId: string | null }, o: { buyerId: string; createdById: string }) {
  return actor.role === "ADMIN" || t.holderId === actor.userId || o.buyerId === actor.userId || o.createdById === actor.userId;
}

export async function getOrderDetail(actor: Actor, orderId: string) {
  const o = await prisma.ticketOrder.findFirst({
    where: { id: orderId, groupId: actor.groupId },
    include: {
      game: { include: { homeTeam: true, awayTeam: true, venue: true } },
      platform: true,
      tickets: { orderBy: { seq: "asc" }, include: { transfers: { orderBy: { createdAt: "desc" }, take: 10 } } },
    },
  });
  if (!o) throw notFound("找不到訂單");
  return {
    ...o,
    tickets: o.tickets.map((t) => ({ ...t, secretInfo: canSeeSecret(actor, t, o) ? t.secretInfo : null, hasSecret: !!t.secretInfo })),
    canEdit: canEditOrder(actor, o),
  };
}

export async function listOrdersForGame(actor: Actor, gameId: string) {
  return prisma.ticketOrder.findMany({
    where: { groupId: actor.groupId, gameId },
    include: { tickets: { where: { archived: false } }, platform: true },
    orderBy: { createdAt: "asc" },
  });
}

export interface TicketFilter {
  scope: "mine" | "all" | "held" | "bought";
  transfer?: string;
  pickup?: string;
  upcomingOnly?: boolean;
}

export async function listTickets(actor: Actor, f: TicketFilter) {
  const where: Prisma.TicketWhereInput = { groupId: actor.groupId, archived: false };
  if (f.scope === "mine") where.OR = [{ holderId: actor.userId }, { order: { buyerId: actor.userId } }];
  if (f.scope === "held") where.holderId = actor.userId;
  if (f.scope === "bought") where.order = { buyerId: actor.userId };
  if (f.transfer) where.transferStatus = f.transfer as Prisma.TicketWhereInput["transferStatus"];
  if (f.pickup) where.pickupStatus = f.pickup as Prisma.TicketWhereInput["pickupStatus"];
  if (f.upcomingOnly) where.game = { startAt: { gte: new Date(Date.now() - 6 * 3600_000) } };
  const tickets = await prisma.ticket.findMany({
    where,
    include: { order: true, game: { include: { homeTeam: true, awayTeam: true, venue: true } } },
    orderBy: [{ game: { startAt: "asc" } }, { orderId: "asc" }, { seq: "asc" }],
    take: 300,
  });
  return tickets.map((t) => ({ ...t, hasSecret: !!t.secretInfo, secretInfo: canSeeSecret(actor, t, t.order) ? t.secretInfo : null }));
}

// ───────── 售票平台 ─────────

export async function listPlatforms(actor: Actor) {
  return prisma.ticketPlatform.findMany({
    where: { OR: [{ groupId: null }, { groupId: actor.groupId }] },
    orderBy: [{ groupId: "asc" }, { name: "asc" }],
  });
}

export async function createPlatform(actor: Actor, input: { name: string; webUrl?: string | null; appUrl?: string | null }) {
  const d = z
    .object({
      name: z.string().trim().min(1, "請輸入平台名稱").max(40),
      webUrl: urlStr,
      appUrl: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
    })
    .parse(input);
  if (d.appUrl && /^(javascript|data|file):/i.test(d.appUrl)) throw invalid("App 連結格式不允許");
  const p = await prisma.ticketPlatform.create({ data: { groupId: actor.groupId, ...d } });
  await audit(prisma, actor, "PLATFORM_CREATE", "TicketPlatform", p.id);
  return p;
}

export function assertNotOtherGroup(found: { groupId: string } | null, actor: Actor) {
  if (!found || found.groupId !== actor.groupId) throw new AppError("NOT_FOUND", "找不到資料");
}
