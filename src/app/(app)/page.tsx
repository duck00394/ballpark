import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Card, Chevron, Empty, SectionTitle, Status, fmtMoney, type Tone } from "@/components/ui";
import { GameCard, GameRow, GameStatusBadge } from "@/components/game-bits";
import { OUTCOME_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime, hm, startOfTaipeiDay, taipeiParts } from "@/lib/time";
import { requireActor } from "@/server/session";
import { homeData, type Todo, type TodoKind } from "@/server/services/home";
import { personalStats } from "@/server/services/stats";

export const metadata = { title: "首頁" };

const TODO_TONE: Partial<Record<TodoKind, Tone>> = {
  STARTING_SOON: "info",
  GAME_CHANGED: "info",
  PICKUP_DEADLINE: "bad",
  REFUND_NEEDED: "bad",
  UNASSIGNED: "warn",
  UNDELIVERED: "warn",
  CONFIRM_RECEIVE: "warn",
  NOT_PICKED: "warn",
  I_OWE: "bad",
  OWED_TO_ME: "warn",
  CONFIRM_PAYMENT: "info",
  REFUND_PENDING: "info",
  CONFIRM_ATTENDANCE: "neutral",
};
const ORDER: TodoKind[] = ["STARTING_SOON", "GAME_CHANGED", "PICKUP_DEADLINE", "REFUND_NEEDED", "I_OWE", "UNASSIGNED", "UNDELIVERED", "CONFIRM_RECEIVE", "NOT_PICKED", "OWED_TO_ME", "CONFIRM_PAYMENT", "REFUND_PENDING", "CONFIRM_ATTENDANCE"];

