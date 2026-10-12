import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { conflict, forbidden, invalid, notFound } from "@/lib/errors";
import { payState, type PayState } from "@/lib/money";
import { fromTaipei } from "@/lib/time";
import { type Actor, assertGroupMember, audit, lockGroup, withTx } from "@/server/context";
import { canEditOrder, getOrderForActor } from "./orders";

/**
 * 帳目計算（全部由可追溯紀錄即時計算，不存任何「餘額」欄位）
 *
 * 每一列 = 某訂單上 debtor 應付 creditor 的帳：
 *   應付 due        = 有效應付款（Obligation.active）合計
 *   已付 paid       = 有效付款（Payment.VALID，指定此訂單）合計
 *   已退 refunded   = 朋友間已完成退款（creditor 退回 debtor）合計
 *   已結算 settled  = 已完成結算中涵蓋此列的金額
 *   尚欠 outstanding = due − paid + refunded − settled   （負數 = 溢付，應退回）
 */
export interface LedgerRow {
  orderId: string;
  debtorId: string;
  creditorId: string;
  due: number;
  paid: number;
  refunded: number;
  refundPending: number;
  settled: number;
  outstanding: number;
  state: PayState | "REFUNDED";
}

export async function computeLedger(db: Tx, groupId: string, opts: { userId?: string; orderId?: string } = {}) {
  const userFilter = (a: string, b: string) =>
    opts.userId ? { OR: [{ [a]: opts.userId }, { [b]: opts.userId }] } : {};
  const orderFilter = opts.orderId ? { orderId: opts.orderId } : {};
  const [obls, pays, refunds, items] = await Promise.all([
    db.obligation.findMany({ where: { groupId, active: true, ...orderFilter, ...userFilter("debtorId", "creditorId") } }),
    db.payment.findMany({
      where: { groupId, status: "VALID", orderId: opts.orderId ?? { not: null }, ...userFilter("payerId", "payeeId") },
    }),
    db.refund.findMany({
      where: { groupId, kind: "MEMBER", status: { in: ["PROCESSING", "COMPLETED"] }, orderId: opts.orderId ?? { not: null }, ...userFilter("fromUserId", "toUserId") },
    }),
    db.settlementItem.findMany({
      where: { settlement: { groupId, status: "COMPLETED" }, ...orderFilter, ...userFilter("debtorId", "creditorId") },
    }),
  ]);
  const rows = new Map<string, LedgerRow>();
  const row = (orderId: string, debtorId: string, creditorId: string) => {
    const k = `${orderId}|${debtorId}|${creditorId}`;
    let r = rows.get(k);
    if (!r) {
      r = { orderId, debtorId, creditorId, due: 0, paid: 0, refunded: 0, refundPending: 0, settled: 0, outstanding: 0, state: "NONE" };
      rows.set(k, r);
    }
    return r;
  };
  for (const o of obls) row(o.orderId, o.debtorId, o.creditorId).due += o.amount;
  for (const p of pays) row(p.orderId!, p.payerId, p.payeeId).paid += p.amount;
  for (const r of refunds) {
    const x = row(r.orderId!, r.toUserId, r.fromUserId!);
    if (r.status === "COMPLETED") x.refunded += r.amount;
    else x.refundPending += r.amount;
  }
  for (const i of items) row(i.orderId, i.debtorId, i.creditorId).settled += i.amount;
  for (const r of rows.values()) {
    r.outstanding = r.due - r.paid + r.refunded - r.settled;
    r.state = r.due === 0 && r.outstanding === 0 && r.refunded > 0 ? "REFUNDED" : payState(r.due, r.outstanding);
  }
  return [...rows.values()];
}

export interface PairBalance {
  otherId: string;
  iOwe: number; // 我應付對方（各訂單尚欠合計，溢付為負）
  theyOwe: number; // 對方應付我
  net: number; // 正數 = 對方應付我；負數 = 我應付對方
}

