"use client";

import { useActionState } from "react";
import { analyzeBackupAction, restoreBackupAction, type RestoreState } from "@/app/actions";
import { SubmitButton } from "@/components/action-form";

export function RestoreFlow() {
  const [a, analyze] = useActionState<RestoreState, FormData>(async (p, fd) => {
    try {
      return await analyzeBackupAction(p, fd);
    } catch {
      return { ok: false, error: "網路連線失敗，請再試一次" };
    }
  }, { ok: false });
  const [r, restore] = useActionState<RestoreState, FormData>(async (p, fd) => {
    try {
      return await restoreBackupAction(p, fd);
    } catch {
      return { ok: false, error: "網路連線失敗，資料未變更" };
    }
  }, { ok: false });

  if (r.ok) return <p className="msg msg-ok">{r.message}</p>;

  return (
    <>
      <p className="text-sm mb-3">
        還原會用備份檔「取代」本群組目前的訂單、票券、付款、退款、結算與觀賽紀錄（官方賽程不受影響）。系統會先驗證格式、關聯與重複資料，並在還原前自動保存目前資料的快照。
      </p>
      <form action={analyze}>
        <label className="field">
          <span className="field-label">選擇備份檔（.json）</span>
          <input className="input" type="file" name="file" accept="application/json,.json" required />
        </label>
        <SubmitButton variant="secondary" block pendingText="檢查中…">
          檢查備份檔
        </SubmitButton>
      </form>
      {a.error ? <p className="msg msg-error">{a.error}</p> : null}
      {a.plan ? (
        <div className="mt-4">
          <div className="font-semibold">檢查結果：{a.plan.ok ? "可以還原" : "無法還原"}</div>
          {a.plan.exportedAt ? <p className="text-sm text-muted">備份時間：{new Date(a.plan.exportedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}・來源群組：{a.plan.backupGroupName}</p> : null}
          {a.plan.errors.length ? (
            <ul className="msg msg-error list-disc pl-6">{a.plan.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          ) : null}
          {a.plan.warnings.length ? (
            <ul className="msg msg-warn list-disc pl-6">{a.plan.warnings.map((e) => <li key={e}>{e}</li>)}</ul>
          ) : null}
          {Object.keys(a.plan.counts).length ? (
            <table className="w-full text-sm mt-2 tabular-nums">
              <thead><tr className="text-muted text-left"><th className="py-1">項目</th><th>目前</th><th>備份檔</th></tr></thead>
              <tbody>
                {Object.entries(a.plan.counts).map(([k, v]) => (
                  <tr key={k} className="border-t border-line"><td className="py-1">{k}</td><td>{a.plan!.current[k]}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {a.plan.ok ? (
            <form action={restore} className="mt-3">
              <input type="hidden" name="json" value={a.json} />
              <label className="field">
                <span className="field-label">請輸入「確認還原」四個字</span>
                <input className="input" name="confirm" autoComplete="off" required />
              </label>
              <SubmitButton variant="danger" block pendingText="還原中…">取代目前資料並還原</SubmitButton>
              {r.error ? <p className="msg msg-error">{r.error}</p> : null}
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