function TodoRow({ t }: { t: Todo }) {
  const tone = TODO_TONE[t.kind] ?? "neutral";
  return (
    <Link href={t.href} className="list-row">
      <span className={`status status-${tone} shrink-0`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-snug">{t.title}</div>
        <div className="text-xs text-faint mt-0.5 truncate">
          {t.detail}
          {t.at && t.kind !== "I_OWE" && t.kind !== "OWED_TO_ME" ? `・${fmtDateTime(t.at)}` : ""}
        </div>
      </div>
      {t.amount != null ? <span className={`money-md shrink-0 ${tone === "bad" ? "tone-bad" : ""}`}>{fmtMoney(t.amount)}</span> : null}
      <Chevron />
    </Link>
  );
}

function countdown(start: Date, status: string, now: Date) {
  if (status === "IN_PROGRESS") return "比賽進行中";
  if (status !== "SCHEDULED") return null;
  const ms = start.getTime() - now.getTime();
  if (ms <= 0) return "即將開打";
  const days = Math.round((startOfTaipeiDay(start).getTime() - startOfTaipeiDay(now).getTime()) / 86400_000);
  if (days === 0) return `今天 ${hm(start)} 開打`;
  if (days === 1) return `明天 ${hm(start)} 開打`;
  return `還有 ${days} 天`;
}

export default async function HomePage() {
  const actor = await requireActor();
  const now = new Date();
  const year = taipeiParts(now).year;
  const monthKey = `${year}-${String(taipeiParts(now).month).padStart(2, "0")}`;
  const [d, stats] = await Promise.all([homeData(actor, now), personalStats(actor, actor.userId, year)]);
  const next = d.nextGame;
  const [myCount, groupCount] = next
    ? await Promise.all([
        prisma.ticket.count({ where: { groupId: actor.groupId, gameId: next.id, holderId: actor.userId, archived: false } }),
        prisma.ticket.count({ where: { groupId: actor.groupId, gameId: next.id, archived: false } }),
      ])
    : [0, 0];
  const todos = [...d.todos].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const monthSpend = stats.spending.byMonth.find(([k]) => k === monthKey)?.[1] ?? 0;
  const cd = next ? countdown(next.startAt, next.status, now) : null;
  const upcoming = [...d.todayGames, ...d.weekGames].filter((g) => g.id !== next?.id);

  return (
    <>
      <header className="page-header">
        <div className="min-w-0">
          <div className="brand">
            <span className="brand-dot" aria-hidden />
            看球帳本
          </div>
          <div className="page-sub truncate">
            嗨，{actor.displayName}・{actor.groupName}
          </div>
        </div>
        <Link href="/me" className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center font-bold shrink-0" aria-label="個人頁面">
          {actor.displayName.slice(0, 1)}
        </Link>
      </header>

      {/* 下一場比賽 */}
      {next ? (
        <Link href={`/games/${next.id}`} className="hero block">
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">我的下一場</span>
            {cd ? <span className="text-sm font-semibold tone-good">{cd}</span> : <GameStatusBadge g={next} />}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 mt-4 text-center">
            <div className="min-w-0">
              <div className="text-xl font-bold truncate">{next.awayTeam.shortName}</div>
              <div className="label mt-0.5">客隊</div>
            </div>
            <div className="text-faint font-semibold">vs</div>
            <div className="min-w-0">
              <div className="text-xl font-bold truncate">{next.homeTeam.shortName}</div>
              <div className="label mt-0.5">主隊</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-line text-sm">
            <span className="text-muted min-w-0 truncate">
              <span className="num text-fg font-semibold">{fmtDate(next.startAt)} {hm(next.startAt)}</span>・{next.venue?.name ?? "未定球場"}
            </span>
            <span className="shrink-0 font-semibold">
              <span className="num">{myCount}</span> 張票{groupCount > myCount ? <span className="text-faint font-normal">・群組 {groupCount}</span> : null}
            </span>
          </div>
        </Link>
      ) : (
        <section className="hero">
          <span className="eyebrow">我的下一場</span>
          <p className="text-muted mt-2">目前沒有已分配給你的未來票券。</p>
          <div className="flex gap-2 mt-3">
            <Link href="/orders/new" className="btn btn-primary flex-1">新增購票</Link>
            <Link href="/games" className="btn btn-secondary flex-1">看賽程</Link>
          </div>
        </section>
      )}

      {next ? (
        <div className="grid-2" style={{ gap: 10 }}>
          <Link href="/orders/new" className="btn btn-primary">新增購票</Link>
          <Link href="/games/new" className="btn btn-secondary">新增比賽</Link>
        </div>
      ) : null}

      {/* 近期賽程 */}
      <SectionTitle action={<Link href="/games" className="link text-sm">全部賽程</Link>}>近期賽程</SectionTitle>
      {d.todayGames.length ? (
        d.todayGames.filter((g) => g.id !== next?.id).map((g) => <GameCard key={g.id} g={g} href={`/games/${g.id}`} />)
      ) : null}
      {d.weekGames.filter((g) => g.id !== next?.id).length ? (
        <Card className="card-tight">
          <div className="label pt-2">未來 7 天有買票的比賽</div>
          {d.weekGames.filter((g) => g.id !== next?.id).map((g) => <GameRow key={g.id} g={g} href={`/games/${g.id}`} />)}
        </Card>
      ) : null}
      {upcoming.length === 0 ? (
        <Card>
          <Empty>今天沒有比賽，未來 7 天也沒有其他已購票的比賽</Empty>
        </Card>
      ) : null}

      {/* 待處理 */}
      <SectionTitle count={todos.length || undefined}>待處理事項</SectionTitle>
      <Card className="card-tight">
        {todos.length === 0 ? (
          <Empty>沒有待處理的票券或款項</Empty>
        ) : (
          todos.map((t, i) => <TodoRow key={`${t.kind}-${t.href}-${i}`} t={t} />)
        )}
      </Card>

      {/* 本月支出 */}
      <SectionTitle action={<Link href="/me" className="link text-sm">統計</Link>}>本月觀賽支出</SectionTitle>
      <Card>
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="label">{taipeiParts(now).month} 月個人負擔</div>
            <div className="money-lg mt-0.5">{fmtMoney(monthSpend)}</div>
          </div>
          <div className="text-right text-xs text-faint">
            <div>
              {year} 年累計 <span className="num text-muted">{fmtMoney(stats.spending.burden)}</span>
            </div>
            <div className="mt-0.5">
              尚未收回 <span className={`num ${stats.spending.uncollected ? "tone-warn" : "text-muted"}`}>{fmtMoney(stats.spending.uncollected)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 最近觀賽 */}
      <SectionTitle action={<Link href="/me" className="link text-sm">全部</Link>}>最近的觀賽紀錄</SectionTitle>
      <Card className="card-tight">
        {stats.history.length === 0 ? (
          <Empty>還沒有「已到場」的紀錄。看完比賽後到比賽頁標記到場。</Empty>
        ) : (
          stats.history.slice(0, 3).map((h) => (
            <Link key={h.gameId} href={`/games/${h.gameId}`} className="list-row">
              <div className="w-12 shrink-0 text-sm num text-muted">{fmtDate(h.startAt).replace(/（.）/, "")}</div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {h.label} <span className="scoreline ml-1">{h.score}</span>
                </div>
                <div className="text-xs text-faint truncate">支持 {h.support ?? "未選"}</div>
              </div>
              <Badge tone={h.outcome === "WIN" ? "good" : h.outcome === "LOSS" ? "bad" : "muted"}>{h.outcome === "NONE" ? "不計" : OUTCOME_LABEL[h.outcome]}</Badge>
            </Link>
          ))
        )}
      </Card>

      {/* 最近付款 */}
      <SectionTitle action={<Link href="/settle" className="link text-sm">結算</Link>}>最近的付款與結算</SectionTitle>
      <Card className="card-tight">
        {d.recentPays.length + d.recentSettlements.length === 0 ? (
          <Empty>還沒有付款紀錄</Empty>
        ) : (
          [
            ...d.recentSettlements.map((s) => ({ id: s.id, at: s.createdAt, href: "/settle#history", title: `結算：${d.nameOf.get(s.payerId)} → ${d.nameOf.get(s.payeeId)}`, amount: s.netAmount, off: s.status !== "COMPLETED" })),
            ...d.recentPays.filter((p) => !p.settlementId).map((p) => ({ id: p.id, at: p.paidAt, href: p.orderId ? `/orders/${p.orderId}#history` : "/settle", title: `${d.nameOf.get(p.payerId)} → ${d.nameOf.get(p.payeeId)}`, amount: p.amount, off: p.status === "REVOKED" })),
          ]
            .sort((a, b) => +b.at - +a.at)
            .slice(0, 4)
            .map((x) => (
              <Link key={x.id} href={x.href} className="list-row">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{x.title}</div>
                  <div className="text-xs text-faint num">{fmtDateTime(x.at)}</div>
                </div>
                {x.off ? <Status tone="muted">已撤銷</Status> : null}
                <span className={`money-md ${x.off ? "line-through text-faint" : ""}`}>{fmtMoney(x.amount)}</span>
              </Link>
            ))
        )}
      </Card>
    </>
  );
}
