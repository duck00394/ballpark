"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { createOrderAction } from "@/app/actions";
import { computeOrderShares, type FeeMode } from "@/lib/money";
import { FEE_MODE_LABEL, ORDER_STATUS_LABEL } from "@/lib/labels";

type GameOpt = { id: string; label: string; venue: string; teams: string[]; off: boolean };
type Member = { id: string; name: string };

interface TicketDraft {
  holderId: string;
  price: string;
  section: string;
  rowLabel: string;
  seatNumber: string;
  ticketType: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
function nowLocal() {
  const d = new Date();
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
const n = (s: string) => (s.trim() === "" ? 0 : Math.trunc(Number(s.replace(/,/g, ""))) || 0);
const fmt = (v: number) => `NT$ ${v.toLocaleString("en-US")}`;

export function OrderCreateForm({
  fixedGame,
  games,
  teams,
  members,
  platforms,
  me,
}: {
  fixedGame: GameOpt | null;
  games: GameOpt[];
  teams: (readonly [string, string])[];
  members: Member[];
  platforms: { id: string; name: string }[];
  me: string;
}) {
  const [gameId, setGameId] = useState(fixedGame?.id ?? "");
  const [teamFilter, setTeamFilter] = useState("");
  const [buyerId, setBuyerId] = useState(me);
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("0");
  const [other, setOther] = useState("0");
  const [mode, setMode] = useState<FeeMode>("PER_TICKET");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [tickets, setTickets] = useState<TicketDraft[]>([blank(me)]);
  const [bulk, setBulk] = useState({ section: "", rowLabel: "", seatStart: "" });
  const now = useMemo(nowLocal, []);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));

  function blank(holder = ""): TicketDraft {
    return { holderId: holder, price: "", section: "", rowLabel: "", seatNumber: "", ticketType: "電子票" };
  }
  function setCount(c: number) {
    const count = Math.max(1, Math.min(30, c));
    setTickets((prev) => (count > prev.length ? [...prev, ...Array.from({ length: count - prev.length }, () => blank())] : prev.slice(0, count)));
  }
  function patch(i: number, p: Partial<TicketDraft>) {
    setTickets((prev) => prev.map((t, j) => (j === i ? { ...t, ...p } : t)));
  }
  function applyBulk() {
    const start = parseInt(bulk.seatStart, 10);
    setTickets((prev) =>
      prev.map((t, i) => ({
        ...t,
        section: bulk.section || t.section,
        rowLabel: bulk.rowLabel || t.rowLabel,
        seatNumber: Number.isFinite(start) ? String(start + i) : t.seatNumber,
      })),
    );
  }
  function assignEveryone() {
    const others = [buyerId, ...members.map((m) => m.id).filter((id) => id !== buyerId)];
    setTickets((prev) => prev.map((t, i) => ({ ...t, holderId: others[i] ?? "" })));
  }

