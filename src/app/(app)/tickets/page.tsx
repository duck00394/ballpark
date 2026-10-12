import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, Empty, LinkButton, PageHeader, SectionTitle } from "@/components/ui";
import { gameTitle } from "@/components/game-bits";
import { TicketCard } from "@/components/ticket-card";
import { fmtDate, hm } from "@/lib/time";
import { requireActor } from "@/server/session";
import { computeLedger } from "@/server/services/finance";
import { listMembers } from "@/server/services/groups";
import { canEditOrder, listTickets } from "@/server/services/orders";

export const metadata = { title: "票券" };

const FILTERS = [
  ["all", "全部票券"],
  ["held", "我持有"],
  ["bought", "我購買"],
  ["notpicked", "尚未取票"],
  ["unassigned", "尚未分配"],
  ["unpaid", "尚未付款"],
] as const;
type F = (typeof FILTERS)[number][0];

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ f?: string; past?: string; scope?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const f: F = (FILTERS.map((x) => x[0]) as string[]).includes(sp.f ?? "") ? (sp.f as F) : sp.scope === "all" ? "all" : "held";
  const upcomingOnly = sp.past !== "1";
  const [all, members, ledger] = await Promise.all([
    listTickets(actor, { scope: "all", upcomingOnly }),
    listMembers(actor),
    computeLedger(prisma, actor.groupId),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const stateOf = new Map(ledger.map((r) => [`${r.orderId}|${r.debtorId}`, r.state]));
  const active = (t: (typeof all)[number]) => t.order.status === "PURCHASED" || t.order.status === "REFUNDING";
  const unpaid = (t: (typeof all)[number]) => {
    if (!t.holderId || t.holderId === t.order.buyerId) return false;
    const s = stateOf.get(`${t.orderId}|${t.holderId}`);
    return s === "UNPAID" || s === "PARTIAL";
  };
  const match: Record<F, (t: (typeof all)[number]) => boolean> = {
    all: () => true,
    held: (t) => t.holderId === actor.userId,
    bought: (t) => t.order.buyerId === actor.userId,
    notpicked: (t) => active(t) && (t.pickupStatus === "NOT_PICKED" || t.pickupStatus === "FAILED"),
    unassigned: (t) => active(t) && !t.holderId,
    unpaid,
  };
  const tickets = all.filter(match[f]);
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter(match[k]).length]));
  const q = (p: Record<string, string>) => `/tickets?${new URLSearchParams(Object.entries({ f, ...(sp.past ? { past: sp.past } : {}), ...p }).filter(([, v]) => v) as [string, string][])}`;
  const byGame = new Map<string, typeof tickets>();
  for (const t of tickets) (byGame.get(t.gameId) ?? byGame.set(t.gameId, []).get(t.gameId)!).push(t);

  return (
    <>
      <PageHeader title="票券" action={<LinkButton href="/orders/new" variant="primary" className="btn-sm">新增購票</LinkButton>} />
      <div className="chip-row mb-2" role="tablist" aria-label="票券篩選">
        {FILTERS.map(([k, label]) => (
          <Link key={k} className="chip" href={q({ f: k })} aria-current={f === k}>
            {label}
            <span className="n">{counts[k]}</span>
          </Link>
        ))}
      </div>
      <div className="flex items-center justify-between mb-1 text-sm">
        <span className="text-faint">{upcomingOnly ? "只顯示未結束的比賽" : "包含已結束的比賽"}</span>
        <Link href={q({ past: upcomingOnly ? "1" : "" })} className="link">
          {upcomingOnly ? "顯示已結束" : "只看未結束"}
        </Link>
      </div>
      {tickets.length === 0 ? (
        <Card>
          <Empty action={<LinkButton href="/orders/new">新增購票</LinkButton>}>沒有符合條件的票券</Empty>
        </Card>
      ) : (
        [...byGame].map(([gid, list]) => (
          <div key={gid}>
            <SectionTitle count={`${list.length} 張`}>
              <Link href={`/games/${gid}`}>
                <span className="num">{fmtDate(list[0].game.startAt)} {hm(list[0].game.startAt)}</span>　{gameTitle(list[0].game)}
              </Link>
            </SectionTitle>
            {list.map((t) => (
              <TicketCard
                key={t.id}
                t={t}
                nameOf={nameOf}
                buyerId={t.order.buyerId}
                viewerId={actor.userId}
                canEdit={canEditOrder(actor, t.order)}
                orderActive={active(t)}
                payState={t.holderId ? stateOf.get(`${t.orderId}|${t.holderId}`) : undefined}
                gameLine={`${nameOf.get(t.order.buyerId)} 購買・${t.game.venue?.name ?? "未定球場"}`}
              />
            ))}
          </div>
        ))
      )}
    </>
  );
}
