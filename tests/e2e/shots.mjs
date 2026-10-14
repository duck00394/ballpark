// 主要頁面完整截圖（390×844，iPhone 15 尺寸）
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = process.argv[2];
const db = new PrismaClient();
const g = await db.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:E:4" } });
const o = await db.ticketOrder.findFirstOrThrow({ where: { gameId: g.id }, orderBy: { createdAt: "asc" } });
const g2 = await db.game.findFirstOrThrow({ where: { groupId: { not: null } } });
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-TW", timezoneId: "Asia/Taipei" })).newPage();
await p.goto(BASE + "/login");
await p.fill("input[name=username]", process.env.SHOT_USER ?? "ajie");
await p.fill("input[name=password]", "baseball-2026");
await p.getByRole("button", { name: "登入" }).click();
await p.waitForURL(BASE + "/");
const pages = [["01-首頁", "/"], ["02-賽程列表", "/games?month=2026-10"], ["03-賽事月曆", "/games?month=2026-10&view=cal"], ["04-比賽詳情", `/games/${g.id}`], ["05-訂單詳情", `/orders/${o.id}`], ["06-我的票券", "/tickets?tab=todo"], ["06b-票券夾", `/tickets/game/${g2.id}`], ["06c-群組票券管理", "/tickets/manage?f=all&past=1"], ["07-結算", "/settle"], ["08-個人", "/me?year=2026"]];
for (const [name, url] of pages) {
  await p.goto(BASE + url, { waitUntil: "networkidle" });
  await p.addStyleTag({ content: ".page-header,.jump{position:static!important}.bottom-nav{display:none!important}" });
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}
await b.close();
await db.$disconnect();
console.log("ok");
