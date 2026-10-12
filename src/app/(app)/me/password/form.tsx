"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { changePasswordAction } from "@/app/actions";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction}>
      <label className="field"><span className="field-label">目前密碼</span><input className="input" type="password" name="current" autoComplete="current-password" required /></label>
      <label className="field"><span className="field-label">新密碼（至少 8 字）</span><input className="input" type="password" name="next" autoComplete="new-password" minLength={8} required /></label>
      <label className="field"><span className="field-label">再輸入一次新密碼</span><input className="input" type="password" name="next2" autoComplete="new-password" minLength={8} required /></label>
      <p className="text-xs text-muted mb-2">修改後所有裝置都會登出，請用新密碼重新登入。</p>
      <SubmitButton block>修改密碼</SubmitButton>
    </ActionForm>
  );
}
