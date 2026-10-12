"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { createTeamAction, createVenueAction } from "@/app/actions";

export function TeamVenueForms() {
  return (
    <details className="card disclosure">
      <summary>找不到球隊或球場？</summary>
      <div className="mt-2 space-y-4">
        <ActionForm action={createTeamAction} resetOnSuccess>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">新增球隊名稱</span>
              <input className="input" name="name" required />
            </label>
            <label className="field">
              <span className="field-label">簡稱</span>
              <input className="input" name="shortName" />
            </label>
          </div>
          <label className="field">
            <span className="field-label">聯盟</span>
            <input className="input" name="league" defaultValue="CPBL" />
          </label>
          <SubmitButton variant="secondary" block>新增球隊</SubmitButton>
        </ActionForm>
        <ActionForm action={createVenueAction} resetOnSuccess>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">新增球場名稱</span>
              <input className="input" name="name" required />
            </label>
            <label className="field">
              <span className="field-label">縣市</span>
              <input className="input" name="city" />
            </label>
          </div>
          <SubmitButton variant="secondary" block>新增球場</SubmitButton>
        </ActionForm>
        <p className="text-xs text-muted">新增後即可在上方選單選取。</p>
      </div>
    </details>
  );
}
