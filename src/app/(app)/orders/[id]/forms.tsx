"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import {
  addTicketAction,
  paymentAction,
  paymentOpAction,
  refundAction,
  refundOpAction,
  ticketQuickAction,
  updateOrderAction,
} from "@/app/actions";
import { FEE_MODE_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";

export function TicketQuick({ ticketId, isHolder, canEdit, received, pickup, holderIsBuyer = false }: { ticketId: string; isHolder: boolean; canEdit: boolean; received: boolean; pickup: string; holderIsBuyer?: boolean }) {
  if (!isHolder && !canEdit) return null;
  const btn = (op: string, label: string, variant: "secondary" | "primary" = "secondary") => (
    <ActionForm action={ticketQuickAction} showSuccess={false}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant} className="btn-sm">{label}</SubmitButton>
    </ActionForm>
  );
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {isHolder && !received && !holderIsBuyer ? btn("received", "我已收到票", "primary") : null}
      {pickup === "NOT_PICKED" || pickup === "FAILED" ? btn("picked", "標記已取票") : null}
      {pickup === "PICKED" ? btn("unpicked", "改回未取票") : null}
    </div>
  );
}

export function AddTicketForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={addTicketAction} className="mb-2">
      <input type="hidden" name="orderId" value={orderId} />
      <SubmitButton variant="secondary" block>再加一張票</SubmitButton>
    </ActionForm>
  );
}

export function PaymentForm({ orderId, payerId, outstanding, methods, who, today }: { orderId: string; payerId: string; outstanding: number; methods: string[]; who: string; today: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setOpen(true)}>
        {who}
      </button>
    );
  return (
    <ActionForm action={paymentAction} className="w-full inset">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="payerId" value={payerId} />
      <div className="grid-2">
        <label className="field">
          <span className="field-label">金額</span>
          <input className="input" name="amount" inputMode="numeric" defaultValue={outstanding} required />
          <span className="field-hint">可分次付款，最多 {outstanding} 元</span>
        </label>
        <label className="field">
          <span className="field-label">日期</span>
          <input className="input" type="date" name="paidDate" defaultValue={today} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">付款方式</span>
        <select className="select" name="method" defaultValue={methods[0]}>
          {methods.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">備註</span>
        <input className="input" name="note" />
      </label>
      <div className="flex gap-2">
        <SubmitButton className="flex-1">記錄付款</SubmitButton>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>取消</button>
      </div>
    </ActionForm>
  );
}

