"use client";

import { useState } from "react";

// 在官網賽程頁的瀏覽器主控台執行：用官網自己的驗證資訊取得今年例行賽、季後挑戰賽、總冠軍賽，並複製到剪貼簿
export const CPBL_SNIPPET = `(async()=>{const s=[...document.scripts].map(x=>x.textContent).find(x=>x.includes('getgamedatas'));const t=s.match(/getgamedatas'[\\s\\S]*?RequestVerificationToken: '([^']+)'/)[1];const y=new Date().getFullYear();let a=[];for(const k of ['A','E','C']){const r=await fetch('/schedule/getgamedatas',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',RequestVerificationToken:t},body:new URLSearchParams({calendar:y+'/01/01',location:'',kindCode:k,teamNo:''})});const j=await r.json();if(j.Success)a=a.concat(JSON.parse(j.GameDatas||'[]'))}copy(JSON.stringify(a));console.log('已複製 '+a.length+' 筆賽程，請回到看球帳本貼上')})()`;

export function CopySnippet() {
  const [done, setDone] = useState(false);
  return (
    <div>
      <pre className="code mb-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-all">{CPBL_SNIPPET}</pre>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(CPBL_SNIPPET);
            setDone(true);
          } catch {
            setDone(false);
          }
        }}
      >
        {done ? "已複製程式碼" : "複製程式碼"}
      </button>
    </div>
  );
}
