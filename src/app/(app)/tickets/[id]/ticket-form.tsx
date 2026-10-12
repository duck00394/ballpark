"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { ticketQuickAction, updateTicketAction } from "@/app/actions";
import { PICKUP_STATUS_LABEL, TRANSFER_STATUS_LABEL } from "@/lib/labels";

type T = {
  id: string;
  version: number;
  holderId: string | null;
  price: number;
  section: string | null;
  rowLabel: string | null;
  seatNumber: string | null;
  ticketType: string;
  pickupMethod: string | null;
  secretInfo: string | null;
  note: string | null;
  transferStatus: string;
  pickupStatus: string;
};

export function TicketEditForm({ t, members }: { t: T; members: { id: string; name: string }[] }) {
  return (
    <ActionForm action={updateTicketAction}>
      <input type="hidden" name="ticketId" value={t.id} />
      <input type="hidden" name="version" value={t.version} />
      <div className="grid-2">
        <label className="field">
          <span className="field-label">持有人</span>
          <select className="select" name="holderId" defaultValue={t.holderId ?? ""}>
            <option value="">尚未分配</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">票價</span>
          <input className="input" name="price" inputMode="numeric" defaultValue={t.price} required />
        </label>
      </div>
      <div className="grid-3">
        <label className="field"><span className="field-label">區域</span><input className="input" name="section" defaultValue={t.section ?? ""} /></label>
        <label className="field"><span className="field-label">排</span><input className="input" name="rowLabel" defaultValue={t.rowLabel ?? ""} /></label>
        <label className="field"><span className="field-label">座號</span><input className="input" name="seatNumber" defaultValue={t.seatNumber ?? ""} /></label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">票券類型</span>
          <input className="input" name="ticketType" list="tt" defaultValue={t.ticketType} />
          <datalist id="tt"><option value="電子票" /><option value="實體票" /></datalist>
        </label>
        <label className="field">
          <span className="field-label">取票方式</span>
          <input className="input" name="pickupMethod" list="pm" defaultValue={t.pickupMethod ?? ""} />
          <datalist id="pm"><option value="手機電子票" /><option value="超商取票" /><option value="現場取票" /><option value="寄送" /></datalist>
        </label>
      </div>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">分票狀態</span>
          <select className="select" name="transferStatus" defaultValue={t.transferStatus}>
            {Object.entries(TRANSFER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">取票狀態</span>
          <select className="select" name="pickupStatus" defaultValue={t.pickupStatus}>
            {Object.entries(PICKUP_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span className="field-label">票券識別資訊</span>
        <textarea className="textarea" name="secretInfo" defaultValue={t.secretInfo ?? ""} placeholder="取票序號、條碼號碼或電子票連結（只有購票人、持有人與管理者看得到）" />
      </label>
      <label className="field">
        <span className="field-label">備註</span>
        <input className="input" name="note" defaultValue={t.note ?? ""} />
      </label>
      <p className="text-xs text-muted mb-2">分票、取票與付款是各自獨立的狀態，不會互相自動改變。設為「已退票」後，這張票的票價不再列入持有人應付，已付款項會提示退回。</p>
      <SubmitButton block>儲存票券</SubmitButton>
    </ActionForm>
  );
}

export function ArchiveTicket({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={ticketQuickAction} confirm="確定移除這張票？票券與帳目紀錄會保留，但不再列入應付款。">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="op" value="archive" />
      <SubmitButton variant="danger" block>移除這張票</SubmitButton>
    </ActionForm>
  );
}
