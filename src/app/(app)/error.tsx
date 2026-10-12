"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="pt-16 text-center">
      <h1 className="text-lg font-bold">{offline ? "目前沒有網路連線" : "頁面載入失敗"}</h1>
      <p className="text-muted mt-2">{offline ? "連上網路後再重新整理，資料不會遺失。" : "可能是暫時的連線問題，請再試一次。"}</p>
      {error.digest ? <p className="text-xs text-muted mt-2">錯誤代碼：{error.digest}</p> : null}
      <button className="btn btn-primary mt-6" onClick={reset}>
        重新載入
      </button>
    </div>
  );
}
