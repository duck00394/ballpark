import Link from "next/link";
import { Badge, Status, type Tone } from "./ui";
import { GAME_STATUS_LABEL, ORDER_STATUS_LABEL, PICKUP_STATUS_LABEL, TRANSFER_STATUS_LABEL } from "@/lib/labels";
import { PAY_STATE_LABEL, type PayState } from "@/lib/money";
import { officialResult } from "@/lib/results";
import { fmtDate, hm } from "@/lib/time";

export type GameLike = {
  id: string;
  startAt: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  resultConfirmed: boolean;
  gameType: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeTeam: { name: string; shortName: string };
  awayTeam: { name: string; shortName: string };
  venue: { name: string } | null;
};

// 狀態色彩規範：延期＝藍、取消＝紅、進行中＝橘黃、未開賽＝中性、結束＝綠
export const GAME_TONE: Record<string, Tone> = {
  SCHEDULED: "neutral",
  IN_PROGRESS: "warn",
  FINAL: "good",
  POSTPONED: "info",
  CANCELLED: "bad",
  SUSPENDED: "warn",
  OTHER: "muted",
};

export function gameStatusLabel(g: Pick<GameLike, "status" | "resultConfirmed">) {
  return g.status === "FINAL" && !g.resultConfirmed ? "結束（未確認）" : GAME_STATUS_LABEL[g.status];
}

export function GameStatusBadge({ g }: { g: Pick<GameLike, "status" | "resultConfirmed"> }) {
  return <Badge tone={g.status === "FINAL" && !g.resultConfirmed ? "warn" : GAME_TONE[g.status]}>{gameStatusLabel(g)}</Badge>;
}

export function Score({ g }: { g: GameLike }) {
  if (g.homeScore == null || g.awayScore == null) return <span className="text-faint">vs</span>;
  return (
    <span className="scoreline">
      {g.awayScore} : {g.homeScore}
    </span>
  );
}

/** 賽事卡：客隊在上、主隊在下（依資料來源主客隊），完賽時以文字「勝／和」標示，不只靠顏色 */
export function GameCard({ g, href, mine, groupTickets, children }: { g: GameLike; href?: string; mine?: number; groupTickets?: number; children?: React.ReactNode }) {
  const r = officialResult({ ...g, homeTeamId: g.homeTeamId ?? "", awayTeamId: g.awayTeamId ?? "" });
  const showScore = g.homeScore != null && g.awayScore != null && (g.status === "FINAL" || g.status === "IN_PROGRESS" || g.status === "SUSPENDED");
  const off = g.status === "POSTPONED" || g.status === "CANCELLED";
  const row = (side: "AWAY" | "HOME") => {
    const t = side === "AWAY" ? g.awayTeam : g.homeTeam;
    const s = side === "AWAY" ? g.awayScore : g.homeScore;
    const cls = r ? (r === "TIE" ? "" : r === side ? "win" : "lose") : "";
    return (
      <div className={`team-row ${cls}`}>
        <div className="team-name truncate">
          {t.name}
          <span className="side">{side === "HOME" ? "主" : "客"}</span>
          {r === side ? <span className="wl wl-w">勝</span> : r === "TIE" ? <span className="wl wl-t">和</span> : null}
        </div>
        {showScore ? <div className="team-score">{s}</div> : null}
      </div>
    );
  };
  const body = (
    <>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[13px] text-muted min-w-0 truncate">
          <span className="num font-semibold text-fg">{hm(g.startAt)}</span>
          <span className="mx-1.5 text-faint">·</span>
          {g.venue?.name ?? "未定球場"}
        </div>
        <GameStatusBadge g={g} />
      </div>
      {row("AWAY")}
      {row("HOME")}
      {mine || groupTickets ? (
        <div className="status-line mt-2">
          {mine ? <Status tone="good">我有 {mine} 張票</Status> : null}
          {groupTickets ? <Status tone="neutral">群組已購 {groupTickets} 張</Status> : null}
        </div>
      ) : null}
      {children}
    </>
  );
  const cls = `game-card ${off ? "off" : ""}`;
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** 精簡比賽列（用在清單內） */
export function GameRow({ g, href, right }: { g: GameLike; href?: string; right?: React.ReactNode }) {
  const body = (
    <div className="list-row">
      <div className="w-14 shrink-0">
        <div className="text-sm font-semibold num">{fmtDate(g.startAt).replace(/（.）/, "")}</div>
        <div className="text-xs text-faint num">{hm(g.startAt)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-semibold">
          <span className="truncate">{g.awayTeam.shortName}</span>
          <Score g={g} />
          <span className="truncate">{g.homeTeam.shortName}</span>
        </div>
        <div className="text-xs text-faint mt-0.5 truncate">{g.venue?.name ?? "未定球場"}</div>
      </div>
      {right ?? <GameStatusBadge g={g} />}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function gameTitle(g: Pick<GameLike, "homeTeam" | "awayTeam">) {
  return `${g.awayTeam.shortName} @ ${g.homeTeam.shortName}`;
}

export function gameFullTitle(g: Pick<GameLike, "homeTeam" | "awayTeam">) {
  return `${g.awayTeam.name} vs. ${g.homeTeam.name}`;
}

export const PAY_TONE: Record<string, Tone> = { NONE: "muted", UNPAID: "bad", PARTIAL: "warn", PAID: "good", OVERPAID: "warn", REFUNDED: "muted" };
export const payLabel = (s: PayState | "REFUNDED") => (s === "REFUNDED" ? "已退款" : PAY_STATE_LABEL[s]);
export function PayBadge({ state }: { state: PayState | "REFUNDED" }) {
  return <Badge tone={PAY_TONE[state]}>{payLabel(state)}</Badge>;
}

export const TRANSFER_TONE: Record<string, Tone> = { UNASSIGNED: "muted", ASSIGNED: "warn", DELIVERED: "good", REVOKED: "muted" };
export function TransferBadge({ s }: { s: string }) {
  return <Badge tone={TRANSFER_TONE[s]}>{TRANSFER_STATUS_LABEL[s]}</Badge>;
}

export const PICKUP_TONE: Record<string, Tone> = { NOT_PICKED: "warn", PICKED: "good", FAILED: "bad", REFUNDED: "muted", NOT_APPLICABLE: "muted" };
export function PickupBadge({ s }: { s: string }) {
  return <Badge tone={PICKUP_TONE[s]}>{PICKUP_STATUS_LABEL[s]}</Badge>;
}

const ORDER_TONE: Record<string, Tone> = { PENDING: "info", BUYING: "info", PURCHASED: "neutral", FAILED: "bad", CANCELLED: "muted", REFUNDING: "warn", REFUNDED: "muted" };
export function OrderBadge({ s }: { s: string }) {
  return <Badge tone={ORDER_TONE[s]}>{ORDER_STATUS_LABEL[s]}</Badge>;
}

export function seatText(t: { section: string | null; rowLabel: string | null; seatNumber: string | null }) {
  const head = t.section ?? "";
  const tail = [t.rowLabel ? `${t.rowLabel} 排` : null, t.seatNumber ? `${t.seatNumber} 號` : null].filter(Boolean).join(" ");
  if (!head && !tail) return "座位未填";
  return [head, tail].filter(Boolean).join("・");
}
