/**
 * 端對端測試：以真實瀏覽器操作正式建置的 APP，模擬 4 位朋友的完整流程，並檢查手機版面。
 *
 * 需求：已執行 `next build`，且環境變數
 *   E2E_BASE_URL（預設 http://localhost:3100）
 *   CHROME_PATH（Chromium 執行檔）
 *   DATABASE_URL（E2E 專用資料庫，需包含 _e2e）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const OUT = path.join(__dirname, "../../e2e-output");
fs.mkdirSync(OUT, { recursive: true });
if (!process.env.DATABASE_URL?.includes("_e2e")) throw new Error("E2E 必須使用 _e2e 資料庫");

const db = new PrismaClient();
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/cpbl-2026.json"), "utf8"));
const results = [];
let failed = 0;
function ok(name) {
  results.push({ name, ok: true });
  console.log(`  ✓ ${name}`);
}
function bad(name, detail) {
  failed++;
  results.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}\n    ${detail}`);
}
async function step(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    bad(name, e instanceof Error ? e.message.split("\n").slice(0, 30).join("\n    ") : String(e));
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  headless: true,
});

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "zh-TW", timezoneId: "Asia/Taipei" };
async function newUser() {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  page._log = [];
  const L = (x) => (page._log.push(x), page._log.length > 25 && page._log.shift());
  page.on("request", (r) => !r.url().includes("/_next/static") && L(`→ ${r.method()} ${r.url().replace(BASE, "")}`));
  page.on("requestfinished", (r) => !r.url().includes("/_next/static") && L(`✓ ${r.method()} ${r.url().replace(BASE, "")}`));
  page.on("requestfailed", (r) => L(`✗ ${r.url().replace(BASE, "")} ${r.failure()?.errorText}`));
  page.on("pageerror", (e) => L(`pageerror ${e.message.slice(0, 200)}`));
  page.on("console", (m) => m.type() === "error" && L(`console ${m.text().slice(0, 200)}`));
  page.on("dialog", (d) => d.accept());
  page.setDefaultTimeout(15000);
  return { ctx, page };
}
const go = async (page, url) => {
  await page.goto(BASE + url, { waitUntil: "networkidle" });
};
/** 點擊送出並等待 Server Action 回應（避免只看 networkidle 造成的時序誤判） */
async function submit(page, buttonText, scope) {
  const root = scope ?? page;
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === "POST", { timeout: 20000 }),
    root.getByRole("button", { name: buttonText, exact: true }).first().click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  const errs = await page.locator(".msg-error:visible").allInnerTexts();
  if (errs.length) throw new Error(`送出「${buttonText}」後出現錯誤：${errs.join(" / ")}`);
}
async function login(page, username, password) {
  await go(page, "/login");
  await page.fill("input[name=username]", username);
  await page.fill("input[name=password]", password);
  await page.getByRole("button", { name: "登入" }).click();
  await page.waitForURL(BASE + "/", { timeout: 15000 });
}
/** 等待用戶端導覽（router.push）完成 */
async function waitPath(page, re) {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(location.pathname), re.source, { timeout: 20000 });
  } catch {
    throw new Error(`沒有導向 ${re}；目前 ${page.url()}；訊息：${(await page.locator(".msg").allInnerTexts()).join("/")}\n${page._log.join("\n")}`);
  }
  await page.waitForLoadState("networkidle");
}
const text = async (page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");
const ticketCard = (page, seq) => page.locator(`article[data-ticket-seq="${seq}"]`);
const ledgerRow = (page, who) => page.locator(`[data-ledger-from="${who}"]`);

const PW = "baseball-2026";
const users = { A: "ajie", B: "bobo", C: "cici", D: "dada" };
const names = { A: "阿傑", B: "小波", C: "西西", D: "大大" };

console.log("\nG. 4 位朋友完整流程");
const A = await newUser();
let orderId, order2Id, gameE4Id, game2Id;

await step("首次設定：建立管理者與私人群組", async () => {
  await go(A.page, "/");
  expect(A.page.url().endsWith("/setup"), `未導向首次設定頁，目前 ${A.page.url()}`);
  await A.page.fill("input[name=groupName]", "週末看球團");
  await A.page.fill("input[name=displayName]", names.A);
  await A.page.fill("input[name=username]", users.A);
  await A.page.fill("input[name=password]", PW);
  await A.page.fill("input[name=password2]", PW);
  await submit(A.page, "建立並登入");
  await A.page.waitForURL(BASE + "/");
  await A.page.getByText(`嗨，${names.A}`).waitFor();
});

await step("1. 管理者新增 3 位朋友，各自用獨立帳號登入同一群組", async () => {
  for (const k of ["B", "C", "D"]) {
    await go(A.page, "/me/members");
    await A.page.fill("input[name=displayName]", names[k]);
    await A.page.fill("input[name=username]", users[k]);
    await A.page.fill("input[name=password]", PW);
    await submit(A.page, "新增成員");
    await A.page.getByText("已新增成員").waitFor();
  }
  expect((await db.groupMember.count()) === 4, "成員數不是 4");
});
const B = await newUser();
const C = await newUser();
const D = await newUser();
await step("其他 3 人登入成功", async () => {
  await login(B.page, users.B, PW);
  await login(C.page, users.C, PW);
  await login(D.page, users.D, PW);
});

await step("2. 匯入官網賽程（實際取得的季後挑戰賽資料）並選擇比賽", async () => {
  await go(A.page, "/games/import");
  await A.page.fill("textarea[name=json]", JSON.stringify(fx.E));
  await submit(A.page, "匯入官網賽程");
  await A.page.getByText(/匯入 4 場；新增 4/).waitFor();
  gameE4Id = (await db.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:E:4" } })).id;
  await go(A.page, "/games?month=2026-10");
  const t = await text(A.page);
  expect(t.includes("統一7-ELEVEn獅") && t.includes("中信兄弟"), "賽程列表沒有顯示匯入的比賽");
  await go(A.page, `/games/${gameE4Id}`);
  expect((await text(A.page)).includes("一軍季後挑戰賽"), "比賽頁沒有賽事類型");
});

await step("3+4. A 建立一筆訂單，一次建立 4 張票（從賽程選擇，不需再輸入球隊日期）", async () => {
  await A.page.getByRole("link", { name: "為這場新增購票" }).click();
  await A.page.waitForURL(/\/orders\/new\?gameId=/);
  await A.page.waitForLoadState("networkidle");
  expect(!(await A.page.locator("input[name=date]").count()), "選了賽程卻仍要求輸入日期");
  await A.page.fill("input[name=pricePerTicket]", "650");
  await A.page.fill("input[name=feeAmount]", "80");
  for (let i = 0; i < 3; i++) await A.page.getByRole("button", { name: "增加一張" }).click();
  await A.page.getByRole("button", { name: "依序分給每人" }).click();
  await A.page.getByText("連號座位快速填寫").click();
  await A.page.getByLabel("區域", { exact: true }).fill("內野B區一壘側上層靠走道這是一個非常長的區域名稱用來測試換行");
  await A.page.getByLabel("排", { exact: true }).fill("12");
  await A.page.getByLabel("起始座號").fill("5");
  await A.page.getByRole("button", { name: "套用到所有票" }).click();
  const preview = await A.page.locator("section", { hasText: "分攤預覽" }).innerText();
  expect(preview.includes("NT$ 2,680"), `預覽總額錯誤：${preview}`);
  await A.page.screenshot({ path: `${OUT}/order-new-390.png`, fullPage: true });
  await submit(A.page, "建立訂單與 4 張票");
  await waitPath(A.page, /^\/orders\/c/);
  orderId = A.page.url().split("/orders/")[1].split(/[?#]/)[0];
  expect((await db.ticket.count({ where: { orderId } })) === 4, "票券數不是 4");
  const seats = (await db.ticket.findMany({ where: { orderId }, orderBy: { seq: "asc" } })).map((t) => t.seatNumber).join(",");
  expect(seats === "5,6,7,8", `座位錯誤：${seats}`);
});

await step("5. 指定 3 張票給其他朋友（每張不同持有人與座位）", async () => {
  const t = await db.ticket.findMany({ where: { orderId }, orderBy: { seq: "asc" } });
  const ids = await db.user.findMany({ select: { id: true, username: true } });
  const by = Object.fromEntries(ids.map((u) => [u.username, u.id]));
  expect(t.map((x) => x.holderId).join() === [by.ajie, by.bobo, by.cici, by.dada].join(), "持有人分配錯誤");
  const body = await text(A.page);
  for (const k of ["B", "C", "D"]) expect(body.includes(`${names[k]} → ${names.A}`), `帳目缺少 ${names[k]}`);
});

await step("6. 更新分票與取票狀態（A 標記交付並填序號、B 確認收到、C 標記已取票）", async () => {
  const t2 = await db.ticket.findFirstOrThrow({ where: { orderId, seq: 2 } });
  await go(A.page, `/tickets/${t2.id}`);
  await A.page.selectOption("select[name=transferStatus]", "DELIVERED");
  await A.page.fill("textarea[name=secretInfo]", "SERIAL-B-0002");
  await submit(A.page, "儲存票券");
  await A.page.getByText("票券已更新").waitFor();
  await go(B.page, `/orders/${orderId}`);
  await submit(B.page, "我已收到票", ticketCard(B.page, 2));
  await go(C.page, `/orders/${orderId}`);
  await submit(C.page, "我已收到票", ticketCard(C.page, 3));
  await go(C.page, `/orders/${orderId}`);
  await submit(C.page, "標記已取票", ticketCard(C.page, 3));
  const [x2, x3, x4] = await db.ticket.findMany({ where: { orderId, seq: { in: [2, 3, 4] } }, orderBy: { seq: "asc" } });
  expect(x2.transferStatus === "DELIVERED" && x2.receivedConfirmedAt, "第 2 張狀態錯誤");
  expect(x3.pickupStatus === "PICKED" && x3.transferStatus === "DELIVERED", "第 3 張狀態錯誤");
  expect(x4.transferStatus === "ASSIGNED" && x4.pickupStatus === "NOT_PICKED", "第 4 張不應被連帶改變");
  // 敏感資訊權限
  await go(B.page, `/tickets/${x2.id}`);
  expect((await text(B.page)).includes("SERIAL-B-0002"), "持有人看不到自己的票券序號");
  await go(D.page, `/tickets/${x2.id}`);
  const dv = await text(D.page);
  expect(!dv.includes("SERIAL-B-0002") && dv.includes("只有購票人、持有人與管理者可見"), "其他成員看得到別人的序號");
});

async function pay(u, amount, opts = {}) {
  await go(u.page, `/orders/${orderId}`);
  await u.page.getByRole("button", { name: "我付款" }).click();
  await u.page.fill("input[name=amount]", String(amount));
  const btn = u.page.getByRole("button", { name: "記錄付款" });
  const before = await db.payment.count();
  await Promise.all([u.page.waitForResponse((r) => r.request().method() === "POST"), opts.dbl ? btn.dblclick() : btn.click()]);
  await u.page.getByText("付款已記錄，帳目已更新").waitFor();
  expect((await db.payment.count()) === before + 1, `付款 ${amount} 未寫入或重複寫入`);
}

await step("7. 其他朋友分次付款（B 先付 100 再付 200；C 付 400 再付 270，含雙擊測試）", async () => {
  await pay(B, 100);
  await pay(B, 200);
  await pay(C, 400, { dbl: true });
  await pay(C, 270);
  const n = await db.payment.count({ where: { orderId } });
  expect(n === 4, `付款筆數應為 4（雙擊不可重複），實際 ${n}`);
});

await step("8. 系統正確計算應付、已付、尚欠（部分付款／已付清／未付款）", async () => {
  await go(A.page, `/orders/${orderId}`);
  const rb = await ledgerRow(A.page, names.B).innerText();
  const rc = await ledgerRow(A.page, names.C).innerText();
  const rd = await ledgerRow(A.page, names.D).innerText();
  expect(rb.includes("部分付款") && rb.includes("NT$ 670") && rb.includes("NT$ 300") && rb.includes("NT$ 370"), `B 帳目錯誤：${rb}`);
  expect(rc.includes("已付清"), `C 帳目錯誤：${rc}`);
  expect(rd.includes("未付款") && rd.includes("NT$ 670"), `D 帳目錯誤：${rd}`);
  // A（收款人）確認 B 的付款
  const before = await db.payment.count({ where: { orderId, payeeConfirmedAt: { not: null } } });
  await submit(A.page, "確認");
  const after = await db.payment.count({ where: { orderId, payeeConfirmedAt: { not: null } } });
  expect(after === before + 1, "收款確認沒有寫入");
  await A.page.screenshot({ path: `${OUT}/order-detail-390.png`, fullPage: true });
});

await step("網路中斷時明確提示資料尚未儲存", async () => {
  await go(A.page, `/orders/${orderId}`);
  await ledgerRow(A.page, names.D).getByRole("button", { name: "記錄收款" }).click();
  await A.page.route("**/*", (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue()));
  await A.page.getByRole("button", { name: "記錄付款" }).click();
  await A.page.getByText("網路連線失敗，資料尚未儲存").waitFor();
  await A.page.unroute("**/*");
  expect((await db.payment.count({ where: { orderId, payerId: (await db.user.findUniqueOrThrow({ where: { username: users.D } })).id } })) === 0, "斷線時卻寫入了付款");
});

await step("9. B 手動建立第二場比賽並建立購票訂單（A、D 各一張）", async () => {
  await go(B.page, "/games/new");
  await B.page.fill("input[name=date]", "2026-10-18");
  await B.page.fill("input[name=time]", "17:05");
  const team = async (n) => (await db.team.findFirstOrThrow({ where: { name: n } })).id;
  await B.page.selectOption("select[name=awayTeamId]", await team("富邦悍將"));
  await B.page.selectOption("select[name=homeTeamId]", await team("中信兄弟"));
  await B.page.selectOption("select[name=venueId]", { label: "臺北大巨蛋" });
  await submit(B.page, "新增比賽");
  await waitPath(B.page, /^\/games\/c/);
  game2Id = B.page.url().split("/games/")[1].split(/[?#]/)[0];
  await B.page.getByRole("link", { name: "為這場新增購票" }).click();
  await B.page.waitForURL(/\/orders\/new/);
  await B.page.waitForLoadState("networkidle");
  await B.page.fill("input[name=pricePerTicket]", "500");
  for (let i = 0; i < 2; i++) await B.page.getByRole("button", { name: "增加一張" }).click();
  const uid = async (u) => (await db.user.findUniqueOrThrow({ where: { username: u } })).id;
  await B.page.selectOption("select[name=t0_holderId]", await uid(users.B));
  await B.page.selectOption("select[name=t1_holderId]", await uid(users.A));
  await B.page.selectOption("select[name=t2_holderId]", await uid(users.D));
  await submit(B.page, "建立訂單與 3 張票");
  await waitPath(B.page, /^\/orders\/c/);
  order2Id = B.page.url().split("/orders/")[1].split(/[?#]/)[0];
});

await step("10. 跨場次彙總：A 對 B 淨額 = 500 − 370 = 130（A 應付 B）", async () => {
  await go(A.page, "/settle");
  const card = A.page.locator("section.card", { hasText: "淨額：我應付 小波" });
  const t = await card.innerText();
  expect(t.includes("NT$ 130"), `淨額錯誤：${t}`);
  expect(t.includes("我欠 小波：NT$ 500") && t.includes("小波 欠我：NT$ 370"), `原始金額錯誤：${t}`);
  await A.page.screenshot({ path: `${OUT}/settle-390.png`, fullPage: true });
});

await step("11. 建立結算紀錄：原始帳目保留、兩場都顯示已付清", async () => {
  const oblBefore = await db.obligation.count({ where: { active: true } });
  const card = A.page.locator("section.card", { hasText: "淨額：我應付 小波" });
  await card.getByRole("button", { name: "我已付淨額，結清" }).click();
  await submit(A.page, "確認結算", card);
  await A.page.getByText("結算已完成").waitFor();
  const s = await db.settlement.findFirstOrThrow({ include: { items: true, payment: true } });
  expect(s.netAmount === 130 && s.items.length === 2 && s.payment?.amount === 130, "結算紀錄內容錯誤");
  expect((await db.obligation.count({ where: { active: true } })) === oblBefore, "原始應付紀錄被改動");
  await go(A.page, `/orders/${orderId}`);
  expect((await ledgerRow(A.page, names.B).innerText()).includes("已付清"), "第一場 B 未顯示已付清");
  await go(A.page, `/orders/${order2Id}`);
  expect((await ledgerRow(A.page, names.A).innerText()).includes("已付清"), "第二場 A 未顯示已付清");
  // 重新整理後再結算一次：不應再有可結算項目
  await go(A.page, "/settle");
  expect(!(await A.page.locator("section.card", { hasText: "淨額：我應付 小波" }).count()), "已結清後仍出現可結算項目");
});

await step("12. 比賽結束後同步最終比分（官網資料流程）；第二場手動輸入和局", async () => {
  const rows = JSON.parse(fx.E.GameDatas).map((r) =>
    r.GameSno === 4 ? { ...r, GameResult: "0", VisitingScore: 3, HomeScore: 5, GameDateTimeE: "2026-10-12T21:40:00" } : r,
  );
  await go(A.page, "/games/import");
  await A.page.fill("textarea[name=json]", JSON.stringify({ Success: true, GameDatas: JSON.stringify(rows) }));
  await submit(A.page, "匯入官網賽程");
  await A.page.getByText(/更新 1/).waitFor();
  const g = await db.game.findUniqueOrThrow({ where: { id: gameE4Id } });
  expect(g.status === "FINAL" && g.homeScore === 5 && g.awayScore === 3 && g.resultConfirmed, "比分未更新");
  expect((await db.ticket.count({ where: { orderId } })) === 4 && (await db.payment.count({ where: { orderId } })) === 4, "同步影響了購票資料");
  // 第二場：B 手動輸入結果
  await go(B.page, `/games/${game2Id}`);
  await B.page.getByText("更新比分與狀態").click();
  await B.page.selectOption("select[name=status]", "FINAL");
  await B.page.fill("input[name=awayScore]", "2");
  await B.page.fill("input[name=homeScore]", "2");
  await B.page.check("input[name=resultConfirmed]");
  await submit(B.page, "儲存結果");
  await B.page.getByText("比賽結果已更新").waitFor();
});

async function attend(u, gameId, status, team) {
  await go(u.page, `/games/${gameId}`);
  const form = u.page.locator("#attendance form");
  await form.locator(`input[name=status][value=${status}]`).check();
  if (team) await form.getByLabel(team, { exact: true }).check();
  else await form.getByLabel("不選邊").check();
  await submit(u.page, "儲存觀賽紀錄");
  await u.page.getByText("觀賽紀錄已更新").waitFor();
}

await step("13. 每位成員依自己的支持球隊計算觀賽勝敗", async () => {
  await attend(A, gameE4Id, "ATTENDED", "中信兄弟");
  await attend(B, gameE4Id, "ATTENDED", "統一7-ELEVEn獅");
  await attend(C, gameE4Id, "ATTENDED", "中信兄弟");
  await attend(D, gameE4Id, "ABSENT", "中信兄弟");
  await attend(A, game2Id, "ATTENDED", "中信兄弟");
  await attend(B, game2Id, "ATTENDED", "富邦悍將");
  await attend(D, game2Id, "ATTENDED", "中信兄弟");
  const expectStat = async (u, games, wlt, who) => {
    await go(u.page, "/me?year=2026");
    const t = await text(u.page);
    const m = t.match(/到場場次 (\d+) 勝－敗－和 (\d+-\d+-\d+)/);
    expect(m && m[1] === String(games) && m[2] === wlt, `${who} 統計錯誤：${m ? m.slice(1).join(" / ") : t.slice(0, 200)}`);
  };
  await expectStat(A, 2, "1-0-1", "A");
  await expectStat(B, 2, "0-1-1", "B");
  await expectStat(C, 1, "1-0-0", "C");
  await expectStat(D, 1, "0-0-1", "D");
  await A.page.screenshot({ path: `${OUT}/me-390.png`, fullPage: true });
});

await step("14. 匯出資料並驗證完整性（CSV、Excel、完整備份 → 還原前檢查）", async () => {
  const csv = await (await A.ctx.request.get(`${BASE}/api/export?set=orders&format=csv`)).text();
  expect(csv.includes(orderId) && csv.includes(order2Id), "訂單 CSV 缺少訂單 ID");
  const money = await (await A.ctx.request.get(`${BASE}/api/export?set=money&format=csv`)).text();
  expect(money.includes("結算付款") && (money.match(/\n付款,/g) ?? []).length === 4, "付款 CSV 筆數錯誤");
  const xlsx = await A.ctx.request.get(`${BASE}/api/export?format=xlsx`);
  const buf = await xlsx.body();
  expect(xlsx.status() === 200 && buf.subarray(0, 2).toString() === "PK", "Excel 匯出失敗");
  const backupRes = await A.ctx.request.get(`${BASE}/api/backup`);
  const backup = await backupRes.json();
  expect(backup.orders.length === 2 && backup.tickets.length === 7 && backup.payments.length === 5 && backup.settlementItems.length === 2, "完整備份內容數量錯誤");
  const file = path.join(OUT, "backup.json");
  fs.writeFileSync(file, JSON.stringify(backup));
  await go(A.page, "/me/data");
  await A.page.setInputFiles("input[name=file]", file);
  await submit(A.page, "檢查備份檔");
  await A.page.getByText("檢查結果：可以還原").waitFor();
  // 一般成員不能下載完整備份
  const r = await B.ctx.request.get(`${BASE}/api/backup`);
  expect(r.status() === 403, `一般成員下載備份應被拒絕，實際 ${r.status()}`);
});

await step("還原：輸入確認文字後，以備份取代目前資料，帳目一致", async () => {
  const beforeLedger = await db.obligation.count({ where: { active: true } });
  await db.payment.updateMany({ where: { orderId }, data: { status: "REVOKED" } }); // 模擬誤操作
  await A.page.fill("input[name=confirm]", "確認還原");
  await submit(A.page, "取代目前資料並還原");
  await A.page.getByText("還原完成").waitFor();
  expect((await db.payment.count({ where: { orderId, status: "VALID" } })) === 4, "還原後付款未恢復");
  expect((await db.obligation.count({ where: { active: true } })) === beforeLedger, "還原後應付紀錄不一致");
});

console.log("\nA. 權限（HTTP 層）");
await step("未登入：頁面導向登入、API 回應 401", async () => {
  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto(`${BASE}/orders/${orderId}`);
  expect(p.url().includes("/login"), "未登入可看到訂單");
  for (const u of ["/api/export?set=orders", "/api/backup", "/api/check-url?url=https://example.com"]) {
    const r = await anon.request.get(BASE + u);
    expect(r.status() === 401, `${u} 未登入回應 ${r.status()}`);
  }
  const cron = await anon.request.get(`${BASE}/api/cron/sync`);
  expect(cron.status() === 401, "排程同步端點未驗證");
  await anon.close();
});

await step("其他群組的使用者修改網址中的 ID 也讀不到", async () => {
  const g2 = await db.group.create({ data: { name: "別的群組" } });
  const x = await db.user.create({ data: { username: "outsider", displayName: "外人", passwordHash: await bcrypt.hash(PW, 10) } });
  await db.groupMember.create({ data: { groupId: g2.id, userId: x.id, role: "ADMIN" } });
  const X = await newUser();
  await login(X.page, "outsider", PW);
  const t = await db.ticket.findFirstOrThrow({ where: { orderId, seq: 2 } });
  for (const u of [`/orders/${orderId}`, `/tickets/${t.id}`, `/games/${game2Id}`]) {
    await go(X.page, u);
    expect((await X.page.locator("body").innerText()).includes("找不到資料"), `外人可以看到 ${u}`);
  }
  const csv = await (await X.ctx.request.get(`${BASE}/api/export?set=orders`)).text();
  expect(!csv.includes(orderId), "外人匯出含有別群組訂單");
  await go(X.page, "/settle");
  expect(!(await text(X.page)).includes(names.A), "外人結算頁出現別群組成員");
  await X.ctx.close();
});

console.log("\n送出穩定性（回歸測試：曾發現表單偶爾停在「處理中」）");
await step("連續 25 次送出表單，每次都在 5 秒內完成並顯示結果", async () => {
  const slow = [];
  for (let i = 0; i < 25; i++) {
    await go(C.page, `/games/${gameE4Id}`);
    const form = C.page.locator("#attendance form");
    await form.locator(`input[name=status][value=${i % 2 ? "ATTENDED" : "PLANNED"}]`).check();
    const t0 = Date.now();
    await form.getByRole("button", { name: "儲存觀賽紀錄" }).click();
    try {
      await C.page.locator("#attendance .msg-ok").waitFor({ timeout: 5000 });
    } catch {
      slow.push(i);
    }
    if (Date.now() - t0 > 5000) slow.push(i);
  }
  await attend(C, gameE4Id, "ATTENDED", "中信兄弟");
  expect(slow.length === 0, `第 ${slow.join("、")} 次送出沒有完成`);
});

console.log("\nF. 手機介面");
const pages = [
  ["首頁", "/"],
  ["賽事列表", "/games?month=2026-10"],
  ["賽事月曆", "/games?month=2026-10&view=cal"],
  ["比賽詳情", () => `/games/${gameE4Id}`],
  ["新增購票", () => `/orders/new?gameId=${gameE4Id}`],
  ["訂單詳情", () => `/orders/${orderId}`],
  ["票券", "/tickets?scope=all&past=1"],
  ["結算", "/settle"],
  ["個人", "/me?year=2026"],
  ["資料匯出", "/me/data"],
  ["成員管理", "/me/members"],
];
const viewports = [
  ["iPhone SE 375×667", { width: 375, height: 667 }],
  ["iPhone 15 390×844", { width: 390, height: 844 }],
  ["iPhone Pro Max 430×932", { width: 430, height: 932 }],
];
for (const [vpName, vp] of viewports) {
  const ctx = await browser.newContext({ ...PHONE, viewport: vp });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=username]", users.A);
  await p.fill("input[name=password]", PW);
  await p.getByRole("button", { name: "登入" }).click();
  await p.waitForURL(BASE + "/");
  for (const [name, u] of pages) {
    await step(`${vpName}・${name}`, async () => {
      await p.goto(BASE + (typeof u === "function" ? u() : u), { waitUntil: "networkidle" });
      const r = await p.evaluate(() => {
        const issues = [];
        const de = document.documentElement;
        if (de.scrollWidth > window.innerWidth + 1) issues.push(`水平捲動 ${de.scrollWidth}>${window.innerWidth}`);
        for (const el of document.querySelectorAll("main *")) {
          const r = el.getBoundingClientRect();
          if (r.width && r.right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed" && !el.closest(".chip-row, .overflow-x-auto, pre, table"))
            issues.push(`超出畫面：${el.tagName}.${el.className}`.slice(0, 90));
        }
        const small = [];
        for (const el of document.querySelectorAll("main button, main a.btn, main .chip, nav.bottom-nav a, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]), main select")) {
          const r = el.getBoundingClientRect();
          if (r.height && r.height < 36) small.push(`${el.tagName}「${(el.textContent || el.getAttribute("name") || "").trim().slice(0, 10)}」${Math.round(r.height)}px`);
        }
        if (small.length) issues.push(`點擊區域過小：${small.slice(0, 4).join("、")}`);
        window.scrollTo(0, de.scrollHeight);
        const nav = document.querySelector("nav.bottom-nav")?.getBoundingClientRect();
        const main = document.querySelector("main");
        const last = main?.lastElementChild?.getBoundingClientRect();
        if (nav && last && last.bottom > nav.top + 1) issues.push(`底部導覽遮住內容 ${Math.round(last.bottom)}>${Math.round(nav.top)}`);
        return [...new Set(issues)];
      });
      if (vp.width === 390) await p.screenshot({ path: `${OUT}/${name}-390.png`, fullPage: false });
      expect(r.length === 0, r.slice(0, 4).join("；"));
    });
  }
  await ctx.close();
}

await browser.close();
await db.$disconnect();
fs.writeFileSync(path.join(OUT, "e2e-results.json"), JSON.stringify(results, null, 1));
console.log(`\n端對端測試：${results.length - failed} 通過、${failed} 失敗（共 ${results.length} 項）`);
process.exit(failed ? 1 : 0);
