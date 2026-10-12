"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/app/actions/result";

type Action<S extends ActionResult> = (prev: S, fd: FormData) => Promise<S>;

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

/**
 * 表單共用元件：
 * - 送出中自動停用按鈕，避免雙擊重複建立
 * - 每次開啟表單產生一次性 clientRequestId，伺服器端以此擋下重複請求
 * - 網路失敗時明確提示「尚未儲存」
 * - 可選擇送出前再次確認
 *
 * 注意：(app) 底下不要放 loading.tsx。實測 Next.js 15.5 中，路由群組層級的 loading 邊界
 * 會讓 Server Action 之後的換頁或重新整理偶爾無法套用，按鈕停在「處理中」。
 */
export function ActionForm<S extends ActionResult>({
  action,
  children,
  confirm,
  className,
  resetOnSuccess,
  onDone,
  showSuccess = true,
}: {
  action: Action<S>;
  children: ReactNode;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  onDone?: (s: S) => void;
  showSuccess?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [requestId, setRequestId] = useState(newId);
  const safe: Action<S> = async (prev, fd) => {
    try {
      return await action(prev, fd);
    } catch {
      return { ok: false, error: "網路連線失敗，資料尚未儲存。請確認網路後再試一次。", at: Date.now() } as S;
    }
  };
  const [state, formAction] = useActionState<S, FormData>(safe, { ok: false } as Awaited<S>);

  useEffect(() => {
    if (!state.at) return;
    if (state.ok) {
      setRequestId(newId());
      if (resetOnSuccess) formRef.current?.reset();
      onDone?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.at]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="clientRequestId" value={requestId} />
      {children}
      {state.at && state.error ? (
        <p role="alert" className="msg msg-error">
          {state.error}
        </p>
      ) : null}
      {state.at && state.ok && showSuccess && state.message && !state.redirectTo ? (
        <p role="status" className="msg msg-ok">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  pendingText = "處理中…",
  className = "",
  name,
  value,
  block,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  block?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={`btn btn-${variant} ${block ? "w-full" : ""} ${className}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
