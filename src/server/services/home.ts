import { prisma } from "@/lib/db";
import { addDays, startOfTaipeiDay } from "@/lib/time";
import type { Actor } from "@/server/context";
import { computeLedger } from "./finance";
import { visibleGames } from "./games";

export type TodoKind =
  | "UNASSIGNED"
  | "UNDELIVERED"
  | "CONFIRM_RECEIVE"
  | "NOT_PICKED"
  | "PICKUP_DEADLINE"
  | "I_OWE"
  | "OWED_TO_ME"
  | "REFUND_PENDING"
  | "REFUND_NEEDED"
  | "CONFIRM_PAYMENT"
  | "CONFIRM_ATTENDANCE"
  | "GAME_CHANGED"
  | "STARTING_SOON";

export interface Todo {
  kind: TodoKind;
  title: string;
  detail: string;
  href: string;
  amount?: number;
  urgent?: boolean;
  at?: Date;
}

const gameInc = { homeTeam: true, awayTeam: true, venue: true } as const;

/** 首頁：待辦為核心。每一項都附上可直接處理的頁面連結。 */
export async function homeData(actor: Actor, now = new Date()) {
  const today = startOfTaipeiDay(now);
  const tomorrow = addDays(today, 1);
  const week = addDays(today, 8);
  const vis = visibleGames(actor);

  const [todayGames, weekGames, myTickets, managedTickets, ledger, refunds, unconfirmedPays, pastPlanned, changes, recentPays, recentSettlements, names] =
    await Promise.all([
      prisma.game.findMany({ where: { AND: [vis, { startAt: { gte: today, lt: tomorrow } }] }, include: gameInc, orderBy: { startAt: "asc" } }),
      prisma.game.findMany({
        where: { AND: [vis, { startAt: { gte: tomorrow, lt: week } }, { orders: { some: { groupId: actor.groupId } } }] },
        include: gameInc,
        orderBy: { startAt: "asc" },
      }),
      prisma.ticket.findMany({
        where: { groupId: actor.groupId, archived: false, holderId: actor.userId, game: { startAt: { gte: addDays(now, -0.25) } } },
        include: { game: { include: gameInc }, order: true },
        orderBy: { game: { startAt: "asc" } },
      }),
      prisma.ticket.findMany({
        where: {
          groupId: actor.groupId,
          archived: false,
          order: { OR: [{ buyerId: actor.userId }, { createdById: actor.userId }], status: { in: ["PURCHASED", "REFUNDING"] } },
          game: { startAt: { gte: addDays(now, -0.25) } },
        },
        include: { game: { include: gameInc }, order: true },
      }),
      computeLedger(prisma, actor.groupId, { userId: actor.userId }),
      prisma.refund.findMany({
        where: { groupId: actor.groupId, status: "PROCESSING", OR: [{ fromUserId: actor.userId }, { toUserId: actor.userId }, { createdById: actor.userId }] },
      }),
      prisma.payment.findMany({
        where: {
          groupId: actor.groupId,
          status: "VALID",
          OR: [
            { payeeId: actor.userId, payeeConfirmedAt: null },
            { payerId: actor.userId, payerConfirmedAt: null },
          ],
        },
        orderBy: { paidAt: "desc" },
      }),
      prisma.gameAttendance.findMany({
        where: { groupId: actor.groupId, userId: actor.userId, status: "PLANNED", game: { startAt: { lt: addDays(now, -0.125) } } },
        include: { game: { include: gameInc } },
        take: 10,
      }),
      prisma.gameChange.findMany({
        where: {
          createdAt: { gte: addDays(now, -7) },
          field: { in: ["startAt", "venueId", "status"] },
          game: { AND: [vis, { startAt: { gte: addDays(today, -1) } }, { tickets: { some: { groupId: actor.groupId, archived: false } } }] },
        },
        include: { game: { include: gameInc } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.payment.findMany({
        where: { groupId: actor.groupId, OR: [{ payerId: actor.userId }, { payeeId: actor.userId }] },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.settlement.findMany({
        where: { groupId: actor.groupId, OR: [{ payerId: actor.userId }, { payeeId: actor.userId }] },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
      prisma.groupMember.findMany({ where: { groupId: actor.groupId }, include: { user: { select: { id: true, displayName: true } } } }),
    ]);

  const nameOf = new Map(names.map((m) => [m.user.id, m.user.displayName]));
  const label = (g: { homeTeam: { shortName: string }; awayTeam: { shortName: string } }) =>
    `${g.awayTeam.shortName} @ ${g.homeTeam.shortName}`;
  const todos: Todo[] = [];

  // 即將開賽（24 小時內，我有票）
  const soon = new Map<string, (typeof myTickets)[number]>();
  for (const t of myTickets) {
    const ms = t.game.startAt.getTime() - now.getTime();
    if (ms > 0 && ms < 24 * 3600_000 && t.game.status === "SCHEDULED") soon.set(t.gameId, t);
  }
  for (const t of soon.values())
    todos.push({ kind: "STARTING_SOON", title: "即將開賽", detail: label(t.game), href: `/games/${t.gameId}`, at: t.game.startAt, urgent: true });

  // 賽程異動
  const seenChange = new Set<string>();
  for (const c of changes) {
    const k = `${c.gameId}|${c.field}`;
    if (seenChange.has(k)) continue;
    if (c.field === "status" && (c.newValue === "FINAL" || c.newValue === "IN_PROGRESS")) continue;
    seenChange.add(k);
    const what = c.field === "startAt" ? "比賽時間變更" : c.field === "venueId" ? "球場變更" : statusChangeText(c.newValue);
    todos.push({ kind: "GAME_CHANGED", title: what, detail: label(c.game), href: `/games/${c.gameId}`, at: c.createdAt, urgent: true });
  }

  // 票券：未分配／未交付（我管理的訂單）
  const unassigned = managedTickets.filter((t) => !t.holderId);
  const byOrder = (list: typeof managedTickets) => {
    const m = new Map<string, typeof managedTickets>();
    for (const t of list) (m.get(t.orderId) ?? m.set(t.orderId, []).get(t.orderId)!).push(t);
    return m;
  };
  for (const [orderId, list] of byOrder(unassigned))
    todos.push({ kind: "UNASSIGNED", title: `${list.length} 張票尚未分配`, detail: label(list[0].game), href: `/orders/${orderId}`, at: list[0].game.startAt });
  const undelivered = managedTickets.filter((t) => t.holderId && t.holderId !== t.order.buyerId && t.transferStatus === "ASSIGNED");
  for (const [orderId, list] of byOrder(undelivered))
    todos.push({ kind: "UNDELIVERED", title: `${list.length} 張票尚未完成交付`, detail: label(list[0].game), href: `/orders/${orderId}`, at: list[0].game.startAt });

  // 我持有：待確認收到、尚未取票
  for (const t of myTickets) {
    if (t.order.buyerId !== actor.userId && !t.receivedConfirmedAt && t.order.status === "PURCHASED")
      todos.push({ kind: "CONFIRM_RECEIVE", title: "請確認是否已收到票券", detail: `${label(t.game)}・第 ${t.seq} 張`, href: `/tickets/${t.id}`, at: t.game.startAt });
  }
  const notPicked = [...new Map([...myTickets, ...managedTickets].map((t) => [t.id, t])).values()].filter(
    (t) => t.pickupStatus === "NOT_PICKED" && t.order.status === "PURCHASED" && (t.holderId === actor.userId || (!t.holderId && t.order.buyerId === actor.userId)),
  );
  for (const t of notPicked) {
    const dl = t.order.pickupDeadline;
    const near = dl && dl.getTime() - now.getTime() < 3 * 86400_000;
    if (near)
      todos.push({ kind: "PICKUP_DEADLINE", title: dl! < now ? "已超過取票期限" : "取票期限將至", detail: `${label(t.game)}・第 ${t.seq} 張`, href: `/tickets/${t.id}`, at: dl!, urgent: true });
    else if (t.game.startAt.getTime() - now.getTime() < 7 * 86400_000)
      todos.push({ kind: "NOT_PICKED", title: "尚未取票", detail: `${label(t.game)}・第 ${t.seq} 張`, href: `/tickets/${t.id}`, at: t.game.startAt });
  }

  // 金額
  for (const r of ledger) {
    if (r.debtorId === actor.userId && r.outstanding > 0)
      todos.push({
        kind: "I_OWE",
        title: `${r.state === "PARTIAL" ? "部分付款，尚欠" : "尚未付款給"} ${nameOf.get(r.creditorId) ?? ""}`,
        detail: `應付 ${r.due}・已付 ${r.due - r.outstanding}`,
        href: `/orders/${r.orderId}#pay`,
        amount: r.outstanding,
      });
    if (r.creditorId === actor.userId && r.outstanding > 0)
      todos.push({
        kind: "OWED_TO_ME",
        title: `${nameOf.get(r.debtorId) ?? ""} ${r.state === "PARTIAL" ? "部分付款，尚欠" : "尚未付款"}`,
        detail: `應付 ${r.due}・已付 ${r.due - r.outstanding}`,
        href: `/orders/${r.orderId}#pay`,
        amount: r.outstanding,
      });
    if (r.creditorId === actor.userId && r.outstanding < 0 && r.refundPending === 0)
      todos.push({ kind: "REFUND_NEEDED", title: `需退款給 ${nameOf.get(r.debtorId) ?? ""}`, detail: "對方溢付（例如票券已退票）", href: `/orders/${r.orderId}#pay`, amount: -r.outstanding, urgent: true });
  }
  for (const r of refunds)
    todos.push({ kind: "REFUND_PENDING", title: r.kind === "PLATFORM" ? "售票平台退款處理中" : "朋友間退款處理中", detail: r.toUserId === actor.userId ? "等待收到退款" : "等待完成退款", href: r.orderId ? `/orders/${r.orderId}#refunds` : "/settle", amount: r.amount });
  for (const p of unconfirmedPays)
    todos.push({
      kind: "CONFIRM_PAYMENT",
      title: p.payeeId === actor.userId ? `請確認是否收到 ${nameOf.get(p.payerId) ?? ""} 的付款` : `請確認你付給 ${nameOf.get(p.payeeId) ?? ""} 的款項`,
      detail: p.settlementId ? "結算淨額" : "訂單付款",
      href: p.orderId ? `/orders/${p.orderId}#pay` : "/settle",
      amount: p.amount,
    });
  for (const a of pastPlanned)
    todos.push({ kind: "CONFIRM_ATTENDANCE", title: "這場有到場嗎？", detail: label(a.game), href: `/games/${a.gameId}#attendance`, at: a.game.startAt });

  return {
    todayGames,
    weekGames,
    nextGame: myTickets.find((t) => t.game.startAt > now)?.game ?? null,
    todos,
    recentPays,
    recentSettlements,
    nameOf,
  };
}

function statusChangeText(v: string | null) {
  switch (v) {
    case "POSTPONED":
      return "比賽延期";
    case "CANCELLED":
      return "比賽取消";
    case "SUSPENDED":
      return "保留比賽";
    case "FINAL":
      return "比賽結束";
    default:
      return "比賽狀態變更";
  }
}
