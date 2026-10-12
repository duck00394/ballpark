"use client";

import { useId, useState, type ReactNode } from "react";

/** 操作列＋「展開／收合」按鈕；詳細內容預設收合（伺服器端已產生，只切換顯示） */
export function ExpandRow({ actions, children, label, className = "ticket-actions" }: { actions?: ReactNode; children: ReactNode; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className={className}>
        {actions}
        <button type="button" className="btn btn-ghost btn-sm ml-auto" aria-expanded={open} aria-controls={id} aria-label={`${open ? "收合" : "展開"}${label}`} onClick={() => setOpen(!open)}>
          {open ? "收合" : "展開"}
        </button>
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </>
  );
}

/** 「查看全部」：預設只顯示前幾筆 */
export function ShowMore({ children, rest, count }: { children: ReactNode; rest: ReactNode; count: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children}
      {count > 0 ? (
        <>
          <div hidden={!open}>{rest}</div>
          <button type="button" className="btn btn-ghost btn-sm w-full mt-1" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "收合" : `查看全部（另外 ${count} 筆）`}
          </button>
        </>
      ) : null}
    </>
  );
}
