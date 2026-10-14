import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireActor } from "@/server/session";
import { ImportForms } from "./forms";
import { CopySnippet } from "./copy-snippet";
import { BookmarkletLink, ReceiveFromCpbl } from "./bookmarklet";

export const metadata = { title: "匯入賽程" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ receive?: string }> }) {
  const actor = await requireActor();
  const { receive } = await searchParams;
  const admin = actor.role === "ADMIN";
  return (
    <>
      <PageHeader title="匯入賽程" back="/games" />
      {receive && admin ? <ReceiveFromCpbl /> : null}
      {receive && !admin ? <p className="msg msg-error mb-3">只有管理者可以匯入官網賽程。</p> : null}
      {admin ? (
        <>
          <SectionTitle>從中職官網匯入（推薦）</SectionTitle>
          <Card>
            <p className="text-sm text-muted mb-3">
              中職官網會擋掉雲端主機，所以「立即同步」無法使用。請改用這個書籤，在你自己的電腦瀏覽器（Chrome、Edge 或 Safari）操作，約每週一次即可更新賽程與比分。
            </p>
            <div className="text-sm font-semibold mb-2">第一次設定（只要做一次）</div>
            <ol className="text-sm list-decimal pl-5 space-y-1.5 mb-3">
              <li>用電腦開啟這一頁。如果瀏覽器上方沒有書籤列，按 Ctrl＋Shift＋B（Mac 按 ⌘＋Shift＋B）打開。</li>
              <li>用滑鼠把下面的綠色按鈕「拖到」書籤列上。</li>
            </ol>
            <BookmarkletLink />
            <div className="text-sm font-semibold mt-4 mb-2">之後每次更新</div>
            <ol className="text-sm list-decimal pl-5 space-y-1.5">
              <li>
                打開{" "}
                <a href="https://www.cpbl.com.tw/schedule" target="_blank" rel="noopener noreferrer" className="link">
                  中職官網賽程頁
                </a>
                。
              </li>
              <li>按書籤列上的「看球帳本匯入」。</li>
              <li>會自動開一個新分頁並完成匯入，看到「匯入 N 場」就好了。</li>
            </ol>
            <p className="text-xs text-faint mt-3">
              書籤只讀取官網公開的今年賽程，並直接傳給你的看球帳本，不會讀取其他網站或帳號資料。重複匯入不會產生重複比賽，比分與延期會自動更新，購票資料不受影響。如果瀏覽器擋下新分頁，請允許這個網站開啟彈出視窗。
            </p>
          </Card>
        </>
      ) : null}
      <SectionTitle>CSV 匯入（本群組自用賽程）</SectionTitle>
      <Card>
        <p className="text-sm text-muted mb-2">
          第一列為標題，必要欄位：日期、時間、客隊、主隊；選填：球場、狀態、客隊得分、主隊得分、編號、賽事類型。
          狀態可填「尚未開賽／比賽結束／延期／取消／保留比賽」。同一「編號」再次匯入會更新該場，不會重複。只要有一列錯誤就整批不匯入。
        </p>
        <pre className="text-xs inset overflow-x-auto mb-3">日期,時間,客隊,主隊,球場,狀態,客隊得分,主隊得分,編號{"\n"}2026-11-10,18:35,台鋼雄鷹,中信兄弟,洲際,,,,F1</pre>
        <ImportForms isAdmin={actor.role === "ADMIN"} part="csv" />
      </Card>
      {actor.role === "ADMIN" ? (
        <>
          <details className="card disclosure">
            <summary>書籤無法使用時：用主控台複製</summary>
            <p className="text-sm text-muted my-3">需要用電腦的 Chrome 或 Edge：</p>
            <ol className="text-sm list-decimal pl-5 space-y-1.5 mb-3">
              <li>按下方「複製程式碼」。</li>
              <li>
                用電腦開啟{" "}
                <a href="https://www.cpbl.com.tw/schedule" target="_blank" rel="noopener noreferrer" className="link">
                  中職官網賽程頁
                </a>
                ，等頁面載入完成。
              </li>
              <li>按鍵盤 F12，點上方的「Console（主控台）」分頁。</li>
              <li>在最下方貼上程式碼並按 Enter。第一次貼上時 Chrome 可能要求先輸入 allow pasting 再按 Enter。</li>
              <li>看到「已複製 N 筆賽程」後，回到這一頁，貼到下面的方框並按「匯入官網賽程」。</li>
            </ol>
            <CopySnippet />
            <p className="text-xs text-faint mt-3">這段程式只在官網頁面上讀取公開賽程並複製到剪貼簿，不會讀取或傳送你的任何帳號資料。</p>
          </details>
          <SectionTitle>貼上官網賽程</SectionTitle>
          <Card>
            <ImportForms isAdmin part="json" />
          </Card>
        </>
      ) : null}
    </>
  );
}
