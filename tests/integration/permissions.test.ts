import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { actorFor } from "@/server/context";
import { createOrder, getOrderDetail, listTickets, updateOrder, updateTicket, confirmTicketReceived } from "@/server/services/orders";
import { confirmPayment, createPayment, revokePayment, computeLedger } from "@/server/services/finance";
import { getVisibleGame, createManualGame, updateGameResult } from "@/server/services/games";
import { exportBackup, collectExports } from "@/server/services/backup";
import { setAttendance } from "@/server/services/stats";
import { login, getSessionUser } from "@/server/services/auth";
import { makeGroup, makeOfficialGame, resetDb, rid, team } from "../helpers";

let g1: Awaited<ReturnType<typeof makeGroup>>;
let g2: Awaited<ReturnType<typeof makeGroup>>;
let gameId: string;

async function order1() {
  const [A, B] = g1.actors;
  return createOrder(A, {
    gameId,
    buyerId: A.userId,
    pricePerTicket: 650,
    feeAmount: 0,
    otherFeeAmount: 0,
    feeSplitMode: "PER_TICKET",
    status: "PURCHASED",
    tickets: [{ holderId: A.userId }, { holderId: B.userId, secretInfo: "QR-SECRET-123" }],
  });
}

beforeEach(async () => {
  await resetDb();
  g1 = await makeGroup(["A", "B", "C"], "g1");
  g2 = await makeGroup(["X"], "g2");
  gameId = (await makeOfficialGame({ home: "ACN011", away: "ADD011", date: "2026-10-20" })).id;
});

