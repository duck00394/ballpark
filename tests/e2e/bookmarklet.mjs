// 書籤匯入流程測試：以 Playwright 攔截 www.cpbl.com.tw，提供與官網相同結構的頁面與 API（使用實際取得的資料），
// 在該頁面執行 APP 產生的書籤程式碼，確認會開啟 APP 接收頁並完成匯入。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/cpbl-2026.json"), "utf8"));
const db = new PrismaClient();
let fail = 0;
const ok = (c, m) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fail++; };

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-TW" });
let posted = [];
await ctx.route("https://www.cpbl.com.tw/**", async (route) => {
  const req = route.request();
  if (req.url().endsWith("/schedule"))
    return route.fulfill({ contentType: "text/html", body: `<html><body>賽程<script>
      $.ajax({ url: '/schedule/getgamedatas', type: 'POST', data: filterData, headers: { RequestVerificationToken: 'TOKEN-XYZ' } })
    </script></body></html>` });
  if (req.url().endsWith("/schedule/getgamedatas")) {
    const kind = new URLSearchParams(req.postData()).get("kindCode");
    posted.push({ kind, token: req.headers()["requestverificationtoken"] });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(fx[kind] ?? { Success: true, GameDatas: "[]" }) });
  }
  return route.fulfill({ status: 404, body: "" });
});
const p = await ctx.newPage();
await p.goto(BASE + "/login");
await p.fill("input[name=username]", "ajie"); await p.fill("input[name=password]", "baseball-2026");
await p.getByRole("button", { name: "登入" }).click(); await p.waitForURL(BASE + "/");
await p.goto(BASE + "/games/import", { waitUntil: "networkidle" });
const href = await p.getByRole("link", { name: "看球帳本匯入" }).getAttribute("href");
ok(href?.startsWith("javascript:"), "匯入頁產生了書籤連結");

const before = await db.game.count({ where: { source: "CPBL" } });
await db.game.deleteMany({ where: { externalKey: { startsWith: "cpbl:2026:A:" } , orders: { none: {} }, tickets: { none: {} }, attendances: { none: {} } } });
const cp = await ctx.newPage();
await cp.goto("https://www.cpbl.com.tw/schedule");
const code = decodeURIComponent(href.slice("javascript:".length));
const [popup] = await Promise.all([ctx.waitForEvent("page"), cp.evaluate((c) => { (0, eval)(c); }, code)]);
await popup.waitForLoadState();
ok(popup.url().includes("/games/import?receive=1"), "按書籤後開啟了 APP 接收頁");
await popup.getByText(/匯入 \d+ 場/).waitFor({ timeout: 20000 });
const msg = await popup.locator(".msg-ok").innerText();
ok(/匯入 13 場/.test(msg), `匯入結果：${msg}`);
ok(posted.length === 3 && posted.every((x) => x.token === "TOKEN-XYZ"), "使用官網頁面的驗證資訊取得 A、E、C 三種賽事");
const g = await db.game.findUnique({ where: { externalKey: "cpbl:2026:A:14" } });
ok(g?.status === "FINAL" && g.homeScore === 4 && g.awayScore === 7, "延賽兩次的比賽正確合併並帶入比分");
await popup.getByRole("link", { name: "查看賽程" }).click();
await popup.waitForURL(/\/games$/);
ok(true, "可從接收頁回到賽程");

// 非官網頁面按書籤：提示而不開新分頁
const other = await ctx.newPage();
await other.goto(BASE + "/");
let alerted = "";
other.on("dialog", (d) => { alerted = d.message(); d.dismiss(); });
await other.evaluate((c) => { (0, eval)(c); }, code);
await other.waitForTimeout(500);
ok(alerted.includes("中職官網"), "在其他網站按書籤會提示要先打開官網賽程頁");
console.log(`\n書籤匯入測試：${fail ? `${fail} 項失敗` : "全部通過"}（匯入前官方賽程 ${before} 場）`);
await b.close(); await db.$disconnect();
process.exit(fail ? 1 : 0);
