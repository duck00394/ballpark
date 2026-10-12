import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-main pt-20 text-center">
      <h1 className="text-lg font-bold">找不到資料</h1>
      <p className="text-muted mt-2">資料可能已被移除，或你沒有權限查看。</p>
      <Link href="/" className="btn btn-primary mt-6">
        回首頁
      </Link>
    </main>
  );
}
