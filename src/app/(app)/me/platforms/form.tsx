"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { createPlatformAction } from "@/app/actions";

export function PlatformForm() {
  return (
    <ActionForm action={createPlatformAction} resetOnSuccess>
      <label className="field"><span className="field-label">名稱</span><input className="input" name="name" required /></label>
      <label className="field"><span className="field-label">網站網址</span><input className="input" name="webUrl" type="url" placeholder="https://" /></label>
      <label className="field">
        <span className="field-label">App 連結（選填）</span>
        <input className="input" name="appUrl" placeholder="平台官方公布的 App 連結" />
        <span className="field-hint">只有平台官方提供 App 連結時才填；不填則以網頁開啟。不要填寫任何帳號密碼。</span>
      </label>
      <SubmitButton block>新增平台</SubmitButton>
    </ActionForm>
  );
}