export function pairBalances(rows: LedgerRow[], userId: string): Map<string, PairBalance> {
  const m = new Map<string, PairBalance>();
  const get = (id: string) => m.get(id) ?? (m.set(id, { otherId: id, iOwe: 0, theyOwe: 0, net: 0 }), m.get(id)!);
  for (const r of rows) {
    if (r.debtorId === userId) get(r.creditorId).iOwe += r.outstanding;
    else if (r.creditorId === userId) get(r.debtorId).theyOwe += r.outstanding;
  }
  for (const b of m.values()) b.net = b.theyOwe - b.iOwe;
  return m;
}

// ───────── 付款 ─────────

const amountSchema = z.number({ error: "金額必須是數字" }).int("金額必須是整數").positive("金額必須大於 0").max(10_000_000);

const paymentSchema = z.object({
  orderId: z.string().min(1),
  payerId: z.string().min(1),
  amount: amountSchema,
  method: z.string().trim().max(30).nullable().optional(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

export async function createPayment(actor: Actor, input: z.input<typeof paymentSchema>) {
  const d = paymentSchema.parse(input);
  if (d.clientRequestId) {
    const dup = await prisma.payment.findUnique({ where: { clientRequestId: d.clientRequestId } });
    if (dup) {
      if (dup.groupId !== actor.groupId) throw conflict("重複的請求");
      return dup;
    }
  }
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const order = await getOrderForActor(tx, actor, d.orderId);
    const payeeId = order.buyerId;
    await assertGroupMember(tx, actor.groupId, d.payerId, "付款人");
    if (d.payerId === payeeId) throw invalid("購票人不需要付款給自己");
    if (actor.role !== "ADMIN" && actor.userId !== d.payerId && actor.userId !== payeeId)
      throw forbidden("只能記錄自己付出或自己收到的款項");
    const [row] = (await computeLedger(tx, actor.groupId, { orderId: order.id })).filter(
      (r) => r.debtorId === d.payerId && r.creditorId === payeeId,
    );
    const outstanding = row?.outstanding ?? 0;
    if (outstanding <= 0) throw invalid("這筆訂單已經沒有尚欠金額，不需要再付款");
    if (d.amount > outstanding) throw invalid(`付款金額超過尚欠金額 ${outstanding} 元`);
    const now = new Date();
    const p = await tx.payment.create({
      data: {
        groupId: actor.groupId,
        orderId: order.id,
        payerId: d.payerId,
        payeeId,
        amount: d.amount,
        method: d.method || null,
        paidAt: d.paidDate ? fromTaipei(d.paidDate, "12:00") : now,
        note: d.note || null,
        createdById: actor.userId,
        payerConfirmedAt: actor.userId === d.payerId ? now : null,
        payeeConfirmedAt: actor.userId === payeeId ? now : null,
        clientRequestId: d.clientRequestId,
      },
    });
    await audit(tx, actor, "PAYMENT_CREATE", "Payment", p.id, { amount: d.amount, orderId: order.id, payerId: d.payerId });
    return p;
  });
}

/** 付款人或收款人各自確認；不能替對方確認 */
export async function confirmPayment(actor: Actor, paymentId: string) {
  return withTx(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id: paymentId, groupId: actor.groupId } });
    if (!p) throw notFound("找不到付款紀錄");
    if (p.status !== "VALID") throw invalid("已撤銷的付款不能確認");
    const data: { payerConfirmedAt?: Date; payeeConfirmedAt?: Date } = {};
    if (actor.userId === p.payerId && !p.payerConfirmedAt) data.payerConfirmedAt = new Date();
    else if (actor.userId === p.payeeId && !p.payeeConfirmedAt) data.payeeConfirmedAt = new Date();
    else if (actor.userId !== p.payerId && actor.userId !== p.payeeId) throw forbidden("只有付款人或收款人可以確認");
    else return p;
    const u = await tx.payment.update({ where: { id: paymentId }, data });
    await audit(tx, actor, "PAYMENT_CONFIRM", "Payment", paymentId, Object.keys(data));
    return u;
  });
}

