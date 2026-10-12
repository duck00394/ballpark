"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { cancelSettlementAction, paymentOpAction, settlementAction } from "@/app/actions";

export function SettleForm({
  otherId,
  otherName,
  expectedNet,
  expectedPayerId,
  iPay,
  count,
  methods,
}: {
  otherId: string;
  otherName: string;
  expectedNet: number;
  expectedPayerId: string;
  iPay: boolean;
  count: number;
  methods: string[];
}) {
  const [open, setOpen] = useState(false);
  const text =
    expectedNet === 0
      ? `與 ${otherName} 的 ${count} 筆帳目剛好互相抵銷，確定結清？`
      : iPay
        ? `確定已付給 ${otherName} 淨額 ${expectedNet.toLocaleString()} 元，結清 ${count} 筆帳目？`
        : `確定已收到 ${otherName} 付的淨額 ${expectedNet.toLocaleString()} 元，結清 ${count} 筆帳目？`;
  if (!open)
    return (
      <button type="button" className="btn btn-primary w-full mt-3" onClick={() => setOpen(true)}>
        {expectedNet === 0 ? "互相抵銷結清" : iPay ? "我已付淨額，結清" : "已收到淨額，結清"}
      </button>
    );
  return (
    <ActionForm action={settlementAction} confirm={text} className="mt-3 inset">
      <input type="hidden" name="otherId" value={otherId} />
      <input type="hidden" name="expectedNet" value={expectedNet} />
      <input type="hidden" name="expectedPayerId" value={expectedPayerId} />
      <p className="text-sm mb-2">{text}</p>
      {expectedNet > 0 ? (
        <label className="field">
          <span className="field-label">付款方式</span>
          <select className="select" name="method">
            {methods.map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span className="field-label">備註</span>
        <input className="input" name="note" />
      </label>
      <div className="flex gap-2">
        <SubmitButton className="flex-1">確認結算</SubmitButton>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>取消</button>
      </div>
    </ActionForm>
  );
}

export function ConfirmPay({ paymentId, label }: { paymentId: string; label: string }) {
  return (
    <ActionForm action={paymentOpAction} showSuccess={false}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="op" value="confirm" />
      <SubmitButton className="btn-sm">{label}</SubmitButton>
    </ActionForm>
  );
}

export function CancelSettlement({ settlementId }: { settlementId: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        取消這次結算
      </button>
    );
  return (
    <ActionForm action={cancelSettlementAction} confirm="確定取消這次結算？涵蓋的帳目會恢復為未結。">
      <input type="hidden" name="settlementId" value={settlementId} />
      <input className="input mb-2" name="reason" placeholder="取消原因" required />
      <SubmitButton variant="danger" className="btn-sm">確定取消</SubmitButton>
    </ActionForm>
  );
}
