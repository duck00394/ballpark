import { describe, expect, it } from "vitest";
import { allocateByWeight, computeOrderShares, payState } from "@/lib/money";

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("allocateByWeight 整數分配", () => {
  it("可整除時平均分配", () => {
    const m = allocateByWeight(120, [{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }]);
    expect([...m.values()]).toEqual([40, 40, 40]);
  });
  it("零頭由購票人吸收，總額完全相符", () => {
    const m = allocateByWeight(100, [{ id: "buyer", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }], "buyer");
    expect(m.get("buyer")).toBe(34);
    expect(m.get("b")).toBe(33);
    expect(m.get("c")).toBe(33);
    expect(sum(m)).toBe(100);
  });
  it("購票人不在名單時，依小數大小與 id 排序穩定分配", () => {
    const a = allocateByWeight(101, [{ id: "z", weight: 1 }, { id: "y", weight: 1 }, { id: "x", weight: 1 }], "nobody");
    const b = allocateByWeight(101, [{ id: "x", weight: 1 }, { id: "z", weight: 1 }, { id: "y", weight: 1 }], "nobody");
    expect(sum(a)).toBe(101);
    expect(a.get("x")).toBe(34);
    expect([...a].sort()).toEqual([...b].sort()); // 與輸入順序無關
  });
  it("大量隨機案例總和永遠相等（不會有 1 元誤差）", () => {
    for (let i = 0; i < 2000; i++) {
      const total = Math.floor(Math.random() * 100000);
      const n = 1 + Math.floor(Math.random() * 8);
      const ws = Array.from({ length: n }, (_, k) => ({ id: `u${k}`, weight: 1 + Math.floor(Math.random() * 5) }));
      const m = allocateByWeight(total, ws, Math.random() < 0.5 ? "u0" : undefined);
      expect(sum(m)).toBe(total);
      for (const v of m.values()) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

const T = (id: string, holderId: string | null, price = 650, pickupStatus = "NOT_PICKED") => ({ id, holderId, price, pickupStatus, archived: false });
const base = { buyerId: "A", status: "PURCHASED" as const, feeAmount: 100, otherFeeAmount: 0 };

describe("computeOrderShares 訂單分攤", () => {
  const tickets = [T("t1", "A"), T("t2", "B"), T("t3", "C"), T("t4", "D")];
  it("按票數分攤：4 張票、手續費 100", () => {
    const s = computeOrderShares({ ...base, feeSplitMode: "PER_TICKET" }, tickets);
    expect(s.ticketTotal).toBe(2600);
    expect(s.grandTotal).toBe(2700);
    expect(s.byUser.get("B")).toEqual({ ticket: 650, fee: 25 });
    expect(s.obligations.filter((o) => o.debtorId === "B").reduce((a, o) => a + o.amount, 0)).toBe(675);
    expect(s.obligations.some((o) => o.debtorId === "A")).toBe(false); // 購票人不欠自己
  });
  it("持票人平均分攤：B 持兩張，手續費仍按人頭平分（零頭給購票人）", () => {
    const s = computeOrderShares({ ...base, feeAmount: 100, feeSplitMode: "EQUAL_HOLDERS" }, [T("1", "A"), T("2", "B"), T("3", "B")]);
    expect(s.byUser.get("A")!.fee).toBe(50);
    expect(s.byUser.get("B")!.fee).toBe(50);
    const s3 = computeOrderShares({ ...base, feeAmount: 100, feeSplitMode: "EQUAL_HOLDERS" }, [T("1", "A"), T("2", "B"), T("3", "C")]);
    expect(s3.byUser.get("A")!.fee).toBe(34);
    expect(s3.byUser.get("B")!.fee + s3.byUser.get("C")!.fee).toBe(66);
  });
  it("購票人吸收手續費", () => {
    const s = computeOrderShares({ ...base, feeSplitMode: "BUYER_ABSORBS" }, tickets);
    expect(s.obligations.filter((o) => o.kind === "FEE")).toHaveLength(0);
    expect(s.byUser.get("A")!.fee).toBe(100);
  });
  it("自訂分攤必須剛好等於費用總額", () => {
    const ok = computeOrderShares({ ...base, otherFeeAmount: 20, feeSplitMode: "CUSTOM", customFeeSplit: { A: 0, B: 60, C: 60 } }, tickets);
    expect(ok.byUser.get("B")!.fee).toBe(60);
    expect(() => computeOrderShares({ ...base, feeSplitMode: "CUSTOM", customFeeSplit: { B: 50, C: 49 } }, tickets)).toThrow(/不符/);
  });
  it("未分配的票由購票人負擔", () => {
    const s = computeOrderShares({ ...base, feeSplitMode: "PER_TICKET" }, [T("1", null), T("2", "B")]);
    expect(s.byUser.get("A")).toEqual({ ticket: 650, fee: 50 });
  });
  it("已退票的票價不再計入，取消或已退款的訂單不產生應付", () => {
    const s = computeOrderShares({ ...base, feeSplitMode: "PER_TICKET" }, [T("1", "A"), T("2", "B", 650, "REFUNDED")]);
    expect(s.byUser.get("B")!.ticket).toBe(0);
    for (const st of ["CANCELLED", "REFUNDED", "PENDING", "FAILED"] as const)
      expect(computeOrderShares({ ...base, status: st, feeSplitMode: "PER_TICKET" }, tickets).obligations).toHaveLength(0);
  });
  it("付款狀態由金額計算", () => {
    expect(payState(1300, 1300)).toBe("UNPAID");
    expect(payState(1300, 800)).toBe("PARTIAL");
    expect(payState(1300, 0)).toBe("PAID");
    expect(payState(0, -500)).toBe("OVERPAID");
  });
});