describe("A. 權限", () => {
  it("非群組成員無法取得 Actor（伺服器端檢查）", async () => {
    await expect(actorFor(g2.users[0].id, g1.group.id)).rejects.toThrow(/不是此群組成員/);
  });

  it("停用的成員立即失去權限", async () => {
    await prisma.groupMember.update({ where: { groupId_userId: { groupId: g1.group.id, userId: g1.users[2].id } }, data: { active: false } });
    await expect(actorFor(g1.users[2].id, g1.group.id)).rejects.toThrow();
  });

  it("修改 ID 無法讀取其他群組的訂單、票券、付款", async () => {
    const o = await order1();
    const X = g2.actors[0];
    await expect(getOrderDetail(X, o.id)).rejects.toThrow(/找不到/);
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id } });
    await expect(updateTicket(X, t.id, t.version, { price: 1, transferStatus: "UNASSIGNED", pickupStatus: "NOT_PICKED" })).rejects.toThrow(/找不到/);
    await expect(createPayment(X, { orderId: o.id, payerId: X.userId, amount: 1 })).rejects.toThrow(/找不到/);
    expect(await listTickets(X, { scope: "all" })).toHaveLength(0);
    expect(await computeLedger(prisma, X.groupId)).toHaveLength(0);
    const sets = await collectExports(X);
    expect(sets.find((s) => s.name === "orders")!.rows).toHaveLength(0);
  });

  it("其他群組手動建立的比賽看不到", async () => {
    const [A] = g1.actors;
    const [h, a] = [await team("ACN011"), await team("AJL011")];
    const g = await createManualGame(A, { date: "2026-11-01", time: "18:00", homeTeamId: h.id, awayTeamId: a.id, venueId: null });
    await expect(getVisibleGame(g2.actors[0], g.id)).rejects.toThrow(/找不到/);
    await expect(createOrder(g2.actors[0], { gameId: g.id, buyerId: g2.users[0].id, pricePerTicket: 1, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{}] })).rejects.toThrow(/找不到/);
  });

  it("不能把票指定給其他群組的人", async () => {
    const [A] = g1.actors;
    await expect(
      createOrder(A, { gameId, buyerId: A.userId, pricePerTicket: 1, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: g2.users[0].id }] }),
    ).rejects.toThrow(/不是此群組成員/);
  });

  it("非建立者／購票人不能修改訂單；持票人看得到自己票的敏感資訊，其他成員看不到", async () => {
    const o = await order1();
    const [, B, C] = g1.actors;
    await expect(updateOrder(C, o.id, o.version, { buyerId: C.userId, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "CANCELLED" })).rejects.toThrow(/只有/);
    const asB = await getOrderDetail(B, o.id);
    expect(asB.tickets.find((t) => t.holderId === B.userId)!.secretInfo).toBe("QR-SECRET-123");
    const asC = await getOrderDetail(C, o.id);
    expect(asC.tickets.find((t) => t.holderId === B.userId)!.secretInfo).toBeNull();
    expect(asC.tickets.find((t) => t.holderId === B.userId)!.hasSecret).toBe(true);
  });

  it("只有持有人能確認收到票券", async () => {
    const o = await order1();
    const [A, B, C] = g1.actors;
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, holderId: B.userId } });
    await expect(confirmTicketReceived(C, t.id)).rejects.toThrow(/只有票券持有人/);
    await expect(confirmTicketReceived(A, t.id)).rejects.toThrow(/只有票券持有人/);
    await confirmTicketReceived(B, t.id);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.receivedConfirmedAt).not.toBeNull();
    expect(after.transferStatus).toBe("DELIVERED");
  });

  it("成員不能替別人確認付款、不能記錄與自己無關的付款、不能撤銷對方已確認的付款", async () => {
    const [A, B, C] = g1.actors; // A 是管理者，B、C 是一般成員
    // B（一般成員）建立訂單並代墊，C 持票
    const o = await createOrder(B, { gameId, buyerId: B.userId, pricePerTicket: 650, feeAmount: 0, otherFeeAmount: 0, feeSplitMode: "PER_TICKET", status: "PURCHASED", tickets: [{ holderId: C.userId }] });
    const D = (await makeGroup(["外人"], "g3")).actors[0];
    await expect(createPayment(D, { orderId: o.id, payerId: C.userId, amount: 100 })).rejects.toThrow(/找不到/);
    // 管理者以外，不能記錄與自己無關的付款
    const p = await createPayment(C, { orderId: o.id, payerId: C.userId, amount: 100, clientRequestId: rid() });
    expect(p.payerConfirmedAt).not.toBeNull();
    expect(p.payeeConfirmedAt).toBeNull();
    // 只有收款人 B 能確認收款；A（非當事人）不能替 B 確認
    await expect(confirmPayment(A, p.id)).rejects.toThrow(/只有付款人或收款人/);
    await confirmPayment(B, p.id);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).payeeConfirmedAt).not.toBeNull();
    // 訂單建立者 B 不能撤銷 C 建立的付款
    await expect(revokePayment(B, p.id, "test")).rejects.toThrow(/只有建立者或管理者/);
    // C 是建立者，但 B 已確認收款 → C 不能自行撤銷，需由管理者處理
    await expect(revokePayment(C, p.id, "打錯")).rejects.toThrow(/對方已確認/);
    await revokePayment(A, p.id, "管理者更正");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("REVOKED");
    expect(await prisma.auditLog.count({ where: { entityId: p.id, action: "PAYMENT_REVOKE" } })).toBe(1);
  });

  it("非當事人的一般成員不能記錄別人的付款", async () => {
    const o = await order1();
    const [, B, C] = g1.actors;
    await expect(createPayment(C, { orderId: o.id, payerId: B.userId, amount: 100 })).rejects.toThrow(/只能記錄自己/);
  });

  it("官方賽程比分只有管理者可修正；成員只能設定自己的觀賽紀錄", async () => {
    const [A, B] = g1.actors;
    const g = await prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    await expect(updateGameResult(B, gameId, g.version, { status: "FINAL", homeScore: 1, awayScore: 0, resultConfirmed: true })).rejects.toThrow(/管理者/);
    await updateGameResult(A, gameId, g.version, { status: "FINAL", homeScore: 1, awayScore: 0, resultConfirmed: true });
    await expect(setAttendance(B, gameId, A.userId, { status: "ATTENDED", supportTeamId: null })).rejects.toThrow(/只能設定自己/);
  });

  it("完整備份只有管理者可匯出", async () => {
    await expect(exportBackup(g1.actors[1])).rejects.toThrow(/管理者/);
    await expect(exportBackup(g1.actors[0])).resolves.toBeTruthy();
  });

  it("登入：錯誤密碼失敗、5 次後鎖定、正確密碼取得工作階段", async () => {
    const u = g1.users[1];
    await expect(login(u.username, "wrong")).rejects.toThrow(/帳號或密碼錯誤/);
    const ok = await login(u.username, "password123");
    expect((await getSessionUser(ok.token))!.userId).toBe(u.id);
    expect(await getSessionUser("forged-token")).toBeNull();
    for (let i = 0; i < 5; i++) await login(u.username, "nope").catch(() => {});
    await expect(login(u.username, "password123")).rejects.toThrow(/失敗次數過多/);
  });
});
