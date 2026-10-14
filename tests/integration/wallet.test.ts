import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOrder, setPickupStatus, transferTicket, walletTickets } from "@/server/services/orders";
import { computeLedger, createPayment } from "@/server/services/finance";
import { makeGroup, makeOfficialGame, resetDb, rid } from "../helpers";

let G: Awaited<ReturnType<typeof makeGroup>>;
let gameId: string;
beforeEach(async () => {
  await resetDb();
  G = await makeGroup(["A", "B", "C", "D"]);
  gameId = (await makeOfficialGame({ home: "ACN011", away: "AAA011", date: "2099-10-17", venue: "大巨蛋" })).id;
});

async function order() {
  const [A, B] = G.actors;
  return createOrder(A, {
    gameId,
    buyerId: A.userId,
    pricePerTicket: 1000,
    feeAmount: 0,
    otherFeeAmount: 0,
    feeSplitMode: "PER_TICKET",
    status: "PURCHASED",
    tickets: [{ holderId: A.userId }, { holderId: B.userId, secretInfo: "SN-002" }, {}],
    clientRequestId: rid(),
  });
}
const row = async (orderId: string, uid: string) => (await computeLedger(prisma, G.group.id, { orderId })).find((r) => r.debtorId === uid);

describe("我的票券", () => {
  it("票券夾：持有的票＋自己購買但未分配的票；他人看不到別人的票", async () => {
    await order();
    const [A, B, C] = G.actors;
    expect((await walletTickets(A)).map((t) => t.seq).sort()).toEqual([1, 3]);
    const b = await walletTickets(B);
    expect(b.map((t) => t.seq)).toEqual([2]);
    expect(b[0].secretInfo).toBe("SN-002");
    expect(await walletTickets(C)).toHaveLength(0);
  });

  it("持有人按「我已取票」同時確認收到；付款狀態不變", async () => {
    const o = await order();
    const [, B] = G.actors;
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, seq: 2 } });
    await setPickupStatus(B, t.id, "PICKED");
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect([after.pickupStatus, after.transferStatus, !!after.receivedConfirmedAt]).toEqual(["PICKED", "DELIVERED", true]);
    expect((await row(o.id, B.userId))!.state).toBe("UNPAID");
  });

  it("轉送：持有人可轉給其他成員，對方需重新取票，應付款改由對方負擔，已付款顯示需退回", async () => {
    const o = await order();
    const [, B, C, D] = G.actors;
    const t = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, seq: 2 } });
    await createPayment(B, { orderId: o.id, payerId: B.userId, amount: 400, clientRequestId: rid() });
    await setPickupStatus(B, t.id, "PICKED");
    await expect(transferTicket(C, t.id, D.userId)).rejects.toThrow(/只有持有人或訂單管理者/);
    await transferTicket(B, t.id, C.userId);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect([after.holderId, after.pickupStatus, after.transferStatus, after.receivedConfirmedAt]).toEqual([C.userId, "NOT_PICKED", "ASSIGNED", null]);
    expect((await row(o.id, C.userId))!.due).toBe(1000);
    const rb = (await row(o.id, B.userId))!;
    expect([rb.due, rb.paid, rb.outstanding, rb.state]).toEqual([0, 400, -400, "OVERPAID"]);
    expect((await walletTickets(B)).length).toBe(0);
    expect((await walletTickets(C)).map((x) => x.seq)).toEqual([2]);
    expect(await prisma.ticketTransfer.count({ where: { ticketId: t.id, note: "轉送" } })).toBe(1);
  });

  it("購票人可轉送未分配的票；不能轉給自己或群組外的人", async () => {
    const o = await order();
    const [A, , , D] = G.actors;
    const t3 = await prisma.ticket.findFirstOrThrow({ where: { orderId: o.id, seq: 3 } });
    await transferTicket(A, t3.id, D.userId);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t3.id } })).holderId).toBe(D.userId);
    await expect(transferTicket(A, t3.id, D.userId)).rejects.toThrow(/已經是對方/);
    const outsider = (await makeGroup(["X"], "other")).users[0];
    await expect(transferTicket(A, t3.id, outsider.id)).rejects.toThrow(/不是此群組成員/);
  });
});