/** 撤銷付款：建立者或管理者；若另一方已確認，只有管理者可撤銷。紀錄保留，只改狀態。 */
export async function revokePayment(actor: Actor, paymentId: string, reason: string) {
  const why = z.string().trim().min(1, "請填寫撤銷原因").max(200).parse(reason);
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const p = await tx.payment.findFirst({ where: { id: paymentId, groupId: actor.groupId } });
    if (!p) throw notFound("找不到付款紀錄");
    if (p.status !== "VALID") throw invalid("此付款已撤銷");
    if (p.settlementId) throw invalid("結算產生的付款請從結算紀錄取消");
    const isAdmin = actor.role === "ADMIN";
    if (!isAdmin && p.createdById !== actor.userId) throw forbidden("只有建立者或管理者可以撤銷付款");
    const otherConfirmed =
      (actor.userId === p.payerId && p.payeeConfirmedAt) || (actor.userId === p.payeeId && p.payerConfirmedAt);
    if (!isAdmin && otherConfirmed) throw forbidden("對方已確認這筆付款，請聯絡管理者處理");
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: actor.userId, revokeReason: why },
    });
    await audit(tx, actor, "PAYMENT_REVOKE", "Payment", paymentId, { reason: why, amount: p.amount });
  });
}

// ───────── 退款 ─────────

const memberRefundSchema = z.object({
  orderId: z.string().min(1),
  fromUserId: z.string().min(1), // 退回款項的人（原收款人）
  toUserId: z.string().min(1),
  amount: amountSchema,
  completed: z.boolean().default(false),
  method: z.string().trim().max(30).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

/** 朋友之間的退款：用於溢付（例如票券退票後已付的錢要退回） */
export async function createMemberRefund(actor: Actor, input: z.input<typeof memberRefundSchema>) {
  const d = memberRefundSchema.parse(input);
  if (d.clientRequestId) {
    const dup = await prisma.refund.findUnique({ where: { clientRequestId: d.clientRequestId } });
    if (dup) {
      if (dup.groupId !== actor.groupId) throw conflict("重複的請求");
      return dup;
    }
  }
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const order = await getOrderForActor(tx, actor, d.orderId);
    if (actor.role !== "ADMIN" && actor.userId !== d.fromUserId && actor.userId !== d.toUserId)
      throw forbidden("只能記錄自己相關的退款");
    const row = (await computeLedger(tx, actor.groupId, { orderId: order.id })).find(
      (r) => r.debtorId === d.toUserId && r.creditorId === d.fromUserId,
    );
    const refundable = row ? -(row.outstanding) - row.refundPending : 0;
    if (refundable <= 0) throw invalid("這筆帳目沒有需要退回的溢付金額");
    if (d.amount > refundable) throw invalid(`退款金額超過可退金額 ${refundable} 元`);
    const r = await tx.refund.create({
      data: {
        groupId: actor.groupId,
        kind: "MEMBER",
        orderId: order.id,
        fromUserId: d.fromUserId,
        toUserId: d.toUserId,
        amount: d.amount,
        status: d.completed ? "COMPLETED" : "PROCESSING",
        completedAt: d.completed ? new Date() : null,
        method: d.method || null,
        note: d.note || null,
        createdById: actor.userId,
        clientRequestId: d.clientRequestId,
      },
    });
    await audit(tx, actor, "REFUND_CREATE", "Refund", r.id, { amount: d.amount, kind: "MEMBER" });
    return r;
  });
}

