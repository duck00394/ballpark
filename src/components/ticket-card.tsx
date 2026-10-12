import Link from "next/link";
import { PICKUP_STATUS_LABEL, TRANSFER_STATUS_LABEL } from "@/lib/labels";
import type { PayState } from "@/lib/money";
import { fmtDateTime } from "@/lib/time";
import { PAY_TONE, PICKUP_TONE, payLabel, seatText } from "./game-bits";
import { TicketOp } from "./ticket-ops";
import { ExpandRow } from "./expand";
import { Status, fmtMoney } from "./ui";

export interface TicketCardData {
  id: string;
  seq: number;
  price: number;
  section: string | null;
  rowLabel: string | null;
  seatNumber: string | null;
  ticketType: string;
  pickupMethod: string | null;
  note: string | null;
  holderId: string | null;
  transferStatus: string;
  pickupStatus: string;
  receivedConfirmedAt: Date | null;
  secretInfo: string | null;
  hasSecret: boolean;
  transfers?: { id: string; action: string; toUserId: string | null; actorId: string; createdAt: Date }[];
}

const ACTION_LABEL: Record<string, string> = {
  ASSIGN: "指定持有人",
  REVOKE: "撤銷分配",
  DELIVER: "完成交付",
  CONFIRM_RECEIVED: "持有人確認收到",
  ARCHIVE: "移除票券",
  "PICKUP:PICKED": "已取票",
  "PICKUP:NOT_PICKED": "改為尚未取票",
  "PICKUP:FAILED": "取票失敗",
  "PICKUP:REFUNDED": "已退票",
  "PICKUP:NOT_APPLICABLE": "取票不適用",
};

/**
 * 票券卡：第一層只放 編號、持有人、座位、票價、取票與付款狀態、一個主要操作；
 * 其餘（序號、備註、交付紀錄、次要操作）收在「展開」裡。
 */
export function TicketCard({
  t,
  nameOf,
  buyerId,
  viewerId,
  canEdit,
  orderActive,
  payState,
  gameLine,
}: {
  t: TicketCardData;
  nameOf: Map<string, string>;
  buyerId: string;
  viewerId: string;
  canEdit: boolean;
  orderActive: boolean;
  payState?: PayState | "REFUNDED";
  gameLine?: React.ReactNode;
}) {
  const isHolder = t.holderId === viewerId;
  const holderIsBuyer = t.holderId === buyerId;
  const canPickup = (isHolder || canEdit) && orderActive;
  const needsReceive = isHolder && !holderIsBuyer && !t.receivedConfirmedAt && orderActive;
  const notPicked = t.pickupStatus === "NOT_PICKED" || t.pickupStatus === "FAILED";

  // 付款狀態文字
  const pay = !t.holderId ? { tone: "muted" as const, text: "尚未分配" } : holderIsBuyer ? { tone: "muted" as const, text: "購票人自付" } : payState ? { tone: PAY_TONE[payState], text: payLabel(payState) } : null;
  const tone = pay?.tone === "bad" ? "bad" : pay?.tone === "warn" || notPicked || t.transferStatus === "ASSIGNED" ? "warn" : !t.holderId ? undefined : "good";

  // 主要操作：一次只給一個最需要的動作
  const primary = needsReceive ? (
    <TicketOp ticketId={t.id} op="received" label="我已收到票" variant="primary" />
  ) : canPickup && notPicked ? (
    <TicketOp ticketId={t.id} op="picked" label="標記已取票" variant="primary" />
  ) : null;

  return (
    <article className="ticket" data-tone={tone} data-ticket-seq={t.seq}>
      <div className="ticket-body">
        {gameLine ? <div className="text-xs text-faint mb-1.5 truncate">{gameLine}</div> : null}
        <div className="flex items-center justify-between gap-3">
          <span className="ticket-no">TICKET {String(t.seq).padStart(2, "0")}</span>
          <span className="money-md">{fmtMoney(t.price)}</span>
        </div>
        <div className="text-lg font-bold mt-1">
          {t.holderId ? nameOf.get(t.holderId) : "尚未分配"}
          {isHolder ? <span className="text-xs font-semibold text-faint ml-2">我持有</span> : null}
        </div>
        <div className="text-sm text-muted">{seatText(t)}</div>
        <div className="status-line mt-2.5">
          <Status tone={PICKUP_TONE[t.pickupStatus]}>{PICKUP_STATUS_LABEL[t.pickupStatus]}</Status>
          {pay ? <Status tone={pay.tone}>{pay.text}</Status> : null}
          {t.holderId && !holderIsBuyer && t.transferStatus === "ASSIGNED" ? <Status tone="warn">未交付</Status> : null}
        </div>
      </div>
      <ExpandRow
        label={`第 ${t.seq} 張票詳細資訊`}
        actions={
          <>
            {primary}
            <Link href={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
              {canEdit ? "管理票券" : "詳情"}
            </Link>
          </>
        }
      >
        <div className="px-4 pb-4 -mt-1">
          <dl className="inset space-y-0">
            <div className="kv"><dt>分票</dt><dd>{TRANSFER_STATUS_LABEL[t.transferStatus]}</dd></div>
            <div className="kv"><dt>持有人確認收到</dt><dd>{t.receivedConfirmedAt ? fmtDateTime(t.receivedConfirmedAt) : holderIsBuyer ? "不需要" : "尚未確認"}</dd></div>
            <div className="kv"><dt>票券類型</dt><dd>{t.ticketType}{t.pickupMethod ? `・${t.pickupMethod}` : ""}</dd></div>
            {t.note ? <div className="kv"><dt>備註</dt><dd>{t.note}</dd></div> : null}
            <div className="kv">
              <dt>票券識別資訊</dt>
              <dd className="break-all whitespace-pre-wrap">{t.secretInfo ?? (t.hasSecret ? "僅購票人、持有人與管理者可見" : "未填")}</dd>
            </div>
          </dl>
          {canPickup ? (
            <div className="flex flex-wrap gap-2 mt-3">
              {t.pickupStatus === "PICKED" ? <TicketOp ticketId={t.id} op="unpicked" label="改回未取票" /> : null}
              {t.pickupStatus === "NOT_PICKED" ? <TicketOp ticketId={t.id} op="pickfail" label="標記取票失敗" /> : null}
            </div>
          ) : null}
          {t.transfers?.length ? (
            <div className="mt-3">
              <div className="label mb-1">分配與交付紀錄</div>
              {t.transfers.map((x) => (
                <div key={x.id} className="flex justify-between gap-3 text-xs py-1">
                  <span>{ACTION_LABEL[x.action] ?? x.action}{x.action === "ASSIGN" && x.toUserId ? `：${nameOf.get(x.toUserId)}` : ""}</span>
                  <span className="text-faint shrink-0 num">{nameOf.get(x.actorId)}・{fmtDateTime(x.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </ExpandRow>
    </article>
  );
}
