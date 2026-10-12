import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireActor } from "@/server/session";
import { listMembers } from "@/server/services/groups";
import { RestoreFlow } from "./restore";

export const metadata = { title: "資料匯出與備份" };

const SETS = [
  ["orders", "購票訂單"],
  ["tickets", "票券"],
  ["money", "付款與退款"],
  ["settlements", "結算明細"],
  ["balances", "應收應付"],
  ["attendance", "個人觀賽歷史"],
  ["games", "比賽結果（球隊勝敗統計用）"],
  ["supports", "成員觀賽與支持球隊"],
];

export default async function DataPage() {
  const actor = await requireActor();
  const members = await listMembers(actor);
  return (
    <>
      <PageHeader title="匯出、備份與還原" back="/me" />
      <SectionTitle>匯出</SectionTitle>
      <Card>
        <form method="get" action="/api/export">
          <div className="grid-2">
            <label className="field">
              <span className="field-label">購票期間（起）</span>
              <input className="input" type="date" name="from" />
            </label>
            <label className="field">
              <span className="field-label">購票期間（迄）</span>
              <input className="input" type="date" name="to" />
            </label>
          </div>
          <label className="field">
            <span className="field-label">觀賽歷史對象</span>
            <select className="select" name="user" defaultValue={actor.userId}>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.displayName}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">資料</span>
            <select className="select" name="set" defaultValue="orders">
              {SETS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="field-hint">期間只套用在訂單與票券；留空代表全部。每一列都保留訂單、票券、比賽、結算的 ID，方便互相對照。</span>
          </label>
          <div className="grid-2" style={{ gap: 10 }}>
            <button className="btn btn-secondary" name="format" value="csv">下載 CSV</button>
            <button className="btn btn-primary" name="format" value="xlsx">下載 Excel（全部分頁）</button>
          </div>
        </form>
      </Card>

      <SectionTitle>完整備份</SectionTitle>
      <Card>
        {actor.role === "ADMIN" ? (
          <>
            <p className="text-sm mb-3">下載本群組所有資料（成員對應、比賽、訂單、票券、付款、退款、結算、觀賽紀錄、修改紀錄）的 JSON 檔。檔案含票券識別資訊，請妥善保存，不要公開分享。</p>
            <a className="btn btn-primary w-full" href="/api/backup">下載完整備份</a>
          </>
        ) : (
          <p className="text-sm text-muted">完整備份與還原只有管理者可以操作。</p>
        )}
      </Card>

      {actor.role === "ADMIN" ? (
        <>
          <SectionTitle>還原備份</SectionTitle>
          <Card>
            <RestoreFlow />
          </Card>
        </>
      ) : null}
    </>
  );
}
