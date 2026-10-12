import Link from "next/link";
import { prisma } from "@/lib/db";
import { Badge, Card, Money, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { OUTCOME_LABEL } from "@/lib/labels";
import { fmtPct } from "@/lib/results";
import { fmtDate, taipeiParts } from "@/lib/time";
import { requireActor } from "@/server/session";
import { listTeams } from "@/server/services/games";
import { myGroups } from "@/server/services/groups";
import { listMembers } from "@/server/services/groups";
import { personalStats } from "@/server/services/stats";
import { logoutAction, switchGroupAction } from "@/app/actions";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "個人" };

export default async function MePage({ searchParams }: { searchParams: Promise<{ year?: string; user?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const thisYear = taipeiParts(new Date()).year;
  const year = sp.year === "all" ? undefined : Number(sp.year) || thisYear;
  const members = await listMembers(actor);
  const target = members.find((m) => m.userId === sp.user)?.userId ?? actor.userId;
  const [s, me, targetUser, teams, groups] = await Promise.all([
    personalStats(actor, target, year),
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }),
    prisma.user.findUniqueOrThrow({ where: { id: target }, include: { favoriteTeam: true } }),
    listTeams(),
    myGroups(actor.userId),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const isMe = target === actor.userId;
  const q = (p: Record<string, string>) => `/me?${new URLSearchParams({ ...(sp.year ? { year: sp.year } : {}), ...(sp.user ? { user: sp.user } : {}), ...p })}`;

  return (
    <>
      <PageHeader title={isMe ? "個人" : `${nameOf.get(target)} 的紀錄`} sub={`${actor.displayName}・${actor.role === "ADMIN" ? "管理者" : "成員"}`} />

      <div className="chip-row mb-2">
        {members.map((m) => (
          <Link key={m.userId} className="chip" href={q({ user: m.userId })} aria-current={m.userId === target}>{m.displayName}</Link>
        ))}
      </div>
      <div className="chip-row mb-3">
        {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
          <Link key={y} className="chip" href={q({ year: String(y) })} aria-current={year === y}>{y} 年</Link>
        ))}
        <Link className="chip" href={q({ year: "all" })} aria-current={!year}>歷年累計</Link>
      </div>

      <SectionTitle>到場觀賽戰績{year ? `（${year}）` : "（歷年）"}</SectionTitle>
      <div className="grid-3 mb-2" style={{ gap: 8 }}>
        <Stat label="到場場次" value={s.total.games} />
        <Stat label="勝－敗－和" value={`${s.total.w}-${s.total.l}-${s.total.t}`} />
        <Stat label="觀賽勝率" value={fmtPct(s.total.pct)} />
      </div>
      <div className="grid-3 mb-2" style={{ gap: 8 }}>
        <Stat label="支持隊主場" value={s.home} />
        <Stat label="支持隊客場" value={s.away} />
        <Stat label="單場平均花費" value={s.avgPerGame != null ? <Money v={s.avgPerGame} /> : "—"} />
      </div>
      <p className="text-xs text-muted mb-2">
        只計入標記「已到場」、且比賽正式確認結束的場次，依每場記錄的支持球隊判定勝敗；延期、取消、保留與未開賽不計。勝率 = 勝 ÷（勝＋敗），和局不列入。這是個人到場戰績，與球隊整季戰績（
        <Link href="/games/standings" className="link">球隊正式戰績</Link>）不同。
      </p>

      {targetUser.favoriteTeam ? (
        <p className="text-sm mb-2">最支持：<span className="font-semibold">{targetUser.favoriteTeam.name}</span></p>
      ) : null}
      {s.bySupport.length && (targetUser.trackOtherTeams || s.bySupport.length > 1) ? (
        <Card>
          <div className="font-semibold mb-1">依支持球隊</div>
          {s.bySupport.filter((r) => targetUser.trackOtherTeams || r.name === targetUser.favoriteTeam?.name).map((r) => (
            <div key={r.name} className="kv text-sm"><dt>{r.name}（{r.games} 場）</dt><dd className="tabular-nums">{r.w}勝 {r.l}敗 {r.t}和・{fmtPct(r.pct)}</dd></div>
          ))}
        </Card>
      ) : null}
      <div className="grid-2" style={{ gap: 10 }}>
        <Card>
          <div className="font-semibold mb-1">最常看的球隊</div>
          {s.byTeamSeen.slice(0, 5).map((r) => <div key={r.name} className="kv text-sm"><dt>{r.name}</dt><dd>{r.games} 場</dd></div>)}
          {!s.byTeamSeen.length ? <p className="text-sm text-muted">尚無資料</p> : null}
        </Card>
        <Card>
          <div className="font-semibold mb-1">最常去的球場</div>
          {s.byVenue.slice(0, 5).map((r) => <div key={r.name} className="kv text-sm"><dt>{r.name}</dt><dd>{r.games} 場</dd></div>)}
          {!s.byVenue.length ? <p className="text-sm text-muted">尚無資料</p> : null}
        </Card>
      </div>

      <SectionTitle>花費{year ? `（${year}）` : "（歷年）"}</SectionTitle>
      <div className="grid-2 mb-2" style={{ gap: 10 }}>
        <Stat label="個人負擔" value={<Money v={s.spending.burden} />} sub="分攤後自己應出的錢" />
        <Stat label="購票支出" value={<Money v={s.spending.purchased} />} sub="自己當購票人付出的總額" />
        <Stat label="代墊總額（累計）" value={<Money v={s.spending.advanced} />} sub="購票支出中屬於別人的部分" />
        <Stat label="尚未收回（目前）" value={<Money v={s.spending.uncollected} />} sub={<>已收回 <Money v={s.spending.collected} /></>} />
      </div>
      {s.spending.byMonth.length ? (
        <Card>
          <div className="font-semibold mb-1">每月個人負擔（依購票日期）</div>
          {s.spending.byMonth.map(([m, v]) => <div key={m} className="kv text-sm"><dt>{m}</dt><dd><Money v={v} /></dd></div>)}
        </Card>
      ) : null}
      {s.spending.byVenue.length ? (
        <details className="card disclosure">
          <summary>各球隊、各球場花費</summary>
          <div className="text-sm font-semibold mt-2">球隊（該隊有出賽的比賽）</div>
          {s.spending.byTeam.map((r) => <div key={r.name} className="kv text-sm"><dt>{r.name}</dt><dd><Money v={r.amount} /></dd></div>)}
          <div className="text-sm font-semibold mt-3">球場</div>
          {s.spending.byVenue.map((r) => <div key={r.name} className="kv text-sm"><dt>{r.name}</dt><dd><Money v={r.amount} /></dd></div>)}
        </details>
      ) : null}

      {s.together.size ? (
        <Card>
          <div className="font-semibold mb-1">一起到場</div>
          {[...s.together].map(([uid, n]) => <div key={uid} className="kv text-sm"><dt>{nameOf.get(uid)}</dt><dd>{n} 場</dd></div>)}
        </Card>
      ) : null}

      <SectionTitle>觀賽歷史</SectionTitle>
      <Card className="py-1">
        {s.history.length === 0 ? <p className="text-sm text-muted py-3">還沒有已到場的紀錄。看完比賽後，到比賽頁面把觀賽紀錄設為「已到場」。</p> : null}
        {s.history.map((h) => (
          <Link key={h.gameId} href={`/games/${h.gameId}`} className="list-row text-sm">
            <div className="w-16 shrink-0">{fmtDate(h.startAt).replace(/（.）/, "")}</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{h.label} <span className="scoreline">{h.score}</span></div>
              <div className="text-muted truncate">{h.venue ?? ""}・支持 {h.support ?? "未選"}</div>
            </div>
            <Badge tone={h.outcome === "WIN" ? "good" : h.outcome === "LOSS" ? "bad" : "muted"}>{h.outcome === "NONE" ? "不計" : OUTCOME_LABEL[h.outcome]}</Badge>
          </Link>
        ))}
      </Card>

      {isMe ? (
        <>
          <SectionTitle>個人設定</SectionTitle>
          <Card>
            <ProfileForm
              displayName={me.displayName}
              favoriteTeamId={me.favoriteTeamId}
              followed={me.followedTeamIds}
              trackOtherTeams={me.trackOtherTeams}
              teams={teams.map((t) => ({ id: t.id, name: t.name }))}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>更多</SectionTitle>
      <Card className="py-1">
        {actor.role === "ADMIN" ? <Link className="list-row font-semibold" href="/me/members">成員管理</Link> : <Link className="list-row font-semibold" href="/me/members">成員名單</Link>}
        <Link className="list-row font-semibold" href="/me/data">資料匯出、備份與還原</Link>
        <Link className="list-row font-semibold" href="/me/platforms">售票平台</Link>
        <Link className="list-row font-semibold" href="/games/import">匯入賽程</Link>
        <Link className="list-row font-semibold" href="/me/password">修改密碼</Link>
      </Card>
      {groups.length > 1 ? (
        <Card>
          <div className="font-semibold mb-2">切換群組</div>
          {groups.map((g) => (
            <form key={g.groupId} action={switchGroupAction} className="mb-2">
              <input type="hidden" name="groupId" value={g.groupId} />
              <button className={`btn w-full ${g.groupId === actor.groupId ? "btn-primary" : "btn-secondary"}`}>{g.group.name}</button>
            </form>
          ))}
        </Card>
      ) : null}
      <form action={logoutAction}>
        <button className="btn btn-secondary w-full">登出</button>
      </form>
    </>
  );
}
