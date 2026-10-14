"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { importCpblAction } from "@/app/actions";

const CPBL_ORIGINS = ["https://www.cpbl.com.tw", "https://cpbl.com.tw"];
const KEEP = [
  "GameSno", "KindCode", "Year", "GameDate", "PreExeDate", "GameDateTimeS", "GameDateTimeE", "GameResult",
  "PresentStatus", "IsPlayBall", "ReserveDate", "VisitingTeamCode", "VisitingTeamName", "HomeTeamCode",
  "HomeTeamName", "FieldAbbe", "VisitingScore", "HomeScore",
];

/**
 * 書籤小工具：在中職官網賽程頁按下後，
 * 1. 立刻開啟本 APP 的接收頁（必須在點擊當下開，才不會被瀏覽器擋彈出視窗）
 * 2. 用官網頁面自己的驗證資訊取得今年例行賽、季後挑戰賽、總冠軍賽
 * 3. 只保留需要的欄位，透過 postMessage 傳給接收頁（只傳給本 APP 的網址）
 */
function buildBookmarklet(app: string) {
  const code = `(async()=>{var APP=${JSON.stringify(app)};if(!/cpbl\\.com\\.tw$/.test(location.hostname)||location.pathname.indexOf('/schedule')!==0){alert('請先打開中職官網的「賽程」頁，再按這個書籤');return}var w=window.open(APP+'/games/import?receive=1','ballpark_import');var data=null,ready=false;function send(){if(data&&ready&&w){w.postMessage({type:'ballpark-cpbl',rows:data},APP)}}window.addEventListener('message',function(e){if(e.origin===APP&&e.data==='ballpark-ready'){ready=true;send()}});try{var s=[].slice.call(document.scripts).map(function(x){return x.textContent}).find(function(x){return x.indexOf('getgamedatas')>=0});var t=s.match(/getgamedatas'[\\s\\S]*?RequestVerificationToken: '([^']+)'/)[1];var y=new Date().getFullYear();var keep=${JSON.stringify(KEEP)};var all=[];for(var k of ['A','E','C']){var r=await fetch('/schedule/getgamedatas',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',RequestVerificationToken:t},body:new URLSearchParams({calendar:y+'/01/01',location:'',kindCode:k,teamNo:''})});var j=await r.json();if(j.Success){JSON.parse(j.GameDatas||'[]').forEach(function(g){var o={};keep.forEach(function(f){o[f]=g[f]});all.push(o)})}}data=all;send()}catch(err){alert('讀取官網賽程失敗：'+err.message)}})()`;
  return "javascript:" + encodeURIComponent(code);
}

/** 可拖到書籤列的按鈕。React 不允許 javascript: 連結，所以在掛載後直接設定 href。 */
export function BookmarkletLink() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("href", buildBookmarklet(window.location.origin));
  }, []);
  return (
    <a
      ref={ref}
      className="btn btn-primary"
      onClick={(e) => {
        e.preventDefault();
        alert("請不要直接點。用滑鼠把這個按鈕拖到瀏覽器上方的書籤列。");
      }}
      draggable
    >
      看球帳本匯入
    </a>
  );
}

/** 接收頁：由官網頁面上的書籤開啟，收到資料後自動匯入 */
export function ReceiveFromCpbl() {
  const [state, setState] = useState<{ status: "waiting" | "importing" | "done" | "error"; message?: string }>({ status: "waiting" });
  useEffect(() => {
    let handled = false;
    const onMessage = async (e: MessageEvent) => {
      if (!CPBL_ORIGINS.includes(e.origin) || handled) return;
      const d = e.data as { type?: string; rows?: unknown[] };
      if (d?.type !== "ballpark-cpbl" || !Array.isArray(d.rows)) return;
      handled = true;
      setState({ status: "importing", message: `收到 ${d.rows.length} 筆，匯入中…` });
      const fd = new FormData();
      fd.set("json", JSON.stringify(d.rows));
      try {
        const r = await importCpblAction({ ok: false }, fd);
        setState(r.ok ? { status: "done", message: r.message } : { status: "error", message: r.error });
      } catch {
        setState({ status: "error", message: "網路連線失敗，請再按一次書籤" });
      }
    };
    window.addEventListener("message", onMessage);
    // 通知官網頁面：接收頁已準備好
    if (window.opener) for (const o of CPBL_ORIGINS) window.opener.postMessage("ballpark-ready", o);
    const timer = setTimeout(() => setState((s) => (s.status === "waiting" ? { status: "error", message: "沒有收到資料。請回到中職官網賽程頁，再按一次「看球帳本匯入」書籤。" } : s)), 30000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
  }, []);

  return (
    <section className="hero">
      <div className="eyebrow">從中職官網匯入</div>
      {state.status === "waiting" ? <p className="mt-2">正在等待官網資料…</p> : null}
      {state.status === "importing" ? <p className="mt-2">{state.message}</p> : null}
      {state.status === "done" ? (
        <>
          <p className="msg msg-ok">{state.message}</p>
          <Link href="/games" className="btn btn-primary w-full mt-3">
            查看賽程
          </Link>
        </>
      ) : null}
      {state.status === "error" ? <p className="msg msg-error">{state.message}</p> : null}
    </section>
  );
}
