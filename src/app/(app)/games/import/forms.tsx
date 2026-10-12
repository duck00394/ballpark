"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { importCpblAction, importCsvAction } from "@/app/actions";

export function ImportForms({ part }: { isAdmin: boolean; part: "csv" | "json" }) {
  if (part === "csv")
    return (
      <ActionForm action={importCsvAction}>
        <label className="field">
          <span className="field-label">選擇 CSV 檔</span>
          <input className="input" type="file" name="file" accept=".csv,text/csv" />
        </label>
        <label className="field">
          <span className="field-label">或直接貼上 CSV 內容</span>
          <textarea className="textarea" name="csv" />
        </label>
        <SubmitButton block>匯入</SubmitButton>
      </ActionForm>
    );
  return (
    <ActionForm action={importCpblAction}>
      <label className="field">
        <span className="field-label">官網回應 JSON</span>
        <textarea className="textarea" name="json" required placeholder='{"Success":true,"GameDatas":"[...]"}' />
      </label>
      <SubmitButton block>匯入官網賽程</SubmitButton>
    </ActionForm>
  );
}
