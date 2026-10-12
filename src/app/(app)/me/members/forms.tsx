"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { addMemberAction, memberAdminAction } from "@/app/actions";

export function AddMemberForm() {
  return (
    <ActionForm action={addMemberAction} resetOnSuccess>
      <div className="grid-2">
        <label className="field"><span className="field-label">顯示名稱</span><input className="input" name="displayName" required /></label>
        <label className="field"><span className="field-label">帳號</span><input className="input" name="username" autoCapitalize="none" required /></label>
      </div>
      <label className="field">
        <span className="field-label">初始密碼（至少 8 字）</span>
        <input className="input" name="password" type="text" autoComplete="off" minLength={8} />
        <span className="field-hint">若帳號已存在（例如在別的群組），可不填密碼，直接加入本群組。對方登入後可自行修改密碼。</span>
      </label>
      <label className="field">
        <span className="field-label">權限</span>
        <select className="select" name="role" defaultValue="MEMBER">
          <option value="MEMBER">成員</option>
          <option value="ADMIN">管理者</option>
        </select>
      </label>
      <SubmitButton block>新增成員</SubmitButton>
    </ActionForm>
  );
}

export function MemberOps({ userId, role, active }: { userId: string; role: string; active: boolean }) {
  const [reset, setReset] = useState(false);
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      <ActionForm action={memberAdminAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="op" value="role" />
        <input type="hidden" name="role" value={role === "ADMIN" ? "MEMBER" : "ADMIN"} />
        <SubmitButton variant="secondary" className="btn-sm">{role === "ADMIN" ? "改為成員" : "設為管理者"}</SubmitButton>
      </ActionForm>
      {active ? (
        <ActionForm action={memberAdminAction} confirm="確定停用此成員？對方將無法登入此群組，但所有歷史帳目都會保留。">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="op" value="deactivate" />
          <SubmitButton variant="danger" className="btn-sm">停用</SubmitButton>
        </ActionForm>
      ) : null}
      {reset ? (
        <ActionForm action={memberAdminAction} className="w-full">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="op" value="reset" />
          <input className="input mb-2" name="password" placeholder="新密碼（至少 8 字）" minLength={8} required autoComplete="off" />
          <SubmitButton className="btn-sm">重設密碼</SubmitButton>
        </ActionForm>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReset(true)}>重設密碼</button>
      )}
    </div>
  );
}
