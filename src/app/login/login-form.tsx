"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { loginAction } from "@/app/actions";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="card">
      <label className="field">
        <span className="field-label">帳號</span>
        <input className="input" name="username" autoComplete="username" autoCapitalize="none" required />
      </label>
      <label className="field">
        <span className="field-label">密碼</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <SubmitButton block pendingText="登入中…">登入</SubmitButton>
    </ActionForm>
  );
}
