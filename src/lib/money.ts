/**
 * 金額計算（全部為整數「元」，不使用浮點數做分配）。
 */

export function assertInt(n: number, label = "金額"): void {
  if (!Number.isSafeInteger(n)) throw new Error(`${label}必須是整數`);
}

/**
 * 依權重分配整數金額，總和必定等於 total。
 * 規則：
 * 1. 每人先分到 floor(total * w / W)。
 * 2. 剩餘零頭（必小於人數）優先由 preferredId（購票人）全部吸收；
 * 3. 若 preferredId 不在分配名單，零頭依「小數部分大者優先，同值依 id 字典序」逐一分配 1 元。
 */
export function allocateByWeight(
  total: number,
  weights: { id: string; weight: number }[],
  preferredId?: string,
): Map<string, number> {
  assertInt(total);
  const result = new Map<string, number>();
  const valid = weights.filter((w) => w.weight > 0);
  if (total === 0 || valid.length === 0) {
    for (const w of weights) result.set(w.id, 0);
    return result;
  }
  const W = valid.reduce((s, w) => s + w.weight, 0);
  let allocated = 0;
  const rema: { id: string; rem: number }[] = [];
  for (const w of weights) {
    if (w.weight <= 0) {
      result.set(w.id, 0);
      continue;
    }
    const num = total * w.weight; // 整數乘法
    const base = Math.floor(num / W);
    result.set(w.id, base);
    allocated += base;
    rema.push({ id: w.id, rem: num - base * W });
  }
  let left = total - allocated;
  if (left > 0 && preferredId && valid.some((w) => w.id === preferredId)) {
    result.set(preferredId, (result.get(preferredId) ?? 0) + left);
    left = 0;
  }
  rema.sort((a, b) => b.rem - a.rem || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; left > 0; i = (i + 1) % rema.length) {
    result.set(rema[i].id, (result.get(rema[i].id) ?? 0) + 1);
    left--;
  }
  return result;
}

export type FeeMode = "BUYER_ABSORBS" | "EQUAL_HOLDERS" | "PER_TICKET" | "CUSTOM";
export type OrderStatusLike =
  | "PENDING"
  | "BUYING"
  | "PURCHASED"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDING"
  | "REFUNDED";

export interface ShareInputTicket {
  id: string;
  holderId: string | null;
  price: number;
  pickupStatus: string;
  archived: boolean;
}

export interface ShareInputOrder {
  buyerId: string;
  status: OrderStatusLike;
  feeAmount: number;
  otherFeeAmount: number;
  feeSplitMode: FeeMode;
  customFeeSplit?: Record<string, number> | null;
}

export interface OrderShares {
  /** 每位使用者負擔（含購票人自己） */
  byUser: Map<string, { ticket: number; fee: number }>;
  /** 需要由購票人以外成員支付的明細 */
  obligations: { debtorId: string; kind: "TICKET" | "FEE"; ticketId: string | null; amount: number }[];
  ticketTotal: number;
  feeTotal: number;
  grandTotal: number;
}

/** 訂單是否產生應付款 */
export function orderIsBillable(status: OrderStatusLike): boolean {
  return status === "PURCHASED" || status === "REFUNDING";
}

export function computeOrderShares(order: ShareInputOrder, tickets: ShareInputTicket[]): OrderShares {
  const byUser = new Map<string, { ticket: number; fee: number }>();
  const add = (uid: string, k: "ticket" | "fee", v: number) => {
    const cur = byUser.get(uid) ?? { ticket: 0, fee: 0 };
    cur[k] += v;
    byUser.set(uid, cur);
  };
  const obligations: OrderShares["obligations"] = [];
  if (!orderIsBillable(order.status)) {
    return { byUser, obligations, ticketTotal: 0, feeTotal: 0, grandTotal: 0 };
  }
  const live = tickets.filter((t) => !t.archived);
  let ticketTotal = 0;
  for (const t of live) {
    assertInt(t.price, "票價");
    if (t.pickupStatus === "REFUNDED") continue; // 已退票的票價不再分攤
    const uid = t.holderId ?? order.buyerId;
    ticketTotal += t.price;
    add(uid, "ticket", t.price);
    if (uid !== order.buyerId && t.price > 0) {
      obligations.push({ debtorId: uid, kind: "TICKET", ticketId: t.id, amount: t.price });
    }
  }

  const feeTotal = order.feeAmount + order.otherFeeAmount;
  assertInt(feeTotal, "手續費");
  let feeAlloc = new Map<string, number>();
  if (feeTotal > 0) {
    const holderIds = live.map((t) => t.holderId ?? order.buyerId);
    switch (order.feeSplitMode) {
      case "BUYER_ABSORBS":
        feeAlloc.set(order.buyerId, feeTotal);
        break;
      case "PER_TICKET": {
        const counts = new Map<string, number>();
        for (const h of holderIds) counts.set(h, (counts.get(h) ?? 0) + 1);
        if (counts.size === 0) counts.set(order.buyerId, 1);
        feeAlloc = allocateByWeight(
          feeTotal,
          [...counts].map(([id, weight]) => ({ id, weight })),
          order.buyerId,
        );
        break;
      }
      case "EQUAL_HOLDERS": {
        const uniq = [...new Set(holderIds)];
        if (uniq.length === 0) uniq.push(order.buyerId);
        feeAlloc = allocateByWeight(
          feeTotal,
          uniq.map((id) => ({ id, weight: 1 })),
          order.buyerId,
        );
        break;
      }
      case "CUSTOM": {
        const split = order.customFeeSplit ?? {};
        let sum = 0;
        for (const [uid, amt] of Object.entries(split)) {
          assertInt(amt, "自訂分攤金額");
          if (amt < 0) throw new Error("自訂分攤金額不可為負數");
          sum += amt;
          if (amt > 0) feeAlloc.set(uid, amt);
        }
        if (sum !== feeTotal) {
          throw new Error(`自訂分攤合計 ${sum} 元，與可分攤費用 ${feeTotal} 元不符`);
        }
        break;
      }
    }
  }
  for (const [uid, amt] of feeAlloc) {
    if (amt === 0) continue;
    add(uid, "fee", amt);
    if (uid !== order.buyerId) obligations.push({ debtorId: uid, kind: "FEE", ticketId: null, amount: amt });
  }
  return { byUser, obligations, ticketTotal, feeTotal, grandTotal: ticketTotal + feeTotal };
}

export function formatTWD(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}NT$ ${Math.abs(n).toLocaleString("en-US")}`;
}

export type PayState = "NONE" | "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

export function payState(due: number, outstanding: number): PayState {
  if (due === 0 && outstanding === 0) return "NONE";
  if (outstanding < 0) return "OVERPAID";
  if (outstanding === 0) return "PAID";
  if (outstanding >= due) return "UNPAID";
  return "PARTIAL";
}

export const PAY_STATE_LABEL: Record<PayState, string> = {
  NONE: "不需付款",
  UNPAID: "未付款",
  PARTIAL: "部分付款",
  PAID: "已付清",
  OVERPAID: "溢付待退款",
};
