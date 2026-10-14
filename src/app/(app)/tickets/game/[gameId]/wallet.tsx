"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { ticketQuickAction } from "@/app/actions";

export interface WalletCard {
  id: string;
  seq: number;
  picked: boolean;
  pickupFailed: boolean;
  orderNumber: string | null;
  seat: string;
  price: number;
  ticketType: string;
  from: string;
  unassigned: boolean;
  secretUrl: string | null;
  secretText: string | null;
  platformUrl: string | null;
  platformName: string | null;
  pickupDeadline: string | null;
  canTransfer: boolean;
  paidByMe: number;
  orderId: string;
}

const money = (v: number) => `NT$ ${v.toLocaleString("en-US")}`;

function QuickOp({ id, op, children, variant = "primary" }: { id: string; op: string; children: React.ReactNode; variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <ActionForm action={ticketQuickAction} showSuccess={false}>
      <input type="hidden" name="ticketId" value={id} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant} block>
        {children}
      </SubmitButton>
    </ActionForm>
  );
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {}
      }}
    >
      {ok ? "已複製" : "複製"}
    </button>
  );
}

/** 轉送：從底部滑出的選單，選擇群組成員後確認 */
function TransferSheet({ card, members, onClose }: { card: WalletCard; members: { id: string; name: string }[]; onClose: () => void }) {
  const [to, setTo] = useState(members[0]?.id ?? "");
  const name = members.find((m) => m.id === to)?.name ?? "";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="轉送票券" onClick={onClose}>
      <div className="w-full max-w-[640px] rounded-t-2xl bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <div className="text-lg font-bold">轉送 TICKET {String(card.seq).padStart(2, "0")}</div>
        <p className="text-sm text-muted mt-1">{card.seat}</p>
        {members.length === 0 ? (
          <p className="msg msg-warn">群組裡沒有其他成員可以轉送</p>
        ) : (
          <ActionForm action={ticketQuickAction}>
            <input type="hidden" name="ticketId" value={card.id} />
            <input type="hidden" name="op" value="transfer" />
            <fieldset className="field mt-4">
              <legend className="field-label">轉送給</legend>
              <div className="grid-2" style={{ gap: 8 }}>
                {members.map((m) => (
                  <label key={m.id} className={`check rounded-xl px-3 ${to === m.id ? "bg-surface-3" : "bg-surface-2"}`}>
                    <input type="radio" name="toUserId" value={m.id} checked={to === m.id} onChange={() => setTo(m.id)} />
                    <span className="font-semibold">{m.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <ul className="text-xs text-faint space-y-1 mb-4 list-disc pl-4">
              <li>{name} 會在「我的票券」看到這張票，需要自己按「我已取票」。</li>
              <li>這張票的應付款會改由 {name} 負擔。</li>
              {card.paidByMe > 0 ? <li className="tone-warn">你已付的 {money(card.paidByMe)} 會顯示為「需退回」，由購票人退給你。</li> : null}
              <li>如果售票平台也需要轉送，請另外到平台操作。</li>
            </ul>
            <div className="grid-2" style={{ gap: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                取消
              </button>
              <SubmitButton pendingText="轉送中…">確認轉送</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

/** 票券夾：左右滑動逐張查看，一張票一個畫面 */
export function WalletCarousel({
  cards,
  start,
  title,
  when,
  venue,
  members,
}: {
  cards: WalletCard[];
  start: number;
  title: string;
  when: string;
  venue: string;
  members: { id: string; name: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(start);
  const [sheet, setSheet] = useState<WalletCard | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && start > 0) el.scrollTo({ left: start * el.clientWidth, behavior: "instant" as ScrollBehavior });
  }, [start]);

  const go = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  return (
    <>
      {cards.length > 1 ? (
        <div className="flex items-center justify-center gap-2 mb-3" aria-hidden>
          {cards.map((c, i) => (
            <button key={c.id} type="button" tabIndex={-1} onClick={() => go(i)} className={`h-2 rounded-full transition-all ${i === idx ? "w-5 bg-accent" : "w-2 bg-surface-3"}`} />
          ))}
        </div>
      ) : null}

      <div
        ref={ref}
        className="-mx-4 flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIdx(Math.round(el.scrollLeft / el.clientWidth));
        }}
        aria-label="票券，左右滑動切換"
      >
        {cards.map((c, i) => (
          <section key={c.id} className="w-full shrink-0 snap-center px-4" aria-label={`第 ${i + 1} 張，共 ${cards.length} 張`} data-wallet-ticket={c.seq}>
            <div className="rounded-[18px] bg-surface overflow-hidden">
              {/* 票頭 */}
              <div className="p-5 pb-4 text-center border-b border-dashed border-line">
                <div className="ticket-no">
                  TICKET {String(c.seq).padStart(2, "0")}
                  {cards.length > 1 ? <span className="ml-2 normal-case tracking-normal">· {i + 1}/{cards.length}</span> : null}
                </div>
                <div className="text-lg font-bold leading-snug mt-1">{title}</div>
                <div className="text-sm text-muted num">{when}</div>
              </div>

              {/* 座位與取票資訊 */}
              <div className="p-5">
                <div className="text-center">
                  <div className="label">座位</div>
                  <div className="text-2xl font-bold tone-warn leading-tight mt-1">{c.seat}</div>
                  <div className="mt-2 text-sm">
                    <span className="money-md">{money(c.price)}</span>
                    <span className="text-muted ml-2">{c.ticketType}</span>
                  </div>
                </div>

                {c.secretUrl ? (
                  <a href={c.secretUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full mt-4">
                    開啟電子票
                  </a>
                ) : c.secretText ? (
                  <div className="inset mt-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="label">取票序號／票券資訊</div>
                      <div className="num font-semibold text-lg break-all">{c.secretText}</div>
                    </div>
                    <CopyButton text={c.secretText} />
                  </div>
                ) : null}

                <dl className="mt-4 space-y-1.5 text-sm">
                  <div className="flex gap-3"><dt className="w-16 shrink-0 text-faint">訂單編號</dt><dd className="num break-all">{c.orderNumber ?? "未填"}</dd></div>
                  <div className="flex gap-3"><dt className="w-16 shrink-0 text-faint">活動地點</dt><dd>{venue}</dd></div>
                  {c.pickupDeadline ? <div className="flex gap-3"><dt className="w-16 shrink-0 text-faint">取票期限</dt><dd className="num tone-warn">{c.pickupDeadline}</dd></div> : null}
                  <div className="flex gap-3"><dt className="w-16 shrink-0 text-faint">來源</dt><dd className="text-info">{c.from}</dd></div>
                </dl>

                {/* 主要操作 */}
                <div className="mt-5 space-y-2.5">
                  {c.picked ? (
                    <div className="rounded-xl bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] py-3 text-center font-bold tone-good">已取票</div>
                  ) : (
                    <>
                      {c.pickupFailed ? <p className="msg msg-error !mt-0">上次標記為取票失敗，取到後再按一次。</p> : null}
                      <QuickOp id={c.id} op="picked">
                        我已取票
                      </QuickOp>
                    </>
                  )}
                  {c.platformUrl ? (
                    <a href={c.platformUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">
                      前往{c.platformName ?? "售票平台"}
                    </a>
                  ) : null}
                  {c.canTransfer ? (
                    <button type="button" className="btn btn-secondary w-full" onClick={() => setSheet(c)}>
                      轉送給朋友
                    </button>
                  ) : null}
                </div>

                <div className="flex items-center justify-between mt-4 text-sm">
                  <Link href={`/tickets/${c.id}`} className="link">
                    票券詳情
                  </Link>
                  {c.picked ? <QuickOp id={c.id} op="unpicked" variant="ghost">改回未取票</QuickOp> : null}
                  <Link href={`/orders/${c.orderId}`} className="link">
                    訂單與付款
                  </Link>
                </div>
              </div>
            </div>
          </section>
        ))}
      </div>

      {cards.length > 1 ? (
        <div className="flex items-center justify-between mt-3">
          <button type="button" className="btn btn-secondary btn-sm" disabled={idx === 0} onClick={() => go(idx - 1)}>
            上一張
          </button>
          <span className="text-sm text-faint num">
            {idx + 1} / {cards.length}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={idx >= cards.length - 1} onClick={() => go(idx + 1)}>
            下一張
          </button>
        </div>
      ) : null}
      {cards.length > 1 ? <p className="text-xs text-faint text-center mt-3">左右滑動切換票券</p> : null}

      {sheet ? <TransferSheet card={sheet} members={members} onClose={() => setSheet(null)} /> : null}
    </>
  );
}