export function PaymentOps({ paymentId, canConfirm, canRevoke }: { paymentId: string; canConfirm: boolean; canRevoke: boolean }) {
  const [revoking, setRevoking] = useState(false);
  return (
    <div className="flex gap-1 items-center shrink-0 flex-wrap justify-end">
      {canConfirm ? (
        <ActionForm action={paymentOpAction} showSuccess={false}>
          <input type="hidden" name="paymentId" value={paymentId} />
          <input type="hidden" name="op" value="confirm" />
          <SubmitButton className="btn-sm">確認</SubmitButton>
        </ActionForm>
      ) : null}
      {canRevoke && !revoking ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoking(true)}>撤銷</button>
      ) : null}
      {revoking ? (
        <ActionForm action={paymentOpAction} confirm="確定撤銷這筆付款？紀錄會保留但不再計入已付金額。" className="w-full">
          <input type="hidden" name="paymentId" value={paymentId} />
          <input type="hidden" name="op" value="revoke" />
          <input className="input mb-1" name="reason" placeholder="撤銷原因" required />
          <SubmitButton variant="danger" className="btn-sm">確定撤銷</SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function RefundForm({ orderId, fromUserId, toUserId, amount, label, methods }: { orderId: string; fromUserId: string; toUserId: string; amount: number; label: string; methods: string[] }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <ActionForm action={refundAction} className="w-full inset">
      <input type="hidden" name="kind" value="MEMBER" />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="fromUserId" value={fromUserId} />
      <input type="hidden" name="toUserId" value={toUserId} />
      <label className="field">
        <span className="field-label">退款金額</span>
        <input className="input" name="amount" inputMode="numeric" defaultValue={amount} required />
      </label>
      <label className="field">
        <span className="field-label">方式</span>
        <select className="select" name="method">
          {methods.map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" name="completed" defaultChecked />
        <span>已完成退款（未勾選則記為「退款中」）</span>
      </label>
      <div className="flex gap-2">
        <SubmitButton className="flex-1">記錄退款</SubmitButton>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>取消</button>
      </div>
    </ActionForm>
  );
}

export function RefundOps({ refundId, canCancel }: { refundId: string; canCancel: boolean }) {
  return (
    <div className="flex gap-1 items-center shrink-0">
      <ActionForm action={refundOpAction} showSuccess={false}>
        <input type="hidden" name="refundId" value={refundId} />
        <input type="hidden" name="op" value="complete" />
        <SubmitButton className="btn-sm">標記已退款</SubmitButton>
      </ActionForm>
      {canCancel ? (
        <ActionForm action={refundOpAction} confirm="確定取消這筆退款紀錄？" showSuccess={false}>
          <input type="hidden" name="refundId" value={refundId} />
          <input type="hidden" name="op" value="cancel" />
          <SubmitButton variant="ghost" className="btn-sm">取消</SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function PlatformRefundForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm action={refundAction} resetOnSuccess>
      <input type="hidden" name="kind" value="PLATFORM" />
      <input type="hidden" name="orderId" value={orderId} />
      <p className="text-xs text-faint mb-3">
        這只記錄平台退回給購票人的金額。朋友間的帳目請把退掉的票設為「已退票」，或將訂單改為「已退款」，系統會自動重算並提示需退回的款項。
      </p>
      <label className="field">
        <span className="field-label">平台退款金額</span>
        <input className="input" name="amount" inputMode="numeric" required />
      </label>
      <label className="check">
        <input type="checkbox" name="completed" />
        <span>已入帳（未勾選則記為「退款中」）</span>
      </label>
      <label className="field">
        <span className="field-label">備註</span>
        <input className="input" name="note" />
      </label>
      <SubmitButton variant="secondary" block>記錄平台退款</SubmitButton>
    </ActionForm>
  );
}

export function EditOrderForm({
  order,
  members,
  holders,
  platforms,
}: {
  order: {
    id: string;
    version: number;
    buyerId: string;
    platformId: string | null;
    purchaseUrl: string | null;
    orderNumber: string | null;
    ticketCategory: string | null;
    feeAmount: number;
    otherFeeAmount: number;
    actualTotal: number | null;
    feeSplitMode: string;
    customFeeSplit: Record<string, number>;
    status: string;
    purchasedDate: string;
    purchasedTime: string;
    pickupDeadlineDate: string;
    pickupDeadlineTime: string;
    note: string | null;
  };
  members: { id: string; name: string }[];
  holders: string[];
  platforms: { id: string; name: string }[];
  isBuyer: boolean;
}) {
  const [mode, setMode] = useState(order.feeSplitMode);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  return (
    <ActionForm action={updateOrderAction}>
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="version" value={order.version} />
      <div className="grid-2">
        <label className="field">
          <span className="field-label">購票狀態</span>
          <select className="select" name="status" defaultValue={order.status}>
            {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">購票人</span>
          <select className="select" name="buyerId" defaultValue={order.buyerId}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">售票平台</span>
        <select className="select" name="platformId" defaultValue={order.platformId ?? ""}>
          <option value="">未填</option>
          {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">購票連結</span>
        <input className="input" name="purchaseUrl" type="url" defaultValue={order.purchaseUrl ?? ""} placeholder="https://" />
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">訂單編號</span>
          <input className="input" name="orderNumber" defaultValue={order.orderNumber ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">票種</span>
          <input className="input" name="ticketCategory" defaultValue={order.ticketCategory ?? ""} />
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">購票日期</span>
          <input className="input" type="date" name="purchasedDate" defaultValue={order.purchasedDate} />
        </label>
        <label className="field">
          <span className="field-label">時間</span>
          <input className="input" type="time" name="purchasedTime" defaultValue={order.purchasedTime} />
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">取票期限</span>
          <input className="input" type="date" name="pickupDeadlineDate" defaultValue={order.pickupDeadlineDate} />
        </label>
        <label className="field">
          <span className="field-label">時間</span>
          <input className="input" type="time" name="pickupDeadlineTime" defaultValue={order.pickupDeadlineTime} />
        </label>
      </div>
      <div className="grid-3">
        <label className="field">
          <span className="field-label">手續費</span>
          <input className="input" name="feeAmount" inputMode="numeric" defaultValue={order.feeAmount} />
        </label>
        <label className="field">
          <span className="field-label">其他費用</span>
          <input className="input" name="otherFeeAmount" inputMode="numeric" defaultValue={order.otherFeeAmount} />
        </label>
        <label className="field">
          <span className="field-label">實際總額</span>
          <input className="input" name="actualTotal" inputMode="numeric" defaultValue={order.actualTotal ?? ""} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">分攤方式</span>
        <select className="select" name="feeSplitMode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {Object.entries(FEE_MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      {mode === "CUSTOM" ? (
        <div className="grid-2">
          {holders.map((id) => (
            <label key={id} className="field">
              <span className="field-label">{nameOf.get(id)} 負擔</span>
              <input className="input" name={`custom_${id}`} inputMode="numeric" defaultValue={order.customFeeSplit[id] ?? ""} />
            </label>
          ))}
        </div>
      ) : null}
      <label className="field">
        <span className="field-label">備註</span>
        <textarea className="textarea" name="note" defaultValue={order.note ?? ""} />
      </label>
      <p className="text-xs text-muted mb-2">儲存後會依新設定重新計算應付金額；舊的應付紀錄會作廢保留，付款紀錄不受影響。改為「取消」或「已退款」不會刪除訂單。</p>
      <SubmitButton block>儲存訂單</SubmitButton>
    </ActionForm>
  );
}
