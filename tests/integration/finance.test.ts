import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOrder, updateOrder, updateTicket, archiveTicket, addTicket } from "@/server/services/orders";
import {
  computeLedger,
  createPayment,
  revokePayment,
  createMemberRefund,
  setRefundStatus,
  previewSettlement,
  createSettlement,
  cancelSettlement,
  pairBalances,
  createPlatformRefund,
} from "@/server/services/finance";
import { listGames } from "@/server/services/games";
import { personalStats, setAttendance } from "@/server/services/stats";
import { makeGroup, makeOfficialGame, resetDb, rid } from "../helpers";

let G: Awaited<ReturnType<typeof makeGroup>>;
let game1: string;
let game2: string;

beforeEach(async () => {
  await resetDb();
  G = await makeGroup(["A", "B", "C", "D"]);
  game1 = (await makeOfficialGame({ home: "ACN011", away: "AJL011", date: "2026-10-20", venue: "洲際" })).id;
  game2 = (await makeOfficialGame({ home: "AEO011", away: "AAA011", date: "2026-10-25", venue: "新莊" })).id;
});

const row = async (orderId: string, debtorId: string) =>
  (await computeLedger(prisma, G.group.id, { orderId })).find((r) => r.debtorId === debtorId)!;

async function fourTickets(feeAmount = 120, mode: "PER_TICKET" | "EQUAL_HOLDERS" | "BUYER_ABSORBS" = "PER_TICKET") {
  const [A, B, C, D] = G.actors;
  return createOrder(A, {
    gameId: game1,
    buyerId: A.userId,
    pricePerTicket: 650,
    feeAmount,
    otherFeeAmount: 0,
    feeSplitMode: mode,
    status: "PURCHASED",
    tickets: [
      { holderId: A.userId, section: "內野 B", rowLabel: "12", seatNumber: "5" },
      { holderId: B.userId, section: "內野 B", rowLabel: "12", seatNumber: "6" },
      { holderId: C.userId, section: "內野 B", rowLabel: "12", seatNumber: "7" },
      { holderId: D.userId, section: "內野 B", rowLabel: "12", seatNumber: "8" },
    ],
    clientRequestId: rid(),
  });
}

describe("B. 購票與票券", () => {
  it("一筆訂單多張票、各自座位與持有人；重複送出不會建立第二筆", async () => {
    const [A] = G.actors;
    const req = rid();
    const input = { gameId: game1, buyerId: A.userId, pricePerTicket: 500, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET" as const, status: "PURCHASED" as const, tickets: [{}, {}, {}], clientRequestId: req };
    const [o1, o2] = await Promise.all([createOrder(A, input), createOrder(A, input)].map((p) => p.catch((e) => e)));
    const orders = await prisma.ticketOrder.count();
    expect(orders).toBe(1);
    expect([o1, o2].filter((x) => x && x.id).length).toBeGreaterThanOrEqual(1);
    expect(await prisma.ticket.count()).toBe(3);
  });

  it("每張票可獨立更新分票與取票狀態；已指定、已交付、已取票、已付款互不取代", async () => {
    const o = await fourTickets();
    const [A, B] = G.actors;
    const tB = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, holderId: B.userId } });
    await updateTicket(A, tB.id, tB.version, { holderId: B.userId, price: 650, transferStatus: "DELIVERED", pickupStatus: "PICKED" });
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: tB.id } });
    expect(after.transferStatus).toBe("DELIVERED");
    expect(after.pickupStatus).toBe("PICKED");
    expect((await row(o.id, B.userId)).state).toBe("UNPAID"); // 交付與取票不代表已付款
    const others = await prisma.ticket.findMany({ where: { orderId: o.id, id: { not: tB.id } } });
    expect(others.every((t) => t.pickupStatus === "NOT_PICKED")).toBe(true);
  });

  it("取消與退票後保留訂單、票券與歷史應付紀錄", async () => {
    const o = await fourTickets();
    const [A] = G.actors;
    await updateOrder(A, o.id, o.version, { buyerId: A.userId, feeAmount: 120, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "CANCELLED" });
    expect(await prisma.ticketOrder.count({ where: { id: o.id } })).toBe(1);
    expect(await prisma.ticket.count({ where: { orderId: o.id } })).toBe(4);
    expect(await prisma.obligation.count({ where: { orderId: o.id, active: true } })).toBe(0);
    expect(await prisma.obligation.count({ where: { orderId: o.id, active: false } })).toBeGreaterThan(0);
  });

  it("同一場比賽多筆訂單只算一場觀賽", async () => {
    const [A, B] = G.actors;
    await fourTickets();
    await createOrder(B, { gameId: game1, buyerId: B.userId, pricePerTicket: 400, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: A.userId }] });
    await setAttendance(A, game1, A.userId, { status: "ATTENDED", supportTeamId: null });
    const s = await personalStats(A, A.userId);
    expect(s.total.games).toBe(1);
    const games = await listGames(A, { onlyWithTickets: true });
    expect(games).toHaveLength(1);
    expect(games[0]._count.orders).toBe(2);
  });
});