const platformRefundSchema = z.object({
  orderId: z.string().min(1),
  amount: amountSchema,
  completed: z.boolean().default(false),
  note: z.string().trim().max(300).nullable().optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

/** 售票平台退款給購票人（紀錄用，不影響朋友間帳目；朋友帳由票券「已退票」狀態決定） */
export async function createPlatformRefund(actor: Actor, input: z.input<typeof platformRefundSchema>) {
  const d = platformRefundSchema.parse(input);
  if (d.clientRequestId) {
    const dup = await prisma.refund.findUnique({ where: { clientRequestId: d.clientRequestId } });
    if (dup) return dup;
  }
  return withTx(async (tx) => {
    const order = await getOrderForActor(tx, actor, d.orderId);
    if (!canEditOrder(actor, order)) throw forbidden();
    const r = await tx.refund.create({
      data: {
        groupId: actor.groupId,
        kind: "PLATFORM",
        orderId: order.id,
        toUserId: order.buyerId,
        amount: d.amount,
        status: d.completed ? "COMPLETED" : "PROCESSING",
        completedAt: d.completed ? new Date() : null,
        note: d.note || null,
        createdById: actor.userId,
        clientRequestId: d.clientRequestId,
      },
    });
    await audit(tx, actor, "REFUND_CREATE", "Refund", r.id, { amount: d.amount, kind: "PLATFORM" });
    return r;
  });
}

export async function setRefundStatus(actor: Actor, refundId: string, status: "COMPLETED" | "CANCELLED") {
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const r = await tx.refund.findFirst({ where: { id: refundId, groupId: actor.groupId } });
    if (!r) throw notFound("找不到退款紀錄");
    if (r.status !== "PROCESSING") throw invalid("只有「退款中」的紀錄可以變更");
    const parties = [r.fromUserId, r.toUserId, r.createdById];
    if (actor.role !== "ADMIN" && !parties.includes(actor.userId)) throw forbidden();
    if (status === "CANCELLED" && actor.role !== "ADMIN" && r.createdById !== actor.userId)
      throw forbidden("只有建立者或管理者可以取消退款");
    await tx.refund.update({
      where: { id: refundId },
      data: { status, completedAt: status === "COMPLETED" ? new Date() : null },
    });
    await audit(tx, actor, `REFUND_${status}`, "Refund", refundId);
  });
}

// ───────── 結算 ─────────

export async function previewSettlement(db: Tx, groupId: string, userA: string, userB: string) {
  const rows = (await computeLedger(db, groupId, { userId: userA })).filter(
    (r) => (r.debtorId === userA && r.creditorId === userB) || (r.debtorId === userB && r.creditorId === userA),
  );
  // 只納入有未結金額的列（正數為欠款、負數為溢付）；退款處理中的列不納入，避免重複處理
  const items = rows.filter((r) => r.outstanding !== 0 && r.refundPending === 0);
  let aOwesB = 0;
  for (const r of items) aOwesB += r.debtorId === userA ? r.outstanding : -r.outstanding;
  return {
    items,
    payerId: aOwesB >= 0 ? userA : userB,
    payeeId: aOwesB >= 0 ? userB : userA,
    netAmount: Math.abs(aOwesB),
  };
}

const settlementSchema = z.object({
  userA: z.string().min(1),
  userB: z.string().min(1),
  expectedNet: z.number().int(),
  expectedPayerId: z.string().min(1),
  method: z.string().trim().max(30).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  clientRequestId: z.string().min(8).max(100).optional(),
});

