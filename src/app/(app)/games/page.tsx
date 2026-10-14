import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Card, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { GameCard } from "@/components/game-bits";
import { GAME_STATUS_LABEL } from "@/lib/labels";
import { fmtDate, fmtFull, fromTaipei, taipeiParts, ymd } from "@/lib/time";
import { requireActor } from "@/server/session";
import { listGames, listTeams, listVenues } from "@/server/services/games";
import { listMembers } from "@/server/services/groups";
import { latestSyncLogs } from "@/server/services/schedule";
import { SyncButton } from "./sync-button";
import type { GameStatus } from "@prisma/client";

export const metadata = { title: "賽事" };

type SP = { view?: string; month?: string; team?: string; venue?: string; member?: string; status?: string; mine?: string };

export default async function GamesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const now = taipeiParts(new Date());
  const [y, m] = (sp.month ?? `${now.year}-${String(now.month).padStart(2, "0")}`).split("-").map(Number);
  const view = sp.view === "cal" ? "cal" : "list";
  const from = fromTaipei(`${y}-${String(m).padStart(2, "0")}-01`);
  const nextM = m === 12 ? [y + 1, 1] : [y, m + 1];
  const prevM = m === 1 ? [y - 1, 12] : [y, m - 1];
  const to = fromTaipei(`${nextM[0]}-${String(nextM[1]).padStart(2, "0")}-01`);
  const statuses = Object.keys(GAME_STATUS_LABEL);
  const status = statuses.includes(sp.status ?? "") ? (sp.status as GameStatus) : undefined;

  const [games, teams, venues, members, logs] = await Promise.all([
    listGames(actor, { from, to, teamId: sp.team || undefined, venueId: sp.venue || undefined, memberId: sp.member || undefined, status, onlyWithTickets: sp.mine === "1" }),
    listTeams(),
    listVenues(),
    listMembers(actor),
    latestSyncLogs(6),
  ]);
  const ticketRows = await prisma.ticket.findMany({
    where: { groupId: actor.groupId, archived: false, gameId: { in: games.map((g) => g.id) }, order: { status: { in: ["PURCHASED", "REFUNDING"] } } },
    select: { gameId: true, holderId: true },
  });
  const mineCount = new Map<string, number>();
  const groupCount = new Map<string, number>();
  for (const t of ticketRows) {
    groupCount.set(t.gameId, (groupCount.get(t.gameId) ?? 0) + 1);
    if (t.holderId === actor.userId) mineCount.set(t.gameId, (mineCount.get(t.gameId) ?? 0) + 1);
  }
  const myGameIds = new Set(mineCount.keys());
  const lastOk = logs.find((l) => l.success);
  const lastFail = logs[0] && !logs[0].success ? logs[0] : null;
  const q = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/games?${p}`;
  };
  const monthStr = (a: number[]) => `${a[0]}-${String(a[1]).padStart(2, "0")}`;

  // 依日期分組
  const byDay = new Map<string, typeof games>();
  for (const g of games) (byDay.get(ymd(g.startAt)) ?? byDay.set(ymd(g.startAt), []).get(ymd(g.startAt))!).push(g);

  return (
    <>
      <PageHeader title="賽事" action={<LinkButton href="/games/new" variant="primary" className="btn-sm">新增比賽</LinkButton>} />

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">中職官網賽程</span>
              {lastFail ? <Badge tone="bad">同步失敗</Badge> : lastOk ? <Badge tone="good">已同步</Badge> : <Badge tone="muted">尚未同步</Badge>}
            </div>
            <div className="text-xs text-faint mt-1 num">最後成功：{lastOk?.finishedAt ? fmtFull(lastOk.finishedAt) : "—"}</div>
            {lastFail ? (
              <div className="text-xs mt-1">
                <span className="tone-bad">官網拒絕伺服器連線，無法自動同步。</span>
                <Link href="/games/import" className="link">改用書籤匯入</Link>
              </div>
            ) : null}
          </div>
          <SyncButton />
        </div>
        <div className="flex gap-4 mt-3 text-sm">
          <Link href="/games/import" className="link">匯入賽程</Link>
          <Link href="/games/standings" className="link">球隊正式戰績</Link>
        </div>
      </Card>

      <div className="flex items-center justify-between mb-3">
        <Link href={q({ month: monthStr(prevM) })} className="btn btn-secondary btn-sm" aria-label="上個月">上個月</Link>
        <div className="text-lg font-bold num">{y} 年 {m} 月</div>
        <Link href={q({ month: monthStr(nextM) })} className="btn btn-secondary btn-sm" aria-label="下個月">下個月</Link>
      </div>

      <nav className="segmented" aria-label="檢視模式">
        <Link href={q({ view: "list" })} aria-current={view === "list"}>列表</Link>
        <Link href={q({ view: "cal" })} aria-current={view === "cal"}>月曆</Link>
      </nav>
      <div className="chip-row mb-3">
        <Link className="chip" href={q({ mine: "" })} aria-current={sp.mine !== "1"}>全部比賽</Link>
        <Link className="chip" href={q({ mine: "1" })} aria-current={sp.mine === "1"}>有買票的比賽</Link>
      </div>

      <details className="card disclosure" open={!!(sp.team || sp.venue || sp.member || sp.status)}>
        <summary>篩選{[sp.team, sp.venue, sp.member, sp.status].filter(Boolean).length ? `（${[sp.team, sp.venue, sp.member, sp.status].filter(Boolean).length}）` : ""}</summary>
        <form method="get" action="/games" className="mt-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="month" value={`${y}-${String(m).padStart(2, "0")}`} />
          {sp.mine ? <input type="hidden" name="mine" value={sp.mine} /> : null}
          <div className="grid-2">
            <label className="field">
              <span className="field-label">球隊</span>
              <select className="select" name="team" defaultValue={sp.team ?? ""}>
                <option value="">全部</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">球場</span>
              <select className="select" name="venue" defaultValue={sp.venue ?? ""}>
                <option value="">全部</option>
                {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">成員</span>
              <select className="select" name="member" defaultValue={sp.member ?? ""}>
                <option value="">全部</option>
                {members.map((u) => <option key={u.userId} value={u.userId}>{u.displayName}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">狀態</span>
              <select className="select" name="status" defaultValue={sp.status ?? ""}>
                <option value="">全部</option>
                {statuses.map((s) => <option key={s} value={s}>{GAME_STATUS_LABEL[s]}</option>)}
              </select>
            </label>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1">套用</button>
            <Link href={`/games?view=${view}&month=${y}-${String(m).padStart(2, "0")}`} className="btn btn-secondary">清除</Link>
          </div>
        </form>
      </details>

      {view === "cal" ? (
        <Calendar y={y} m={m} games={games} mine={myGameIds} />
      ) : games.length === 0 ? (
        <Card>
          <Empty action={<LinkButton href="/games/new">手動新增比賽</LinkButton>}>這個月沒有符合條件的比賽</Empty>
        </Card>
      ) : (
        [...byDay].map(([day, list]) => (
          <div key={day}>
            <SectionTitle count={list.length > 1 ? `${list.length} 場` : undefined}>{fmtDate(list[0].startAt)}</SectionTitle>
            {list.map((g) => (
              <GameCard key={g.id} g={g} href={`/games/${g.id}`} mine={mineCount.get(g.id)} groupTickets={(groupCount.get(g.id) ?? 0) > (mineCount.get(g.id) ?? 0) ? groupCount.get(g.id) : undefined} />
            ))}
          </div>
        ))
      )}
    </>
  );
}

function Calendar({ y, m, games, mine }: { y: number; m: number; games: Awaited<ReturnType<typeof listGames>>; mine: Set<string> }) {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startPad = first.getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = ymd(new Date());
  const cells: (number | null)[] = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <div>
      <div className="cal mb-1">
        {"日一二三四五六".split("").map((d) => <div key={d} className="cal-head">{d}</div>)}
      </div>
      <div className="cal">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="cal-day other" aria-hidden />;
          const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const list = games.filter((g) => ymd(g.startAt) === key);
          return (
            <div key={i} className={`cal-day ${key === today ? "today" : ""}`}>
              <span className="cal-num">{d}</span>
              {list.slice(0, 3).map((g) => {
                const off = g.status === "POSTPONED" || g.status === "CANCELLED";
                return (
                  <Link key={g.id} href={`/games/${g.id}`} className={`cal-game ${off ? "off" : mine.has(g.id) ? "mine" : ""}`}>
                    {g.awayTeam.shortName.slice(0, 2)}-{g.homeTeam.shortName.slice(0, 2)}
                    {off ? `（${g.status === "POSTPONED" ? "延" : "取消"}）` : ""}
                  </Link>
                );
              })}
              {list.length > 3 ? <span className="text-muted">+{list.length - 3}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-faint mt-3">綠底 = 我有票；刪除線並標示「延」或「取消」= 延期或取消的比賽。點比賽查看詳情。</p>
    </div>
  );
}