describe("C. 金額", () => {
  it("多張票總價、手續費分攤正確", async () => {
    const o = await fourTickets(120);
    const [, B, C, D] = G.actors;
    for (const u of [B, C, D]) expect((await row(o.id, u.userId)).due).toBe(680);
    const total = (await computeLedger(prisma, G.group.id, { orderId: o.id })).reduce((a, r) => a + r.due, 0);
    expect(total).toBe(3 * 680);
  });

  it("無法整除的手續費總額完全相符（零頭由購票人吸收）", async () => {
    const o = await fourTickets(101, "EQUAL_HOLDERS");
    const rows = await computeLedger(prisma, G.group.id, { orderId: o.id });
    const others = rows.reduce((a, r) => a + r.due - 650, 0);
    expect(rows.every((r) => r.due === 650 + 25)).toBe(true);
    expect(101 - others).toBe(26); // 購票人 A 負擔 26，合計 101
  });

  it("部分付款、多次付款累加、超額付款被拒、撤銷後不再計入", async () => {
    const o = await fourTickets(0);
    const [A, B] = G.actors;
    const p1 = await createPayment(B, { orderId: o.id, payerId: B.userId, amount: 300, clientRequestId: rid() });
    let r = await row(o.id, B.userId);
    expect([r.due, r.paid, r.outstanding, r.state]).toEqual([650, 300, 350, "PARTIAL"]);
    await createPayment(A, { orderId: o.id, payerId: B.userId, amount: 200, clientRequestId: rid() });
    r = await row(o.id, B.userId);
    expect([r.paid, r.outstanding]).toEqual([500, 150]);
    await expect(createPayment(B, { orderId: o.id, payerId: B.userId, amount: 151 })).rejects.toThrow(/超過尚欠金額 150/);
    await revokePayment(B, p1.id, "記錯金額");
    r = await row(o.id, B.userId);
    expect([r.paid, r.outstanding]).toEqual([200, 450]);
    expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(2); // 撤銷紀錄保留
    await createPayment(B, { orderId: o.id, payerId: B.userId, amount: 450, clientRequestId: rid() });
    expect((await row(o.id, B.userId)).state).toBe("PAID");
  });

  it("同一個付款請求重複送出（雙擊）只記一次", async () => {
    const o = await fourTickets(0);
    const [, B] = G.actors;
    const req = rid();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createPayment(B, { orderId: o.id, payerId: B.userId, amount: 100, clientRequestId: req })));
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    expect(await prisma.payment.count()).toBe(1);
    expect((await row(o.id, B.userId)).paid).toBe(100);
  });

  it("多人同時付款不會超付（群組交易鎖）", async () => {
    const o = await fourTickets(0);
    const [A, B] = G.actors;
    const results = await Promise.allSettled([
      createPayment(B, { orderId: o.id, payerId: B.userId, amount: 650, clientRequestId: rid() }),
      createPayment(A, { orderId: o.id, payerId: B.userId, amount: 650, clientRequestId: rid() }),
      createPayment(B, { orderId: o.id, payerId: B.userId, amount: 400, clientRequestId: rid() }),
    ]);
    const r = await row(o.id, B.userId);
    expect(r.paid).toBeLessThanOrEqual(650);
    expect(r.outstanding).toBeGreaterThanOrEqual(0);
    expect(results.filter((x) => x.status === "rejected").length).toBeGreaterThanOrEqual(1);
  });

  it("退票後溢付：退款正確扣除，退款後不再算已付", async () => {
    const o = await fourTickets(0);
    const [A, B] = G.actors;
    await createPayment(B, { orderId: o.id, payerId: B.userId, amount: 650, clientRequestId: rid() });
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, holderId: B.userId } });
    await updateTicket(A, t.id, t.version, { holderId: B.userId, price: 650, transferStatus: "ASSIGNED", pickupStatus: "REFUNDED" });
    let r = await row(o.id, B.userId);
    expect([r.due, r.paid, r.outstanding, r.state]).toEqual([0, 650, -650, "OVERPAID"]);
    await expect(createMemberRefund(A, { orderId: o.id, fromUserId: A.userId, toUserId: B.userId, amount: 700 })).rejects.toThrow(/可退金額 650/);
    const ref = await createMemberRefund(A, { orderId: o.id, fromUserId: A.userId, toUserId: B.userId, amount: 650, clientRequestId: rid() });
    r = await row(o.id, B.userId);
    expect([r.refundPending, r.outstanding]).toEqual([650, -650]); // 退款中尚未完成
    await setRefundStatus(B, ref.id, "COMPLETED");
    r = await row(o.id, B.userId);
    expect([r.refunded, r.outstanding, r.state]).toEqual([650, 0, "REFUNDED"]);
    await expect(createMemberRefund(A, { orderId: o.id, fromUserId: A.userId, toUserId: B.userId, amount: 1 })).rejects.toThrow(/沒有需要退回/);
    // 平台退款只是紀錄，不影響朋友帳
    await createPlatformRefund(A, { orderId: o.id, amount: 650, completed: true });
    expect((await row(o.id, B.userId)).outstanding).toBe(0);
  });

  it("移除票券不會讓付款消失", async () => {
    const o = await fourTickets(0);
    const [A, , C] = G.actors;
    await createPayment(C, { orderId: o.id, payerId: C.userId, amount: 650, clientRequestId: rid() });
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, holderId: C.userId } });
    await archiveTicket(A, t.id);
    expect(await prisma.ticket.count({ where: { id: t.id } })).toBe(1);
    const r = await row(o.id, C.userId);
    expect([r.paid, r.outstanding]).toEqual([650, -650]);
  });

  it("修改票價：舊應付作廢保留，可核對歷史", async () => {
    const o = await fourTickets(0);
    const [A, B] = G.actors;
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, holderId: B.userId } });
    await updateTicket(A, t.id, t.version, { holderId: B.userId, price: 800, transferStatus: "ASSIGNED", pickupStatus: "NOT_PICKED" });
    const obls = await prisma.obligation.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } });
    expect(obls.map((x) => [x.amount, x.active])).toEqual([[650, false], [800, true]]);
    expect(obls[0].voidReason).toBe("修改票券");
    expect(await prisma.auditLog.count({ where: { entityId: t.id, action: "TICKET_UPDATE" } })).toBe(1);
  });

  it("並行修改同一張票：版本衝突被拒絕", async () => {
    const o = await fourTickets(0);
    const [A] = G.actors;
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, seq: 2 } });
    const input = { holderId: t.holderId, price: 700, transferStatus: "ASSIGNED" as const, pickupStatus: "NOT_PICKED" as const };
    const res = await Promise.allSettled([updateTicket(A, t.id, t.version, input), updateTicket(A, t.id, t.version, { ...input, price: 900 })]);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await prisma.obligation.count({ where: { ticketId: t.id, active: true } })).toBe(1);
  });

  it("新增票券後應付正確", async () => {
    const o = await fourTickets(0);
    const [A] = G.actors;
    await addTicket(A, o.id, 650);
    expect(await prisma.ticket.count({ where: { orderId: o.id } })).toBe(5);
  });

  it("跨場次淨額結算：保留原始帳目、建立結算紀錄、不可重複結算、可取消", async () => {
    const [A, B] = G.actors;
    // 第一場：A 買票，B 欠 A 1,200
    const o1 = await createOrder(A, { gameId: game1, buyerId: A.userId, pricePerTicket: 1200, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: B.userId }] });
    // 第二場：B 買票，A 欠 B 800
    const o2 = await createOrder(B, { gameId: game2, buyerId: B.userId, pricePerTicket: 800, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: A.userId }] });
    const bal = pairBalances(await computeLedger(prisma, G.group.id, { userId: B.userId }), B.userId).get(A.userId)!;
    expect([bal.iOwe, bal.theyOwe, bal.net]).toEqual([1200, 800, -400]);
    const pv = await previewSettlement(prisma, G.group.id, B.userId, A.userId);
    expect([pv.payerId, pv.payeeId, pv.netAmount]).toEqual([B.userId, A.userId, 400]);

    // 畫面金額過期時拒絕
    await expect(createSettlement(B, { userA: B.userId, userB: A.userId, expectedNet: 999, expectedPayerId: B.userId })).rejects.toThrow(/帳目已有變動/);
    const req = rid();
    const s = await createSettlement(B, { userA: B.userId, userB: A.userId, expectedNet: 400, expectedPayerId: B.userId, clientRequestId: req });
    // 重複送出同一請求：回傳同一筆
    const again = await createSettlement(B, { userA: B.userId, userB: A.userId, expectedNet: 400, expectedPayerId: B.userId, clientRequestId: req });
    expect(again.id).toBe(s.id);
    // 新的結算請求：已沒有未結帳目
    await expect(createSettlement(A, { userA: A.userId, userB: B.userId, expectedNet: 0, expectedPayerId: A.userId })).rejects.toThrow(/沒有未結帳目/);

    expect((await row(o1.id, B.userId)).state).toBe("PAID");
    expect((await row(o2.id, A.userId)).state).toBe("PAID");
    expect(await prisma.obligation.count({ where: { active: true } })).toBe(2); // 原始債務仍在
    const pay = await prisma.payment.findFirstOrThrow({ where: { settlementId: s.id } });
    expect([pay.payerId, pay.payeeId, pay.amount]).toEqual([B.userId, A.userId, 400]);
    expect(await prisma.settlementItem.count({ where: { settlementId: s.id } })).toBe(2);

    await cancelSettlement(A, s.id, "金額有誤");
    expect((await row(o1.id, B.userId)).outstanding).toBe(1200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("REVOKED");
  });

  it("結算後部分付款與新增帳目分開計算", async () => {
    const [A, B] = G.actors;
    const o1 = await createOrder(A, { gameId: game1, buyerId: A.userId, pricePerTicket: 1000, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: B.userId }] });
    await createPayment(B, { orderId: o1.id, payerId: B.userId, amount: 300 });
    await createSettlement(A, { userA: A.userId, userB: B.userId, expectedNet: 700, expectedPayerId: B.userId });
    expect((await row(o1.id, B.userId)).outstanding).toBe(0);
    const o2 = await createOrder(A, { gameId: game2, buyerId: A.userId, pricePerTicket: 500, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: B.userId }] });
    const pv = await previewSettlement(prisma, G.group.id, A.userId, B.userId);
    expect(pv.items.map((i) => i.orderId)).toEqual([o2.id]);
    expect(pv.netAmount).toBe(500);
  });
});
