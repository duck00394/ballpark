"use client";

import { useState } from "react";

function validHttps(u: string | null) {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
}

/**
 * 前往售票平台：
 * - 若平台資料有設定 App 連結（平台官方提供的連結方式），提供「開啟 App」
 * - 一律提供一般 HTTPS 網頁連結；不自動登入、不保存任何售票帳密
 * - 可檢查連結是否仍有效
 */
export function PlatformLink({ webUrl, appUrl }: { webUrl: string | null; appUrl: string | null }) {
  const [check, setCheck] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const web = validHttps(webUrl);
  if (!webUrl && !appUrl) return <p className="text-sm text-muted mt-3">尚未設定購票連結。可在「修改訂單」填入購票連結。</p>;

  async function verify() {
    if (!web) return;
    setBusy(true);
    setCheck(null);
    try {
      const r = await fetch(`/api/check-url?url=${encodeURIComponent(web)}`);
      const j = await r.json();
      setCheck(j.ok ? `連結正常（${j.status}）` : `連結可能已失效：${j.message}`);
    } catch {
      setCheck("無法檢查，請確認網路連線");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {appUrl ? (
          <a href={appUrl} className="btn btn-primary">
            開啟售票 App
          </a>
        ) : null}
        {web ? (
          <a href={web} target="_blank" rel="noopener noreferrer" className={`btn ${appUrl ? "btn-secondary" : "btn-primary"}`}>
            前往售票平台
          </a>
        ) : (
          <span className="msg msg-error">購票網址格式錯誤或不是 https 連結，請修改訂單。</span>
        )}
        {web ? (
          <button type="button" className="btn btn-ghost" onClick={verify} disabled={busy}>
            {busy ? "檢查中…" : "檢查連結"}
          </button>
        ) : null}
      </div>
      {check ? <p className="text-sm mt-2" role="status">{check}</p> : null}
      <p className="text-xs text-muted mt-2">
        {appUrl ? "若手機沒有安裝該 App，請改用網頁。" : "此平台未提供 App 跳轉，會以網頁開啟；若手機已安裝官方 App，系統可能會自動詢問是否以 App 開啟。"}
        本 APP 不會自動登入或保存售票平台帳號密碼。
      </p>
    </div>
  );
}
