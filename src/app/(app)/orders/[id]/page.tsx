import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { Card, PageHeader, SectionTitle, Status, fmtMoney } from "@/components/ui";
import { OrderBadge, PAY_TONE, PayBadge, gameFullTitle } from "@/components/game-bits";
import { TicketCard } from "@/components/ticket-card";
import { ExpandRow, ShowMore } from "@/components/expand";
import { FEE_MODE_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime, hm, ymd } from "@/lib/time";
import { requireActor } from "@/server/session";
import { computeLedger } from "@/server/services/finance";
import { listMembers } from "@/server/services/groups";
import { getOrderDetail, listPlatforms } from "@/server/services/orders";
import { PlatformLink } from "./platform-link";
import { AddTicketForm, EditOrderForm, PaymentForm, PaymentOps, PlatformRefundForm, RefundForm, RefundOps } from "./forms";

const OK_TEXT: Record<string, string> = { pay: "付款已記錄", refund: "退款已記錄" };

type HistoryItem = {
  id: string;
  kind: "PAY" | "REFUND";
  at: Date;
  amount: number;
  from: string;
  to: string;
  status: string;
  tone: "good" | "warn" | "muted" | "info";
  detail: string;
  pending: boolean;
  ops?: React.ReactNode;
};

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  const { ok } = await searchParams;
  let o;
  try {
    o = await getOrderDetail(actor, id);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const [members, rows, payments, refunds, platforms, methods, logs] = await Promise.all([
    listMembers(actor),
    computeLedger(prisma, actor.groupId, { orderId: id }),
    prisma.payment.findMany({ where: { orderId: id, groupId: actor.groupId }, orderBy: { paidAt: "desc" } }),
    prisma.refund.findMany({ where: { orderId: id, groupId: actor.groupId }, orderBy: { createdAt: "desc" } }),
    listPlatforms(actor),
    prisma.paymentMethod.findMany({ where: { OR: [{ groupId: null }, { groupId: actor.groupId }] } }),
    prisma.auditLog.findMany({ where: { groupId: actor.groupId, entityType: "TicketOrder", entityId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.displayName]));
  const n = (uid: string | null | undefined) => (uid ? (nameOf.get(uid) ?? "") : "");
  const live = o.tickets.filter((t) => !t.archived);
  const listTotal = live.reduce((a, t) => a + t.price, 0) + o.feeAmount + o.otherFeeAmount;
  const holders = new Set(live.map((t) => t.holderId).filter(Boolean));
  const rowOf = new Map(rows.map((r) => [r.debtorId, r]));
  const payUrl = o.purchaseUrl ?? o.platform?.webUrl ?? null;
  const methodNames = methods.map((m) => m.name);
  const orderActive = o.status === "PURCHASED" || o.status === "REFUNDING";

  // 分帳總覽：直接加總既有帳目服務的結果，不另外計算
  const totalDue = rows.reduce((a, r) => a + r.due, 0);
  const totalReceived = rows.reduce((a, r) => a + r.paid + r.settled - r.refunded, 0);
  const totalPending = rows.reduce((a, r) => a + Math.max(0, r.outstanding), 0);
  const totalOverpaid = rows.reduce((a, r) => a + Math.max(0, -r.outstanding), 0);

  // 付款與退款時間軸
  const history: HistoryItem[] = [
    ...payments.map((p): HistoryItem => {
      const revoked = p.status === "REVOKED";
      const pendingMe = (actor.userId === p.payerId && !p.payerConfirmedAt) || (actor.userId === p.payeeId && !p.payeeConfirmedAt);
      const confirm = revoked
        ? `已撤銷：${p.revokeReason ?? ""}`
        : p.payerConfirmedAt && p.payeeConfirmedAt
          ? "雙方已確認"
          : !p.payeeConfirmedAt
            ? "待收款人確認"
            : "待付款人確認";
      return {
        id: p.id,
        kind: "PAY",
        at: p.paidAt,
        amount: p.amount,
        from: n(p.payerId),
        to: n(p.payeeId),
        status: confirm,
        tone: revoked ? "muted" : p.payerConfirmedAt && p.payeeConfirmedAt ? "good" : "warn",
        detail: [p.method, `${n(p.createdById)} 記錄`, p.note].filter(Boolean).join("・"),
        pending: !revoked && pendingMe,
        ops: revoked ? undefined : (
          <PaymentOps paymentId={p.id} canConfirm={pendingMe} canRevoke={actor.role === "ADMIN" || p.createdById === actor.userId} />
        ),
      };
    }),
    ...refunds.map((r): HistoryItem => ({
      id: r.id,
      kind: "REFUND",
      at: r.completedAt ?? r.createdAt,
      amount: r.amount,
      from: r.kind === "PLATFORM" ? "售票平台" : n(r.fromUserId),
      to: n(r.toUserId),
      status: r.status === "COMPLETED" ? "已退款" : r.status === "PROCESSING" ? "退款中" : "已取消",
      tone: r.status === "COMPLETED" ? "info" : r.status === "PROCESSING" ? "warn" : "muted",
      detail: [r.kind === "PLATFORM" ? "平台退款（紀錄用，不影響朋友帳）" : "朋友間退款", r.note].filter(Boolean).join("・"),
      pending: r.status === "PROCESSING",
      ops: r.status === "PROCESSING" ? <RefundOps refundId={r.id} canCancel={actor.role === "ADMIN" || r.createdById === actor.userId} /> : undefined,
    })),
  ].sort((a, b) => +b.at - +a.at);
  const pinned = history.filter((h) => h.pending);
  const others = history.filter((h) => !h.pending);
  const first = [...pinned, ...others.slice(0, Math.max(0, 3 - pinned.length))];
  const rest = others.slice(Math.max(0, 3 - pinned.length));
  const renderItem = (h: HistoryItem) => (
    <div key={h.id} className="tl-item" data-tone={h.tone}>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-semibold truncate">
            {h.kind === "REFUND" ? <span className="tone-info mr-1.5 text-sm">退款</span> : null}
            {h.from} → {h.to}
          </div>
          <span className={`money-md ${h.tone === "muted" ? "line-through text-faint" : ""}`}>{fmtMoney(h.amount)}</span>
        </div>
        <div className="text-xs text-faint num mt-0.5">{fmtDateTime(h.at)}</div>
        <div className="flex items-center justify-between gap-2 mt-1">
          <Status tone={h.tone}>{h.status}</Status>
          {h.ops}
        </div>
        {h.detail ? <div className="text-xs text-faint mt-1">{h.detail}</div> : null}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="訂單" back={`/games/${o.gameId}`} sub={o.orderNumber ? `#${o.orderNumber}` : undefined} />

      {ok && OK_TEXT[ok] ? (
        <p role="status" className="msg msg-ok mb-3">
          {OK_TEXT[ok]}，帳目已更新。
        </p>
      ) : null}

      {/* 1. 訂單摘要 */}
      <section className="hero">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">訂單摘要</span>
          <OrderBadge s={o.status} />
        </div>
        <Link href={`/games/${o.gameId}`} className="block mt-2">
          <div className="text-xl font-bold leading-snug">{gameFullTitle(o.game)}</div>
          <div className="text-sm text-muted mt-0.5">
            <span className="num">{fmtDate(o.game.startAt)} {hm(o.game.startAt)}</span>・{o.game.venue?.name ?? "未定球場"}
          </div>
        </Link>
        <div className="flex items-end justify-between gap-3 mt-4">
          <div>
            <div className="label">訂單總額</div>
            <div className="money-xl">{fmtMoney(listTotal)}</div>
          </div>
          <div className="text-right text-sm text-muted pb-1">
            <span className="num">{live.length}</span> 張票 · <span className="num">{holders.size}</span> 位持有人
          </div>
        </div>
        {o.actualTotal != null && o.actualTotal !== listTotal ? (
          <p className="msg msg-warn">
            實際支付 {fmtMoney(o.actualTotal)}，與票價＋費用相差 {fmtMoney(o.actualTotal - listTotal)}
          </p>
        ) : null}
        <dl className="meta-grid mt-4 pt-4 border-t border-line">
          <div><dt>購票人</dt><dd>{n(o.buyerId)}</dd></div>
          <div><dt>售票平台</dt><dd>{o.platform?.name ?? "未填"}</dd></div>
          <div><dt>手續費與其他</dt><dd className="num">{fmtMoney(o.feeAmount + o.otherFeeAmount)}</dd></div>
          <div><dt>分攤方式</dt><dd>{FEE_MODE_LABEL[o.feeSplitMode]}</dd></div>
          {o.purchasedAt ? <div><dt>購票時間</dt><dd className="num">{fmtDateTime(o.purchasedAt)}</dd></div> : null}
          {o.pickupDeadline ? <div><dt>取票期限</dt><dd className="num">{fmtDateTime(o.pickupDeadline)}</dd></div> : null}
          {o.ticketCategory ? <div><dt>票種</dt><dd>{o.ticketCategory}</dd></div> : null}
          <div><dt>建立者</dt><dd>{n(o.createdById)}</dd></div>
        </dl>
        {o.note ? <p className="text-sm text-muted mt-3">{o.note}</p> : null}
        <PlatformLink webUrl={payUrl} appUrl={o.platform?.appUrl ?? null} />
      </section>

      <nav className="jump" aria-label="頁內跳轉">
        <a href="#tickets">票券 {live.length}</a>
        <a href="#pay">分帳</a>
        <a href="#history">紀錄 {history.length}</a>
      </nav>

      {/* 2. 票券 */}
      <SectionTitle id="tickets" count={`${live.length} 張`}>票券</SectionTitle>
      {live.map((t) => (
        <TicketCard
          key={t.id}
          t={t}
          nameOf={nameOf}
          buyerId={o.buyerId}
          viewerId={actor.userId}
          canEdit={o.canEdit}
          orderActive={orderActive}
          payState={t.holderId ? rowOf.get(t.holderId)?.state : undefined}
        />
      ))}
      {o.tickets.some((t) => t.archived) ? (
        <p className="text-xs text-faint mb-2">已移除 {o.tickets.filter((t) => t.archived).length} 張票（帳目紀錄保留）。</p>
      ) : null}
      {o.canEdit ? <AddTicketForm orderId={o.id} /> : null}

      {/* 3. 分帳 */}
      <SectionTitle id="pay">分帳</SectionTitle>
      <Card>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="label">應收總額</div>
            <div className="money-md">{fmtMoney(totalDue)}</div>
          </div>
          <div>
            <div className="label">已收金額</div>
            <div className="money-md tone-good">{fmtMoney(totalReceived)}</div>
          </div>
          <div>
            <div className="label">待收金額</div>
            <div className={`money-md ${totalPending ? "tone-warn" : ""}`}>{fmtMoney(totalPending)}</div>
          </div>
        </div>
        {totalOverpaid ? <p className="msg msg-warn">有 {fmtMoney(totalOverpaid)} 溢付，需要退回（例如票券已退票）。</p> : null}
        <p className="text-xs text-faint mt-3">持票人應付給購票人 {n(o.buyerId)}；金額依票價與分攤後的費用計算。</p>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{orderActive ? "所有票都由購票人自己持有，沒有朋友間的應付款。" : "此訂單目前不產生應付款（未購票、取消或已退款）。"}</p>
        </Card>
      ) : (
        rows.map((r) => {
          const pairPays = history.filter((h) => (h.from === n(r.debtorId) && h.to === n(r.creditorId)) || (h.kind === "REFUND" && h.from === n(r.creditorId) && h.to === n(r.debtorId)));
          const mayAct = actor.userId === r.debtorId || actor.userId === r.creditorId || actor.role === "ADMIN";
          return (
            <section key={r.debtorId} className="card !p-0 overflow-hidden" data-ledger-from={n(r.debtorId)}>
              <div className="p-4 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">
                    {n(r.debtorId)} <span className="text-faint">→</span> {n(r.creditorId)}
                  </div>
                  <PayBadge state={r.state} />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <div className="label">應付</div>
                    <div className="money-md">{fmtMoney(r.due)}</div>
                  </div>
                  <div>
                    <div className="label">已付{r.settled ? "（含結算）" : ""}</div>
                    <div className="money-md">{fmtMoney(r.paid + r.settled - r.refunded)}</div>
                  </div>
                  <div>
                    <div className="label">{r.outstanding < 0 ? "需退回" : "尚欠"}</div>
                    <div className={`money-md ${r.outstanding > 0 ? `tone-${PAY_TONE[r.state] === "bad" ? "bad" : "warn"}` : r.outstanding < 0 ? "tone-warn" : "tone-good"}`}>
                      {fmtMoney(Math.abs(r.outstanding))}
                    </div>
                  </div>
                </div>
                {r.refundPending ? <p className="text-xs text-faint mt-2">退款處理中 {fmtMoney(r.refundPending)}</p> : null}
              </div>
              <ExpandRow
                label={`${n(r.debtorId)} 的付款明細`}
                className="flex gap-2 items-start px-4 pb-3 flex-wrap"
                actions={
                  mayAct && r.outstanding > 0 ? (
                    <PaymentForm orderId={o.id} payerId={r.debtorId} outstanding={r.outstanding} methods={methodNames} who={actor.userId === r.debtorId ? "我付款" : "記錄收款"} today={ymd(new Date())} />
                  ) : mayAct && r.outstanding < 0 && r.refundPending === 0 ? (
                    <RefundForm orderId={o.id} fromUserId={r.creditorId} toUserId={r.debtorId} amount={-r.outstanding} label="記錄退款" methods={methodNames} />
                  ) : (
                    <span className="text-xs text-faint self-center">付款明細・{pairPays.length} 筆</span>
                  )
                }
              >
                <div className="px-4 pb-4">
                  <div className="inset">
                    {pairPays.length === 0 ? <p className="text-sm text-muted">尚無付款紀錄</p> : <div className="timeline">{pairPays.map((h) => renderItem({ ...h, ops: undefined }))}</div>}
                  </div>
                </div>
              </ExpandRow>
            </section>
          );
        })
      )}

      {/* 4. 付款與退款紀錄 */}
      <SectionTitle id="history" count={history.length ? `${history.length} 筆` : undefined}>
        付款與退款紀錄
      </SectionTitle>
      <span id="refunds" />
      <Card>
        {history.length === 0 ? (
          <p className="text-sm text-muted">尚無付款或退款紀錄</p>
        ) : (
          <div className="timeline">
            <ShowMore count={rest.length} rest={rest.map(renderItem)}>
              {first.map(renderItem)}
            </ShowMore>
          </div>
        )}
        <p className="text-xs text-faint mt-3">
          完整明細可在「個人 &gt; 資料匯出」下載。{pinned.length ? "需要你確認或處理中的紀錄固定顯示在最上方。" : ""}
        </p>
      </Card>

      {/* 5. 進階 */}
      <SectionTitle>更多操作</SectionTitle>
      {o.canEdit ? (
        <details className="card disclosure">
          <summary>記錄售票平台退款</summary>
          <div className="mt-2">
            <PlatformRefundForm orderId={o.id} />
          </div>
        </details>
      ) : null}
      {o.canEdit ? (
        <details className="card disclosure">
          <summary>修改訂單（狀態、費用、分攤、購票人）</summary>
          <div className="mt-2">
            <EditOrderForm
              order={{
                id: o.id,
                version: o.version,
                buyerId: o.buyerId,
                platformId: o.platformId,
                purchaseUrl: o.purchaseUrl,
                orderNumber: o.orderNumber,
                ticketCategory: o.ticketCategory,
                feeAmount: o.feeAmount,
                otherFeeAmount: o.otherFeeAmount,
                actualTotal: o.actualTotal,
                feeSplitMode: o.feeSplitMode,
                customFeeSplit: (o.customFeeSplit as Record<string, number> | null) ?? {},
                status: o.status,
                purchasedDate: o.purchasedAt ? ymd(o.purchasedAt) : "",
                purchasedTime: o.purchasedAt ? hm(o.purchasedAt) : "",
                pickupDeadlineDate: o.pickupDeadline ? ymd(o.pickupDeadline) : "",
                pickupDeadlineTime: o.pickupDeadline ? hm(o.pickupDeadline) : "",
                note: o.note,
              }}
              members={members.map((m) => ({ id: m.userId, name: m.displayName }))}
              holders={[...new Set(live.map((t) => t.holderId ?? o.buyerId))]}
              platforms={platforms.map((p) => ({ id: p.id, name: p.name }))}
              isBuyer={actor.userId === o.buyerId}
            />
          </div>
        </details>
      ) : null}
      <details className="card disclosure">
        <summary>修改紀錄</summary>
        {logs.length === 0 ? <p className="text-sm text-muted">尚無紀錄</p> : null}
        {logs.map((l) => (
          <div key={l.id} className="flex justify-between gap-3 text-sm py-2 border-b border-line last:border-0">
            <span>{n(l.actorId)}・{l.action === "ORDER_CREATE" ? "建立訂單" : "修改訂單"}</span>
            <span className="text-faint num shrink-0">{fmtDateTime(l.createdAt)}</span>
          </div>
        ))}
      </details>
      {!o.canEdit ? <p className="text-xs text-faint">只有訂單建立者、購票人與管理者可以修改訂單與票券。</p> : null}
    </>
  );
}
