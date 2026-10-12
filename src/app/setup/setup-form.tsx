"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { setupAction } from "@/app/actions";

export function SetupForm() {
  return (
    <ActionForm action={setupAction} className="card">
      <label className="field">
        <span className="field-label">群組名稱</span>
        <input className="input" name="groupName" placeholder="例如：週末看球團" required />
      </label>
      <label className="field">
        <span className="field-label">你的顯示名稱</span>
        <input className="input" name="displayName" required />
      </label>
      <label className="field">
        <span className="field-label">帳號</span>
        <input className="input" name="username" autoCapitalize="none" autoComplete="username" required />
        <span className="field-hint">英文、數字、底線、點或減號，3～32 字</span>
      </label>
      <label className="field">
        <span className="field-label">密碼</span>
        <input className="input" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      <label className="field">
        <span className="field-label">再輸入一次密碼</span>
        <input className="input" name="password2" type="password" autoComplete="new-password" minLength={8} required />
      </label>
      <SubmitButton block>建立並登入</SubmitButton>
    </ActionForm>
  );
}
