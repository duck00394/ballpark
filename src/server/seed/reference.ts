import type { PrismaClient } from "@prisma/client";

// 中華職棒六隊（代碼取自官網賽程資料）
export const CPBL_TEAMS = [
  { code: "ACN011", name: "中信兄弟", shortName: "兄弟" },
  { code: "AJL011", name: "樂天桃猿", shortName: "桃猿" },
  { code: "ADD011", name: "統一7-ELEVEn獅", shortName: "統一獅" },
  { code: "AEO011", name: "富邦悍將", shortName: "悍將" },
  { code: "AAA011", name: "味全龍", shortName: "味全龍" },
  { code: "AKP011", name: "台鋼雄鷹", shortName: "雄鷹" },
];

// 官網使用的球場簡稱 → 顯示名稱
export const CPBL_VENUES = [
  { sourceName: "洲際", name: "臺中洲際棒球場", city: "臺中市" },
  { sourceName: "大巨蛋", name: "臺北大巨蛋", city: "臺北市" },
  { sourceName: "天母", name: "天母棒球場", city: "臺北市" },
  { sourceName: "新莊", name: "新莊棒球場", city: "新北市" },
  { sourceName: "樂天桃園", name: "樂天桃園棒球場", city: "桃園市" },
  { sourceName: "亞太主", name: "臺南亞太國際棒球訓練中心主球場", city: "臺南市" },
  { sourceName: "澄清湖", name: "澄清湖棒球場", city: "高雄市" },
  { sourceName: "嘉義市", name: "嘉義市立棒球場", city: "嘉義市" },
  { sourceName: "斗六", name: "斗六棒球場", city: "雲林縣" },
  { sourceName: "花蓮", name: "花蓮德興棒球場", city: "花蓮縣" },
  { sourceName: "台東", name: "臺東棒球場", city: "臺東縣" },
];

// 常用售票平台：只記錄官方網址，不宣稱 App 跳轉；需要時可在 APP 內自行新增或補上網址
export const DEFAULT_PLATFORMS = [
  { name: "拓元售票 tixCraft", webUrl: "https://tixcraft.com" },
  { name: "KKTIX", webUrl: "https://kktix.com" },
  { name: "ibon 售票", webUrl: "https://ticket.ibon.com.tw" },
  { name: "年代售票", webUrl: "https://www.ticket.com.tw" },
  { name: "現場購票", webUrl: null },
  { name: "其他", webUrl: null },
];

export const DEFAULT_PAYMENT_METHODS = ["現金", "銀行轉帳", "LINE Pay", "街口支付", "其他"];

export async function seedReference(db: PrismaClient) {
  for (const t of CPBL_TEAMS)
    await db.team.upsert({
      where: { league_code: { league: "CPBL", code: t.code } },
      create: { league: "CPBL", ...t },
      update: {},
    });
  for (const v of CPBL_VENUES)
    await db.venue.upsert({ where: { sourceName: v.sourceName }, create: v, update: {} });
  for (const p of DEFAULT_PLATFORMS) {
    const ex = await db.ticketPlatform.findFirst({ where: { groupId: null, name: p.name } });
    if (!ex) await db.ticketPlatform.create({ data: { ...p, groupId: null } });
  }
  for (const name of DEFAULT_PAYMENT_METHODS) {
    const ex = await db.paymentMethod.findFirst({ where: { groupId: null, name } });
    if (!ex) await db.paymentMethod.create({ data: { name, groupId: null } });
  }
}