/** 建立結算：鎖定群組後重新計算，與畫面上看到的金額不同時拒絕（避免重複或過期結算） */
export async function createSettlement(actor: Actor, input: z.input<typeof settlementSchema>) {
  const d = settlementSchema.parse(input);
  if (d.userA === d.userB) throw invalid("結算對象不可為自己");
  if (actor.role !== "ADMIN" && actor.userId !== d.userA && actor.userId !== d.userB)
    throw forbidden("只能結算自己與他人的帳目");
  if (d.clientRequestId) {
    const dup = await prisma.settlement.findUnique({ where: { clientRequestId: d.clientRequestId } });
    if (dup) {
      if (dup.groupId !== actor.groupId) throw conflict("重複的請求");
      return dup;
    }
  }
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    await assertGroupMember(tx, actor.groupId, d.userA);
    await assertGroupMember(tx, actor.groupId, d.userB);
    const pv = await previewSettlement(tx, actor.groupId, d.userA, d.userB);
    if (pv.items.length === 0) throw invalid("兩人之間目前沒有未結帳目");
    if (pv.netAmount !== d.expectedNet || (pv.netAmount > 0 && pv.payerId !== d.expectedPayerId))
      throw conflict("帳目已有變動，請重新整理確認金額後再結算");
    const s = await tx.settlement.create({
      data: {
        groupId: actor.groupId,
        payerId: pv.payerId,
        payeeId: pv.payeeId,
        netAmount: pv.netAmount,
        note: d.note || null,
        createdById: actor.userId,
        clientRequestId: d.clientRequestId,
        items: {
          create: pv.items.map((r) => ({
            orderId: r.orderId,
            debtorId: r.debtorId,
            creditorId: r.creditorId,
            amount: r.outstanding,
          })),
        },
      },
    });
    if (pv.netAmount > 0) {
      const now = new Date();
      await tx.payment.create({
        data: {
          groupId: actor.groupId,
          settlementId: s.id,
          payerId: pv.payerId,
          payeeId: pv.payeeId,
          amount: pv.netAmount,
          method: d.method || null,
          note: "結算淨額付款",
          createdById: actor.userId,
          payerConfirmedAt: actor.userId === pv.payerId ? now : null,
          payeeConfirmedAt: actor.userId === pv.payeeId ? now : null,
        },
      });
    }
    await audit(tx, actor, "SETTLEMENT_CREATE", "Settlement", s.id, {
      net: pv.netAmount,
      payerId: pv.payerId,
      items: pv.items.length,
    });
    return s;
  });
}

export async function cancelSettlement(actor: Actor, settlementId: string, reason: string) {
  const why = z.string().trim().min(1, "請填寫取消原因").max(200).parse(reason);
  return withTx(async (tx) => {
    await lockGroup(tx, actor.groupId);
    const s = await tx.settlement.findFirst({ where: { id: settlementId, groupId: actor.groupId } });
    if (!s) throw notFound("找不到結算紀錄");
    if (s.status !== "COMPLETED") throw invalid("此結算已取消");
    if (actor.role !== "ADMIN" && actor.userId !== s.payerId && actor.userId !== s.payeeId) throw forbidden();
    await tx.settlement.update({
      where: { id: s.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: why },
    });
    await tx.payment.updateMany({
      where: { settlementId: s.id, status: "VALID" },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: actor.userId, revokeReason: `結算取消：${why}` },
    });
    await audit(tx, actor, "SETTLEMENT_CANCEL", "Settlement", s.id, { reason: why });
  });
}

export async function confirmSettlementPayment(actor: Actor, settlementId: string) {
  const p = await prisma.payment.findFirst({ where: { settlementId, groupId: actor.groupId } });
  if (!p) throw notFound("此結算沒有需要確認的付款");
  return confirmPayment(actor, p.id);
}

/** 個人財務總覽 */
export async function financeOverview(actor: Actor, userId = actor.userId) {
  const rows = await computeLedger(prisma, actor.groupId, { userId });
  const pairs = pairBalances(rows, userId);
  const orderIds = [...new Set(rows.map((r) => r.orderId))];
  const orders = await prisma.ticketOrder.findMany({
    where: { id: { in: orderIds }, groupId: actor.groupId },
    include: { game: { include: { homeTeam: true, awayTeam: true } } },
  });
  return { rows, pairs: [...pairs.values()], orders: new Map(orders.map((o) => [o.id, o])) };
}
