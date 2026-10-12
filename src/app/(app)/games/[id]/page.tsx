import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { Badge, Card, Chevron, Empty, LinkButton, Money, PageHeader, SectionTitle } from "@/components/ui";
import { GameStatusBadge, OrderBadge, gameTitle } from "@/components/game-bits";
import { ATTENDANCE_LABEL, GAME_STATUS_LABEL, OUTCOME_LABEL } from "@/lib/labels";
import { officialResult, outcomeForTeam, resultText } from "@/lib/results";
import { fmtDate, fmtDateTime, hm, ymd } from "@/lib/time";
import { requireActor } from "@/server/session";
import { getVisibleGame, listTeams, listVenues } from "@/server/services/games";
import { listMembers } from "@/server/services/groups";
import { listOrdersForGame } from "@/server/services/orders";
import { AttendanceForm, GameForm, ResultForm } from "../forms";

const FIELD_LABEL: Record<string, string> = { startAt: "時間", venueId: "球場", status: "狀態", homeScore: "主隊得分", awayScore: "客隊得分", homeTeamId: "主隊", awayTeamId: "客隊" };

export default async function GameDetail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  let g;
  try {
    g = await getVisibleGame(actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const [orders, members, atts, changes, teams, venues] = await Promise.all([
    listOrdersForGame(actor, id),
    listMembers(actor),
    prisma.gameAttendance.findMany({ where: { groupId: actor.groupId, gameId: id }, include: { supportTeam: true } }),
    prisma.gameChange.findMany({ where: { gameId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    listTeams(),
    listVenues(),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const venueName = new Map(venues.map((v) => [v.id, v.name]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const mine = atts.find((a) => a.userId === actor.userId);
  const official = g.groupId === null;
  const canEditResult = !official || actor.role === "ADMIN";
  const fmtChange = (field: string, v: string | null) => {
    if (v == null) return "（空）";
    if (field === "startAt") return fmtDateTime(new Date(v));
    if (field === "venueId") return venueName.get(v) ?? v;
    if (field === "status") return GAME_STATUS_LABEL[v] ?? v;
    if (field.endsWith("TeamId")) return teamName.get(v) ?? v;
    return v;
  };
  const off = g.status === "POSTPONED" || g.status === "CANCELLED";
  const winner = officialResult(g);

  return (
    <>
      <PageHeader title={gameTitle(g)} back="/games" sub={`${fmtDate(g.startAt)} ${hm(g.startAt)}`} />

      <section className="hero">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">{g.gameType}{g.gameNumber ? `・第 ${g.gameNumber} 場` : ""}</span>
          <GameStatusBadge g={g} />
        </div>
        {off ? <p className="msg msg-error">此場比賽{GAME_STATUS_LABEL[g.status]}，請留意改期資訊與票券處理。</p> : null}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 my-5 text-center">
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight">{g.awayTeam.shortName}</div>
            {g.awayTeam.shortName !== g.awayTeam.name ? <div className="text-xs text-muted truncate">{g.awayTeam.name}</div> : null}
            <div className="label mt-1">客隊{winner === "AWAY" ? "・勝" : winner === "TIE" ? "・和" : ""}</div>
          </div>
          <div className="money-xl whitespace-nowrap">
            {g.awayScore ?? "–"}<span className="text-faint mx-2">:</span>{g.homeScore ?? "–"}
          </div>
          <div className="min-w-0">
            <div className="text-xl font-bold leading-tight">{g.homeTeam.shortName}</div>
            {g.homeTeam.shortName !== g.homeTeam.name ? <div className="text-xs text-muted truncate">{g.homeTeam.name}</div> : null}
            <div className="label mt-1">主隊{winner === "HOME" ? "・勝" : winner === "TIE" ? "・和" : ""}</div>
          </div>
        </div>
        {g.resultConfirmed ? (
          <p className="text-center text-sm font-semibold tone-good">{resultText({ ...g, homeTeamName: g.homeTeam.name, awayTeamName: g.awayTeam.name })}・已正式確認</p>
        ) : g.status === "FINAL" ? (
          <p className="text-center text-sm tone-warn">比分尚未正式確認，暫不計入勝敗</p>
        ) : null}
        <dl className="meta-grid mt-4 pt-4 border-t border-line">
          <div><dt>開賽時間</dt><dd className="num">{fmtDate(g.startAt)} {hm(g.startAt)}</dd></div>
          <div><dt>球場</dt><dd>{g.venue?.name ?? "未定"}</dd></div>
          {g.name ? <div><dt>賽事名稱</dt><dd>{g.name}</dd></div> : null}
          {g.reserveDate ? <div><dt>預定續賽</dt><dd className="num">{fmtDateTime(g.reserveDate)}</dd></div> : null}
          <div><dt>資料來源</dt><dd>{official ? "中職官網" : "群組手動建立"}</dd></div>
          {official && g.lastSyncedAt ? <div><dt>最後同步</dt><dd className="num">{fmtDateTime(g.lastSyncedAt)}</dd></div> : null}
        </dl>
        {g.manualLock ? <p className="text-xs tone-warn mt-3">比分已手動鎖定，同步不會覆蓋</p> : null}
        {g.note ? <p className="text-sm text-muted mt-3">{g.note}</p> : null}
      </section>

      <div className="grid-2 mb-2" style={{ gap: 10 }}>
        <LinkButton href={`/orders/new?gameId=${g.id}`} variant="primary">為這場新增購票</LinkButton>
        <LinkButton href={`#attendance`}>記錄觀賽</LinkButton>
      </div>

      <SectionTitle count={orders.length ? `${orders.length} 筆` : undefined}>購票訂單</SectionTitle>
      <Card className="card-tight">
        {orders.length === 0 ? (
          <Empty>這場還沒有購票紀錄</Empty>
        ) : (
          orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`} className="list-row">
              <div className="flex-1 min-w-0">
                <div className="font-semibold">
                  {nameOf.get(o.buyerId)} 購買 {o.tickets.length} 張
                </div>
                <div className="text-xs text-faint truncate">
                  {o.platform?.name ?? "未填平台"}
                  {o.orderNumber ? `・#${o.orderNumber}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <Money v={o.tickets.reduce((a, t) => a + t.price, 0) + o.feeAmount + o.otherFeeAmount} className="money-md block" />
                <OrderBadge s={o.status} />
              </div>
              <Chevron />
            </Link>
          ))
        )}
      </Card>

      <SectionTitle>觀賽紀錄</SectionTitle>
      <Card id="attendance">
        <AttendanceForm
          gameId={g.id}
          userId={actor.userId}
          status={mine?.status ?? null}
          supportTeamId={mine?.supportTeamId ?? null}
          teams={[
            { id: g.awayTeam.id, name: g.awayTeam.name },
            { id: g.homeTeam.id, name: g.homeTeam.name },
          ]}
        />
        <div className="mt-4">
          {atts.length === 0 ? (
            <p className="text-sm text-muted">還沒有人記錄這場觀賽</p>
          ) : (
            atts.map((a) => {
              const o = a.status === "ATTENDED" ? outcomeForTeam(g, a.supportTeamId) : "NONE";
              return (
                <div key={a.id} className="list-row">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{nameOf.get(a.userId)}</div>
                    <div className="text-sm text-muted">支持：{a.supportTeam?.name ?? "不選邊"}</div>
                  </div>
                  <Badge tone={a.status === "ATTENDED" ? "good" : a.status === "ABSENT" ? "muted" : "info"}>{ATTENDANCE_LABEL[a.status]}</Badge>
                  <Badge tone={o === "WIN" ? "good" : o === "LOSS" ? "bad" : "muted"}>{o === "NONE" ? "不計勝敗" : OUTCOME_LABEL[o]}</Badge>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {canEditResult ? (
        <details className="card disclosure">
          <summary>{official ? "手動修正比分與狀態（管理者）" : "更新比分與狀態"}</summary>
          <div className="mt-2">
            <ResultForm
              gameId={g.id}
              version={g.version}
              status={g.status}
              homeScore={g.homeScore}
              awayScore={g.awayScore}
              resultConfirmed={g.resultConfirmed}
              homeName={g.homeTeam.shortName}
              awayName={g.awayTeam.shortName}
              official={official}
              manualLock={g.manualLock}
            />
          </div>
        </details>
      ) : null}

      {!official ? (
        <details className="card disclosure">
          <summary>修改比賽資料</summary>
          <div className="mt-2">
            <GameForm
              teams={teams}
              venues={venues}
              gameId={g.id}
              version={g.version}
              initial={{ date: ymd(g.startAt), time: hm(g.startAt), homeTeamId: g.homeTeamId, awayTeamId: g.awayTeamId, venueId: g.venueId, gameType: g.gameType, league: g.league, name: g.name, note: g.note }}
            />
          </div>
        </details>
      ) : null}

      {changes.length ? (
        <>
          <SectionTitle>異動紀錄</SectionTitle>
          <Card className="card-tight">
            {changes.map((c) => (
              <div key={c.id} className="list-row text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-semibold">{FIELD_LABEL[c.field] ?? c.field}</span>：{fmtChange(c.field, c.oldValue)} → {fmtChange(c.field, c.newValue)}
                </div>
                <span className="text-muted shrink-0">
                  {c.source === "SYNC" ? "同步" : nameOf.get(c.actorId ?? "") ?? "手動"}・{fmtDateTime(c.createdAt)}
                </span>
              </div>
            ))}
          </Card>
        </>
      ) : null}
    </>
  );
}
