"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { ticketQuickAction } from "@/app/actions";

/** 票券快速操作按鈕（確認收到、取票狀態） */
export function TicketOp({ ticketId, op, label, variant = "secondary" }: { ticketId: string; op: string; label: string; variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <ActionForm action={ticketQuickAction} showSuccess={false}>
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant} className="btn-sm">{label}</SubmitButton>
    </ActionForm>
  );
}
