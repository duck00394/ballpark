import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Card, KV, Money, PageHeader, SectionTitle } from "@/components/ui";
import { PickupBadge, TransferBadge, gameTitle, seatText } from "@/components/game-bits";
import { fmtDate, fmtDateTime, hm } from "@/lib/time";
import { requireActor } from "@/server/session";
import { listMembers } from "@/server/services/groups";
import { canEditOrder, canSeeSecret } from "@/server/services/orders";
import { TicketQuick } from "../../orders/[id]/forms";
import { TicketEditForm, ArchiveTicket } from "./ticket-form";

const ACTION_LABEL: Record<string, string> = {
  ASSIGN: "指定持有人",
  REVOKE: "撤銷分配",
  DELIVER: "完成交付",
  CONFIRM_RECEIVED: "持有人確認收到",
  ARCHIVE: "移除票券",
  "PICKUP:PICKED": "已取票",
  "PICKUP:NOT_PICKED": "改為尚未取票",
  "PICKUP:FAILED": "取票失敗",
  "PICKUP:REFUNDED": "已退票",
  "PICKUP:NOT_APPLICABLE": "取票不適用",
};

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const t = await prisma.ticket.findFirst({
    where: { id, groupId: actor.groupId },
    include: { order: true, game: { include: { homeTeam: true, awayTeam: true, venue: true } }, transfers: { orderBy: { createdAt: "desc" } } },
  });
  if (!t) notFound();
  const members = await listMembers(actor);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const canEdit = canEditOrder(actor, t.order) && !t.archived;
  const secret = canSeeSecret(actor, t, t.order) ? t.secretInfo : null;

  return (
    <>
      <PageHeader title={`第 ${t.seq} 張票`} back={`/orders/${t.orderId}`} sub={`${gameTitle(t.game)}・${fmtDate(t.game.startAt)} ${hm(t.game.startAt)}`} />
      <Card>
        <dl>
          <KV k="持有人" v={t.holderId ? nameOf.get(t.holderId) : "尚未分配"} />
          <KV k="原始購票人" v={nameOf.get(t.order.buyerId)} />
          <KV k="座位" v={seatText(t)} />
          <KV k="票價" v={<Money v={t.price} />} />
          <KV k="票券類型" v={t.ticketType} />
          {t.pickupMethod ? <KV k="取票方式" v={t.pickupMethod} /> : null}
          <KV k="分票狀態" v={<TransferBadge s={t.transferStatus} />} />
          <KV k="取票狀態" v={<PickupBadge s={t.pickupStatus} />} />
          <KV k="持有人確認收到" v={t.receivedConfirmedAt ? fmtDateTime(t.receivedConfirmedAt) : "尚未確認"} />
          <KV k="付款" v={<Link href={`/orders/${t.orderId}#pay`} className="link">到訂單帳目查看</Link>} />
          {t.note ? <KV k="備註" v={t.note} /> : null}
        </dl>
        {secret ? (
          <div className="mt-3">
            <div className="text-sm font-semibold">票券識別資訊（條碼、序號或連結）</div>
            <p className="text-sm whitespace-pre-wrap break-all inset mt-1">{secret}</p>
          </div>
        ) : t.secretInfo ? (
          <p className="text-xs text-muted mt-2">此票有識別資訊，只有購票人、持有人與管理者可見。</p>
        ) : null}
        {t.archived ? <p className="msg msg-error">此票券已移除（帳目紀錄保留）</p> : (
          <TicketQuick ticketId={t.id} isHolder={t.holderId === actor.userId} canEdit={canEdit} received={!!t.receivedConfirmedAt} pickup={t.pickupStatus} holderIsBuyer={t.holderId === t.order.buyerId} />
        )}
      </Card>

      {canEdit ? (
        <>
          <SectionTitle>編輯票券</SectionTitle>
          <Card>
            <TicketEditForm
              t={{ id: t.id, version: t.version, holderId: t.holderId, price: t.price, section: t.section, rowLabel: t.rowLabel, seatNumber: t.seatNumber, ticketType: t.ticketType, pickupMethod: t.pickupMethod, secretInfo: t.secretInfo, note: t.note, transferStatus: t.transferStatus, pickupStatus: t.pickupStatus }}
              members={members.filter((m) => m.active).map((m) => ({ id: m.userId, name: m.displayName }))}
            />
          </Card>
          <ArchiveTicket ticketId={t.id} />
        </>
      ) : null}

      <SectionTitle>分配與交付紀錄</SectionTitle>
      <Card className="py-1">
        {t.transfers.length === 0 ? <p className="text-sm text-muted py-3">尚無紀錄</p> : null}
        {t.transfers.map((x) => (
          <div key={x.id} className="list-row text-sm">
            <div className="flex-1">
              {ACTION_LABEL[x.action] ?? x.action}
              {x.toUserId && x.action === "ASSIGN" ? `：${nameOf.get(x.toUserId)}` : ""}
              {x.fromUserId && x.action === "REVOKE" ? `：${nameOf.get(x.fromUserId)}` : ""}
            </div>
            <div className="text-muted shrink-0">{nameOf.get(x.actorId)}・{fmtDateTime(x.createdAt)}</div>
          </div>
        ))}
      </Card>
    </>
  );
}