  const preview = useMemo(() => {
    try {
      const s = computeOrderShares(
        {
          buyerId,
          status: "PURCHASED",
          feeAmount: n(fee),
          otherFeeAmount: n(other),
          feeSplitMode: mode,
          customFeeSplit: mode === "CUSTOM" ? Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, n(v)])) : null,
        },
        tickets.map((t, i) => ({ id: String(i), holderId: t.holderId || null, price: t.price ? n(t.price) : n(price), pickupStatus: "NOT_PICKED", archived: false })),
      );
      return { s, error: null as string | null };
    } catch (e) {
      return { s: null, error: e instanceof Error ? e.message : "分攤設定錯誤" };
    }
  }, [buyerId, fee, other, mode, custom, tickets, price]);

  const shownGames = games.filter((g) => !teamFilter || g.teams.includes(teamFilter));
  const holders = [...new Set(tickets.map((t) => t.holderId || buyerId))];

  return (
    <ActionForm action={createOrderAction}>
      {/* 1. 比賽 */}
      <section className="card">
        <h2 className="font-bold mb-2">1. 比賽</h2>
        {fixedGame ? (
          <>
            <input type="hidden" name="gameId" value={fixedGame.id} />
            <div className="font-semibold">{fixedGame.label}</div>
            <div className="text-sm text-muted">{fixedGame.venue}</div>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field-label">篩選球隊</span>
              <select className="select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                <option value="">全部球隊</option>
                {teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">選擇比賽</span>
              <select className="select" name="gameId" required value={gameId} onChange={(e) => setGameId(e.target.value)}>
                <option value="" disabled>請選擇（共 {shownGames.length} 場）</option>
                {shownGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}・{g.venue}{g.off ? "（延期或取消）" : ""}
                  </option>
                ))}
              </select>
              <span className="field-hint">
                從賽程選擇後，日期、時間、球隊與球場都會自動帶入。找不到比賽？<Link href="/games/new" className="link">手動新增比賽</Link>
              </span>
            </label>
          </>
        )}
      </section>

      {/* 2. 訂單 */}
      <section className="card">
        <h2 className="font-bold mb-2">2. 訂單</h2>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">購票人（代墊）</span>
            <select className="select" name="buyerId" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">購票狀態</span>
            <select className="select" name="status" defaultValue="PURCHASED">
              {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field-label">售票平台</span>
          <select className="select" name="platformId" defaultValue="">
            <option value="">未填</option>
            {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <span className="field-hint">沒有想要的平台？可在「個人 &gt; 售票平台」新增。</span>
        </label>
        <details className="disclosure">
          <summary className="text-sm">訂單編號、購票連結、時間與取票期限</summary>
          <label className="field mt-2">
            <span className="field-label">訂單編號</span>
            <input className="input" name="orderNumber" autoCapitalize="characters" />
          </label>
          <label className="field">
            <span className="field-label">購票連結</span>
            <input className="input" name="purchaseUrl" type="url" inputMode="url" placeholder="https://" />
          </label>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">購票日期</span>
              <input className="input" type="date" name="purchasedDate" defaultValue={now.date} />
            </label>
            <label className="field">
              <span className="field-label">時間</span>
              <input className="input" type="time" name="purchasedTime" defaultValue={now.time} />
            </label>
          </div>
          <div className="grid-2">
            <label className="field">
              <span className="field-label">取票期限</span>
              <input className="input" type="date" name="pickupDeadlineDate" />
            </label>
            <label className="field">
              <span className="field-label">時間</span>
              <input className="input" type="time" name="pickupDeadlineTime" />
            </label>
          </div>
          <label className="field">
            <span className="field-label">票種</span>
            <input className="input" name="ticketCategory" placeholder="例如：全票、內野自由座" />
          </label>
          <label className="field">
            <span className="field-label">備註</span>
            <textarea className="textarea" name="note" />
          </label>
        </details>
      </section>

      {/* 3. 張數與金額 */}
      <section className="card">
        <h2 className="font-bold mb-2">3. 張數與金額</h2>
        <div className="field">
          <span className="field-label">購買張數</span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setCount(tickets.length - 1)} aria-label="減少一張">－</button>
            <input className="input text-center w-20" name="count" type="number" inputMode="numeric" min={1} max={30} value={tickets.length} onChange={(e) => setCount(Number(e.target.value) || 1)} />
            <button type="button" className="btn btn-secondary" onClick={() => setCount(tickets.length + 1)} aria-label="增加一張">＋</button>
          </div>
        </div>
        <div className="grid-3">
          <label className="field">
            <span className="field-label">每張票價</span>
            <input className="input" name="pricePerTicket" inputMode="numeric" required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" />
          </label>
          <label className="field">
            <span className="field-label">手續費</span>
            <input className="input" name="feeAmount" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">其他費用</span>
            <input className="input" name="otherFeeAmount" inputMode="numeric" value={other} onChange={(e) => setOther(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span className="field-label">手續費與其他費用的分攤方式</span>
          <select className="select" name="feeSplitMode" value={mode} onChange={(e) => setMode(e.target.value as FeeMode)}>
            {Object.entries(FEE_MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="field-hint">無法整除時，零頭由購票人吸收，總額一定相符。</span>
        </label>
        {mode === "CUSTOM" ? (
          <div className="grid-2">
            {holders.map((id) => (
              <label key={id} className="field">
                <span className="field-label">{nameOf.get(id)} 負擔</span>
                <input className="input" name={`custom_${id}`} inputMode="numeric" value={custom[id] ?? ""} onChange={(e) => setCustom({ ...custom, [id]: e.target.value })} />
              </label>
            ))}
          </div>
        ) : null}
        <label className="field">
          <span className="field-label">訂單實際支付總額（選填，用來核對）</span>
          <input className="input" name="actualTotal" inputMode="numeric" />
        </label>
      </section>

      {/* 4. 每張票 */}
      <section className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold">4. 每張票的持有人與座位</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={assignEveryone}>依序分給每人</button>
        </div>
        <details className="disclosure mb-2">
          <summary className="text-sm">連號座位快速填寫</summary>
          <div className="grid-3 mt-2">
            <input className="input" placeholder="區域" value={bulk.section} onChange={(e) => setBulk({ ...bulk, section: e.target.value })} aria-label="區域" />
            <input className="input" placeholder="排" value={bulk.rowLabel} onChange={(e) => setBulk({ ...bulk, rowLabel: e.target.value })} aria-label="排" />
            <input className="input" placeholder="起始座號" inputMode="numeric" value={bulk.seatStart} onChange={(e) => setBulk({ ...bulk, seatStart: e.target.value })} aria-label="起始座號" />
          </div>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={applyBulk}>套用到所有票</button>
        </details>
        {tickets.map((t, i) => (
          <div key={i} className="border-t border-line pt-3 mt-3 first-of-type:border-0">
            <div className="font-semibold text-sm mb-2">第 {i + 1} 張</div>
            <div className="grid-2">
              <label className="field">
                <span className="field-label">持有人</span>
                <select className="select" name={`t${i}_holderId`} value={t.holderId} onChange={(e) => patch(i, { holderId: e.target.value })}>
                  <option value="">尚未分配</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">票價（不同才填）</span>
                <input className="input" name={`t${i}_price`} inputMode="numeric" placeholder={price || "0"} value={t.price} onChange={(e) => patch(i, { price: e.target.value })} />
              </label>
            </div>
            <div className="grid-3">
              <input className="input" name={`t${i}_section`} placeholder="區域" aria-label={`第 ${i + 1} 張區域`} value={t.section} onChange={(e) => patch(i, { section: e.target.value })} />
              <input className="input" name={`t${i}_rowLabel`} placeholder="排" aria-label={`第 ${i + 1} 張排數`} value={t.rowLabel} onChange={(e) => patch(i, { rowLabel: e.target.value })} />
              <input className="input" name={`t${i}_seatNumber`} placeholder="座號" aria-label={`第 ${i + 1} 張座號`} value={t.seatNumber} onChange={(e) => patch(i, { seatNumber: e.target.value })} />
            </div>
            <label className="field mt-2">
              <span className="field-label">票券類型</span>
              <input className="input" name={`t${i}_ticketType`} list="ticket-types" value={t.ticketType} onChange={(e) => patch(i, { ticketType: e.target.value })} />
            </label>
          </div>
        ))}
        <datalist id="ticket-types">
          <option value="電子票" />
          <option value="實體票" />
        </datalist>
      </section>

      {/* 5. 預覽 */}
      <section className="card" aria-live="polite">
        <h2 className="font-bold mb-2">分攤預覽</h2>
        {preview.error ? (
          <p className="msg msg-error">{preview.error}</p>
        ) : preview.s ? (
          <>
            <div className="kv"><dt>票價合計</dt><dd>{fmt(preview.s.ticketTotal)}</dd></div>
            <div className="kv"><dt>手續費＋其他</dt><dd>{fmt(preview.s.feeTotal)}</dd></div>
            <div className="kv font-bold"><dt>總額</dt><dd>{fmt(preview.s.grandTotal)}</dd></div>
            <div className="mt-2">
              {[...preview.s.byUser].map(([uid, v]) => (
                <div key={uid} className="kv text-sm">
                  <dt>{nameOf.get(uid)}{uid === buyerId ? "（購票人）" : "應付給購票人"}</dt>
                  <dd>{fmt(v.ticket + v.fee)}</dd>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      <div className="sticky bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+8px)] z-10">
        <SubmitButton block pendingText="建立中…">建立訂單與 {tickets.length} 張票</SubmitButton>
      </div>
    </ActionForm>
  );
}
