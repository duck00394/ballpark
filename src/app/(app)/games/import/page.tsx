import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireActor } from "@/server/session";
import { ImportForms } from "./forms";

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
          <SectionTitle>官網 JSON 匯入（管理者）</SectionTitle>
          <Card>
            <p className="text-sm text-muted mb-2">
              若伺服器無法連線到中華職棒官網，可在電腦瀏覽器開啟官網賽程頁，從開發者工具「網路」分頁找到 getgamedatas 請求，複製回應內容貼到這裡。
              匯入結果與自動同步相同（以官網場次編號辨識，不會重複，也不會影響購票資料）。
            </p>
            <ImportForms isAdmin part="json" />
          </Card>
        </>
      ) : null}
    </>
  );
}
