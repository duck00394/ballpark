import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, Empty, PageHeader, SectionTitle, Status, fmtMoney } from "@/components/ui";
import { PAY_TONE, gameTitle, payLabel } from "@/components/game-bits";
import { ExpandRow, ShowMore } from "@/components/expand";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { requireActor } from "@/server/session";
import { financeOverview, previewSettlement } from "@/server/services/finance";
import { listMembers } from "@/server/services/groups";
import { CancelSettlement, ConfirmPay, SettleForm } from "./forms";

export const metadata = { title: "結算" };

export default async function SettlePage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const actor = await requireActor();
  const { done } = await searchParams;
  const [{ rows, pairs, orders }, members, settlements, pending, methods] = await Promise.all([
    financeOverview(actor),
    listMembers(actor),
    prisma.settlement.findMany({
      where: { groupId: actor.groupId, OR: [{ payerId: actor.userId }, { payeeId: actor.userId }] },
      include: { items: true, payment: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.payment.findMany({
      where: {
        groupId: actor.groupId,
        status: "VALID",
        OR: [{ payerId: actor.userId, payerConfirmedAt: null }, { payeeId: actor.userId, payeeConfirmedAt: null }],
      },
      orderBy: { paidAt: "desc" },
    }),
    prisma.paymentMethod.findMany({ where: { OR: [{ groupId: null }, { groupId: actor.groupId }] } }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const iOwe = rows.filter((r) => r.debtorId === actor.userId && r.outstanding > 0).reduce((a, r) => a + r.outstanding, 0);
  const owedToMe = rows.filter((r) => r.creditorId === actor.userId && r.outstanding > 0).reduce((a, r) => a + r.outstanding, 0);
  const previews = new Map(await Promise.all(pairs.map(async (p) => [p.otherId, await previewSettlement(prisma, actor.groupId, actor.userId, p.otherId)] as const)));
  const openRows = (otherId: string) => rows.filter((r) => (r.debtorId === otherId || r.creditorId === otherId) && r.outstanding !== 0);
  const unsettled = pairs.filter((p) => openRows(p.otherId).length > 0);
  const settledFriends = pairs.filter((p) => openRows(p.otherId).length === 0);
  const label = (orderId: string) => {
    const o = orders.get(orderId);
    return o ? `${fmtDate(o.game.startAt).replace(/（.）/, "")} ${gameTitle(o.game)}` : "訂單";
  };
  const settlementItem = (s: (typeof settlements)[number]) => (
    <div key={s.id} className="py-3 border-b border-line last:border-0">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold min-w-0 truncate">
          {nameOf.get(s.payerId)} → {nameOf.get(s.payeeId)}
        </div>
        <span className={`money-md ${s.status !== "COMPLETED" ? "line-through text-faint" : ""}`}>{fmtMoney(s.netAmount)}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-0.5">
        <span className="text-xs text-faint num">
          {fmtDateTime(s.createdAt)}・涵蓋 {s.items.length} 筆
        </span>
        <Status tone={s.status === "COMPLETED" ? "good" : "muted"}>{s.status === "COMPLETED" ? "已完成" : "已取消"}</Status>
      </div>
      <ExpandRow label="結算明細" className="flex items-center gap-2 mt-1" actions={<span className="text-xs text-faint">{nameOf.get(s.createdById)} 建立</span>}>
        <div className="inset mt-1">
          {s.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-3 text-sm py-1">
              <span className="min-w-0">
                {label(i.orderId)}
                <span className="text-faint">（{nameOf.get(i.debtorId)} → {nameOf.get(i.creditorId)}）</span>
              </span>
              <span className="num shrink-0">{fmtMoney(i.amount)}</span>
            </div>
          ))}
          <div className="text-xs text-faint mt-1">{nameOf.get(s.createdById)} 建立{s.cancelReason ? `・取消原因：${s.cancelReason}` : ""}</div>
          {s.status === "COMPLETED" ? <CancelSettlement settlementId={s.id} /> : null}
        </div>
      </ExpandRow>
    </div>
  );

  return (
    <>
      <PageHeader title="結算" />
      {done && settlements.some((s) => s.id === done) ? (
        <p role="status" className="msg msg-ok mb-3">
          結算已完成，已建立結算紀錄（見下方「最近的結算紀錄」）。各場原始帳目都保留。
        </p>
      ) : null}

      <div className="grid-2 mb-1" style={{ gap: 10 }}>
        <div className="stat">
          <div className="stat-label">我應收</div>
          <div className={`money-lg mt-1 ${owedToMe ? "tone-good" : ""}`}>{fmtMoney(owedToMe)}</div>
          <div className="stat-sub">別人還欠我（各場合計）</div>
        </div>
        <div className="stat">
          <div className="stat-label">我應付</div>
          <div className={`money-lg mt-1 ${iOwe ? "tone-bad" : ""}`}>{fmtMoney(iOwe)}</div>
          <div className="stat-sub">我還要付（各場合計）</div>
        </div>
      </div>

      {pending.length ? (
        <>
          <SectionTitle count={pending.length}>等我確認的付款</SectionTitle>
          <Card className="card-tight">
            {pending.map((p) => (
              <div key={p.id} className="list-row">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">
                    {nameOf.get(p.payerId)} → {nameOf.get(p.payeeId)}
                  </div>
                  <div className="text-xs text-faint truncate">
                    {p.settlementId ? "結算淨額" : p.orderId ? label(p.orderId) : ""}・{fmtDateTime(p.paidAt)}
                  </div>
                </div>
                <span className="money-md">{fmtMoney(p.amount)}</span>
                <ConfirmPay paymentId={p.id} label={p.payeeId === actor.userId ? "確認已收到" : "確認已付"} />
              </div>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle count={unsettled.length ? `${unsettled.length} 位` : undefined}>尚未結清的朋友</SectionTitle>
      {unsettled.length === 0 ? (
        <Card>
          <Empty>目前和大家都沒有未結帳目</Empty>
        </Card>
      ) : null}
      {unsettled.map((p) => {
        const pv = previews.get(p.otherId)!;
        const open = openRows(p.otherId);
        const other = nameOf.get(p.otherId) ?? "";
        const iPay = pv.payerId === actor.userId;
        return (
          <section key={p.otherId} className="card" data-friend={other}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-bold">{other}</div>
                <div className="text-xs text-faint mt-0.5 leading-relaxed">
                  <div>我欠 {other}：<span className="num">{fmtMoney(Math.max(0, p.iOwe))}</span></div>
                  <div>{other} 欠我：<span className="num">{fmtMoney(Math.max(0, p.theyOwe))}</span></div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="label">{pv.netAmount === 0 ? "剛好互相抵銷" : iPay ? `淨額：我應付 ${other}` : `淨額：${other} 應付我`}</div>
                <div className={`money-lg ${pv.netAmount === 0 ? "" : iPay ? "tone-bad" : "tone-good"}`}>{fmtMoney(pv.netAmount)}</div>
              </div>
            </div>
            <ExpandRow label={`與 ${other} 的各場明細`} className="flex items-center gap-2 mt-2" actions={<span className="text-sm text-muted">各場明細・{open.length} 筆</span>}>
              <div className="inset mt-1">
                {open.map((r) => (
                  <Link key={`${r.orderId}${r.debtorId}`} href={`/orders/${r.orderId}#pay`} className="flex items-center gap-2 py-2 border-b border-line last:border-0 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{label(r.orderId)}</div>
                      <div className="text-xs text-faint">
                        {r.debtorId === actor.userId ? `我 → ${other}` : `${other} → 我`}・應付 <span className="num">{fmtMoney(r.due)}</span>
                      </div>
                    </div>
                    <Status tone={PAY_TONE[r.state]}>{payLabel(r.state)}</Status>
                    <span className="num font-semibold">{fmtMoney(r.outstanding)}</span>
                  </Link>
                ))}
              </div>
            </ExpandRow>
            {pv.items.length ? (
              <SettleForm otherId={p.otherId} otherName={other} expectedNet={pv.netAmount} expectedPayerId={pv.payerId} iPay={iPay} count={pv.items.length} methods={methods.map((m) => m.name)} />
            ) : (
              <p className="text-xs text-faint mt-2">有退款處理中的帳目，請先完成退款再結算。</p>
            )}
          </section>
        );
      })}
      {settledFriends.length ? (
        <p className="text-xs text-faint mb-2">已結清：{settledFriends.map((p) => nameOf.get(p.otherId)).join("、")}</p>
      ) : null}

      <SectionTitle id="history" count={settlements.length ? `${settlements.length} 筆` : undefined}>最近的結算紀錄</SectionTitle>
      <Card className="card-tight">
        {settlements.length === 0 ? (
          <Empty>尚無結算紀錄</Empty>
        ) : (
          <ShowMore count={Math.max(0, settlements.length - 3)} rest={settlements.slice(3).map(settlementItem)}>
            {settlements.slice(0, 3).map(settlementItem)}
          </ShowMore>
        )}
      </Card>
      <p className="text-xs text-faint mt-2">
        結算只會新增結算紀錄與一筆淨額付款，原本每一場的應付與付款紀錄都完整保留。取消結算後，帳目恢復為未結。完整明細可在「個人 &gt; 資料匯出」下載。
      </p>
    </>
  );
}
