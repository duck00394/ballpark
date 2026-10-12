import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, back, action, sub }: { title: string; back?: string; action?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="flex items-center gap-2 min-w-0">
        {back ? (
          <Link href={back} className="icon-btn" aria-label="返回">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        ) : null}
        <div className="min-w-0">
          <h1 className={back ? "text-xl font-bold leading-tight truncate" : "page-title"}>{title}</h1>
          {sub ? <div className="page-sub truncate">{sub}</div> : null}
        </div>
      </div>
      {action}
    </header>
  );
}

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`card ${className}`}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, action, count, id }: { children: ReactNode; action?: ReactNode; count?: number | string; id?: string }) {
  return (
    <div className="section-title" id={id}>
      <h2>
        {children}
        {count != null ? <span className="count">{count}</span> : null}
      </h2>
      {action}
    </div>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "muted";

/** 狀態標籤：一律顯示文字，顏色只是輔助 */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** 卡片內的精簡狀態（圓點＋文字），用於同時呈現多種狀態而不塞滿膠囊標籤 */
export function Status({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function fmtMoney(v: number) {
  return `${v < 0 ? "-" : ""}NT$ ${Math.abs(v).toLocaleString("en-US")}`;
}

export function Money({ v, className = "" }: { v: number; className?: string }) {
  return <span className={`num ${className}`}>{fmtMoney(v)}</span>;
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export function LinkButton({ href, children, variant = "secondary", className = "" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  return (
    <Link href={href} className={`btn btn-${variant} ${className}`}>
      {children}
    </Link>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ? `tone-${tone}` : ""}`}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Chevron() {
  return (
    <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
