import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { fmtDate, fmtFull, hm } from "@/lib/time";
import { requireActor } from "@/server/session";
import { computeLedger } from "@/server/services/finance";
import { listMembers } from "@/server/services/groups";
import { canEditOrder, walletTickets } from "@/server/services/orders";
import { WalletCarousel, type WalletCard } from "./wallet";

export const metadata = { title: "我的票券" };

export default async function WalletGamePage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ tab?: string; t?: string }> }) {
  const actor = await requireActor();
  const { gameId } = await params;
  const sp = await searchParams;
  const tickets = await walletTickets(actor, { gameId });
  if (!tickets.length) notFound();
  const g = tickets[0].game;
  const [members, ledger] = await Promise.all([
    listMembers(actor),
    computeLedger(prisma, actor.groupId, { userId: actor.userId }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const paidOf = new Map(ledger.map((r) => [`${r.orderId}|${r.debtorId}`, r.paid + r.settled - r.refunded]));
  const isDone = (s: string) => s === "PICKED" || s === "NOT_APPLICABLE";

  const cards: WalletCard[] = tickets.map((t) => {
    const holderIsBuyer = !t.holderId || t.holderId === t.order.buyerId;
    const url = t.order.purchaseUrl ?? t.order.platform?.webUrl ?? null;
    const secret = t.secretInfo?.trim() || null;
    return {
      id: t.id,
      seq: t.seq,
      picked: isDone(t.pickupStatus),
      pickupFailed: t.pickupStatus === "FAILED",
      orderNumber: t.order.orderNumber,
      seat: [t.section, t.rowLabel ? `${t.rowLabel}排` : null, t.seatNumber ? `${t.seatNumber}號` : null].filter(Boolean).join("-") || "座位未填",
      price: t.price,
      ticketType: [t.ticketType, t.order.ticketCategory].filter(Boolean).join("・"),
      from: holderIsBuyer ? "自己購買" : `${nameOf.get(t.order.buyerId)} 購買並轉贈`,
      unassigned: !t.holderId,
      secretUrl: secret && /^https:\/\//i.test(secret) ? secret : null,
      secretText: secret && !/^https:\/\//i.test(secret) ? secret : null,
      platformUrl: url && /^https:\/\//i.test(url) ? url : null,
      platformName: t.order.platform?.name ?? null,
      pickupDeadline: t.order.pickupDeadline ? fmtFull(t.order.pickupDeadline) : null,
      canTransfer: t.holderId === actor.userId || canEditOrder(actor, t.order),
      paidByMe: t.holderId === actor.userId && !holderIsBuyer ? (paidOf.get(`${t.orderId}|${actor.userId}`) ?? 0) : 0,
      orderId: t.orderId,
    };
  });
  const startTab = sp.tab === "done";
  const start = Math.max(
    0,
    sp.t ? cards.findIndex((c) => c.id === sp.t) : cards.findIndex((c) => c.picked === startTab),
  );

  return (
    <>
      <PageHeader title="我的票券" back={`/tickets${sp.tab ? `?tab=${sp.tab}` : ""}`} sub={`${fmtDate(g.startAt)} ${hm(g.startAt)}`} />
      <WalletCarousel
        cards={cards}
        start={start}
        title={`${g.awayTeam.name} vs ${g.homeTeam.name}`}
        when={`${fmtDate(g.startAt)} ${hm(g.startAt)}`}
        venue={g.venue?.name ?? "未定球場"}
        members={members.filter((m) => m.active && m.userId !== actor.userId).map((m) => ({ id: m.userId, name: m.displayName }))}
      />
    </>
  );
}
