import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireActor } from "@/server/session";
import { ImportForms } from "./forms";
import { CopySnippet } from "./copy-snippet";

export const metadata = { title: "匯入賽程" };

export default async function ImportPage() {
  const actor = await requireActor();
  return (
    <>
      <PageHeader title="匯入賽程" back="/games" />
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
          <SectionTitle>從官網一鍵複製賽程（管理者）</SectionTitle>
          <Card>
            <p className="text-sm text-muted mb-3">伺服器無法連上官網時使用。需要用電腦的 Chrome 或 Edge：</p>
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
            <p className="text-xs text-faint mt-3">這段程式只在官網頁面上讀取公開賽程並複製到剪貼簿，不會讀取或傳送你的任何帳號資料。匯入以官網場次編號辨識，重複匯入不會產生重複比賽，也不會影響購票資料。</p>
          </Card>
          <SectionTitle>貼上官網賽程</SectionTitle>
          <Card>
            <ImportForms isAdmin part="json" />
          </Card>
        </>
      ) : null}
    </>
  );
}
