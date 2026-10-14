import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { createOrder } from "@/server/services/orders";
import { createManualGame, updateGameResult, teamSeasonRecords } from "@/server/services/games";
import { personalStats, setAttendance } from "@/server/services/stats";
import { createPayment, computeLedger, createSettlement } from "@/server/services/finance";
import { syncCpbl, importCpblJson, importCsvGames, manualSync } from "@/server/services/schedule";
import { analyzeBackup, buildBackup, collectExports, exportBackup, restoreBackup, toCsv, toXlsx } from "@/server/services/backup";
import { makeGroup, makeOfficialGame, resetDb, rid, team } from "../helpers";

let G: Awaited<ReturnType<typeof makeGroup>>;
beforeEach(async () => {
  await resetDb();
  G = await makeGroup(["我", "A", "B", "C"]);
});

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/cpbl-2026.json"), "utf8"));

/** 模擬官網：GET 賽程頁（含 token 與 cookie），POST 回傳指定資料 */
function fakeCpbl(responses: Record<string, unknown> | (() => never)) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (typeof responses === "function") responses();
    if (url.endsWith("/schedule"))
      return new Response(`<script>$.ajax({ url: '/schedule/getgamedatas', type: 'POST', data: filterData, headers: { RequestVerificationToken: 'TOKEN-123' } })</script>`, {
        status: 200,
        headers: { "set-cookie": "__RequestVerificationToken=COOKIE-ABC; path=/; HttpOnly" },
      });
    const kind = new URLSearchParams(String(init?.body)).get("kindCode")!;
    const body = (responses as Record<string, unknown>)[kind] ?? { Success: true, GameDatas: "[]" };
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function attendWithTicket(gameId: string, buyerIdx = 0, holders = [0, 1, 2, 3]) {
  const buyer = G.actors[buyerIdx];
  return createOrder(buyer, {
    gameId,
    buyerId: buyer.userId,
    pricePerTicket: 500,
    feeAmount: 0,
    otherFeeAmount: 0,
    feeSplitMode: "PER_TICKET",
    status: "PURCHASED",
    tickets: holders.map((i) => ({ holderId: G.users[i].id })),
  });
}

describe("D. 比賽結果與個人觀賽戰績", () => {
  it("每位成員依自己的支持球隊計算；不同支持互不影響；未到場不計", async () => {
    const [me, A, B, C] = G.actors;
    const brothers = await team("ACN011");
    const monkeys = await team("AJL011");
    const lions = await team("ADD011");
    const g = await makeOfficialGame({ home: "ACN011", away: "AJL011", date: "2026-09-01" });
    await attendWithTicket(g.id);
    await setAttendance(me, g.id, me.userId, { status: "ATTENDED", supportTeamId: brothers.id });
    await setAttendance(A, g.id, A.userId, { status: "ATTENDED", supportTeamId: monkeys.id });
    // B 支持統一獅：本場未參賽，選不到
    await expect(setAttendance(B, g.id, B.userId, { status: "ATTENDED", supportTeamId: lions.id })).rejects.toThrow(/參賽球隊/);
    await setAttendance(B, g.id, B.userId, { status: "ATTENDED", supportTeamId: null });
    await setAttendance(C, g.id, C.userId, { status: "ABSENT", supportTeamId: brothers.id });

    // 未開賽：不計勝敗
    expect((await personalStats(me, me.userId)).total).toMatchObject({ games: 1, w: 0, l: 0, t: 0 });

    // 主隊（兄弟）勝
    await updateGameResult(me, g.id, g.version, { status: "FINAL", homeScore: 5, awayScore: 3, resultConfirmed: true });
    expect((await personalStats(me, me.userId)).total).toMatchObject({ w: 1, l: 0 });
    expect((await personalStats(me, A.userId)).total).toMatchObject({ w: 0, l: 1 });
    expect((await personalStats(me, B.userId)).total).toMatchObject({ games: 1, w: 0, l: 0, t: 0 });
    expect((await personalStats(me, C.userId)).total).toMatchObject({ games: 0, w: 0, l: 0 }); // 未到場

    // 官方更正比分（客隊勝）→ 統計自動更新且不重複計入
    const v = (await prisma.game.findUniqueOrThrow({ where: { id: g.id } })).version;
    await updateGameResult(me, g.id, v, { status: "FINAL", homeScore: 3, awayScore: 4, resultConfirmed: true });
    const s = await personalStats(me, me.userId);
    expect(s.total).toMatchObject({ games: 1, w: 0, l: 1, t: 0 });
    expect((await personalStats(me, A.userId)).total).toMatchObject({ w: 1, l: 0 });
    expect(s.home).toBe(1);
    expect(await prisma.gameChange.count({ where: { gameId: g.id, field: "homeScore" } })).toBe(2);
  });

  it("和局、延期、取消、保留不計入勝敗；客隊勝正確", async () => {
    const [me] = G.actors;
    const brothers = await team("ACN011");
    const mk = async (date: string, home = "ACN011", away = "ADD011") => {
      const g = await makeOfficialGame({ home, away, date });
      await attendWithTicket(g.id, 0, [0]);
      await setAttendance(me, g.id, me.userId, { status: "ATTENDED", supportTeamId: brothers.id });
      return g;
    };
    const tie = await mk("2026-05-01");
    const post = await mk("2026-05-02");
    const canc = await mk("2026-05-03");
    const susp = await mk("2026-05-04");
    const awayWin = await mk("2026-05-05", "ADD011", "ACN011"); // 兄弟為客隊
    await updateGameResult(me, tie.id, 0, { status: "FINAL", homeScore: 2, awayScore: 2, resultConfirmed: true });
    await updateGameResult(me, post.id, 0, { status: "POSTPONED", homeScore: null, awayScore: null, resultConfirmed: false });
    await updateGameResult(me, canc.id, 0, { status: "CANCELLED", homeScore: null, awayScore: null, resultConfirmed: false });
    await updateGameResult(me, susp.id, 0, { status: "SUSPENDED", homeScore: 3, awayScore: 1, resultConfirmed: false });
    await updateGameResult(me, awayWin.id, 0, { status: "FINAL", homeScore: 1, awayScore: 6, resultConfirmed: true });
    await expect(updateGameResult(me, post.id, 1, { status: "POSTPONED", homeScore: null, awayScore: null, resultConfirmed: true })).rejects.toThrow(/只有比賽結束/);
    const s = await personalStats(me, me.userId);
    expect(s.total).toMatchObject({ games: 5, w: 1, l: 0, t: 1 });
    expect(s.total.pct).toBe(1);
    expect(s.away).toBe(1);
    expect(s.home).toBe(4);
  });

  it("球隊正式賽季戰績與個人到場戰績分開", async () => {
    const [me] = G.actors;
    const brothers = await team("ACN011");
    const dates = ["2026-06-01", "2026-06-02", "2026-06-03"];
    const games = [];
    for (const d of dates) games.push(await makeOfficialGame({ home: "ACN011", away: "AEO011", date: d }));
    for (const [i, g] of games.entries())
      await updateGameResult(me, g.id, 0, { status: "FINAL", homeScore: i === 0 ? 1 : 5, awayScore: 3, resultConfirmed: true });
    await attendWithTicket(games[0].id, 0, [0]);
    await setAttendance(me, games[0].id, me.userId, { status: "ATTENDED", supportTeamId: brothers.id });
    const season = (await teamSeasonRecords(2026)).get(brothers.id)!;
    expect(season).toEqual({ w: 2, l: 1, t: 0 });
    expect((await personalStats(me, me.userId)).total).toMatchObject({ games: 1, w: 0, l: 1 });
  });
});

describe("E. 賽程同步", () => {
  it("同步官網資料：建立比賽、重複同步不重複、主客場依來源", async () => {
    const { f, calls } = fakeCpbl({ A: fx.A, E: fx.E });
    const r1 = await syncCpbl({ season: 2026, kinds: ["A", "E"], triggeredBy: "test", fetchImpl: f });
    expect(r1.every((x) => x.ok)).toBe(true);
    const count = await prisma.game.count();
    expect(count).toBe(9 + 4); // A：9 場（16 列整併）、E：4 場
    // POST 帶上頁面 token 與 cookie
    const post = calls.find((c) => c.init?.method === "POST")!;
    expect((post.init!.headers as Record<string, string>).RequestVerificationToken).toBe("TOKEN-123");
    expect((post.init!.headers as Record<string, string>).Cookie).toBe("__RequestVerificationToken=COOKIE-ABC");
    const r2 = await syncCpbl({ season: 2026, kinds: ["A", "E"], triggeredBy: "test", fetchImpl: f });
    expect(await prisma.game.count()).toBe(count);
    expect(r2[0].message).toContain("新增 0");
    const g2 = await prisma.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:E:2" }, include: { homeTeam: true, venue: true } });
    expect(g2.homeTeam.name).toBe("統一7-ELEVEn獅");
    expect(g2.venue!.name).toBe("臺南亞太國際棒球訓練中心主球場");
    expect(await prisma.scheduleSyncLog.count({ where: { success: true } })).toBe(4);
  });

  it("時間變更、延期、比分更新不影響購票資料；手動鎖定不被覆蓋", async () => {
    const rowsE = JSON.parse(fx.E.GameDatas);
    const { f } = fakeCpbl({ E: { Success: true, GameDatas: JSON.stringify(rowsE) } });
    await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: f });
    const g4 = await prisma.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:E:4" } });
    const order = await attendWithTicket(g4.id);
    await createPayment(G.actors[1], { orderId: order.id, payerId: G.users[1].id, amount: 200, clientRequestId: rid() });
    const before = { orders: await prisma.ticketOrder.count(), tickets: await prisma.ticket.count(), pays: await prisma.payment.count(), att: await prisma.gameAttendance.count() };

    // 1) 官網延賽：第 4 戰當天標記延賽，並新增改期列
    const g4row = rowsE.find((r: { GameSno: number }) => r.GameSno === 4);
    const postponed = { ...g4row, GameResult: "1", PresentStatus: 0 };
    const res1 = fakeCpbl({ E: { Success: true, GameDatas: JSON.stringify([...rowsE.filter((r: { GameSno: number }) => r.GameSno !== 4), postponed]) } });
    await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: res1.f });
    expect((await prisma.game.findUniqueOrThrow({ where: { id: g4.id } })).status).toBe("POSTPONED");
    const resched = { ...g4row, GameDate: "2026-10-13T00:00:00", PreExeDate: "2026-10-13T18:35:00", GameDateTimeS: "2026-10-13T18:35:00" };
    const res2 = fakeCpbl({ E: { Success: true, GameDatas: JSON.stringify([...rowsE.filter((r: { GameSno: number }) => r.GameSno !== 4), postponed, resched]) } });
    await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: res2.f });
    let g = await prisma.game.findUniqueOrThrow({ where: { id: g4.id } });
    expect(g.status).toBe("SCHEDULED");
    expect(g.startAt.toISOString()).toBe("2026-10-13T10:35:00.000Z");
    expect(await prisma.gameChange.count({ where: { gameId: g4.id, field: "startAt" } })).toBe(1);

    // 2) 比賽結束同步比分
    const final = { ...resched, GameResult: "0", VisitingScore: 3, HomeScore: 5, GameDateTimeE: "2026-10-13T21:30:00" };
    const res3 = fakeCpbl({ E: { Success: true, GameDatas: JSON.stringify([...rowsE.filter((r: { GameSno: number }) => r.GameSno !== 4), postponed, final]) } });
    await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: res3.f });
    g = await prisma.game.findUniqueOrThrow({ where: { id: g4.id } });
    expect([g.status, g.homeScore, g.awayScore, g.resultConfirmed]).toEqual(["FINAL", 5, 3, true]);

    // 購票、票券、付款、觀賽紀錄完全不受影響
    expect({ orders: await prisma.ticketOrder.count(), tickets: await prisma.ticket.count(), pays: await prisma.payment.count(), att: await prisma.gameAttendance.count() }).toEqual(before);
    expect((await computeLedger(prisma, G.group.id, { orderId: order.id })).find((r) => r.debtorId === G.users[1].id)!.paid).toBe(200);

    // 3) 管理者手動鎖定後，官網的不同比分不會覆蓋
    await updateGameResult(G.actors[0], g.id, g.version, { status: "FINAL", homeScore: 6, awayScore: 3, resultConfirmed: true, manualLock: true });
    await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: res3.f });
    g = await prisma.game.findUniqueOrThrow({ where: { id: g4.id } });
    expect(g.homeScore).toBe(6);
  });

  it("同步失敗時不清空既有賽程，並記錄失敗原因；格式改變也不寫入", async () => {
    const ok = fakeCpbl({ E: fx.E });
    await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: ok.f });
    const n = await prisma.game.count();
    const down = fakeCpbl(() => {
      throw new Error("fetch failed");
    });
    const r = await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: down.f });
    expect(r[0].ok).toBe(false);
    expect(await prisma.game.count()).toBe(n);
    const broken = fakeCpbl({ E: "<html>maintenance</html>" });
    const r2 = await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: broken.f });
    expect(r2[0].ok).toBe(false);
    expect(r2[0].message).toMatch(/JSON/);
    const weird = fakeCpbl({ E: { Success: true, GameDatas: JSON.stringify([{ Foo: 1 }]) } });
    const r3 = await syncCpbl({ season: 2026, kinds: ["E"], triggeredBy: "t", fetchImpl: weird.f });
    expect(r3[0].ok).toBe(false);
    expect(await prisma.game.count()).toBe(n);
    const failLog = await prisma.scheduleSyncLog.findFirst({ where: { success: false }, orderBy: { startedAt: "desc" } });
    expect(failLog!.message).toBeTruthy();
  });

  it("外部服務失效時手動建立的比賽與購票仍可使用；手動同步有頻率限制", async () => {
    const [me] = G.actors;
    const down = fakeCpbl(() => {
      throw new Error("network down");
    });
    const r = await manualSync(me, down.f);
    expect(r.every((x) => !x.ok)).toBe(true);
    await expect(manualSync(me, down.f)).rejects.toThrow(/3 分鐘/);
    const [h, a] = [await team("ACN011"), await team("AKP011")];
    const g = await createManualGame(me, { date: "2026-11-02", time: "18:35", homeTeamId: h.id, awayTeamId: a.id, venueId: null });
    const o = await attendWithTicket(g.id);
    expect(o.id).toBeTruthy();
  });

  it("總冠軍賽官網資料只有球隊代碼、名稱空白時仍可匯入，且不會改掉球隊名稱", async () => {
    const [me] = G.actors;
    // 2026-10-14 官網實際的總冠軍賽資料格式：HomeTeamName／VisitingTeamName 為空字串
    const base = { KindCode: "C", Year: "2026", GameResult: "", PresentStatus: 1, IsPlayBall: "N", ReserveDate: null, VisitingScore: 0, HomeScore: 0, FieldAbbe: "大巨蛋" };
    const rows = [
      { ...base, GameSno: 1, GameDate: "2026-10-17T00:00:00", PreExeDate: "2026-10-17T17:05:00", GameDateTimeS: "2026-10-17T17:05:00", GameDateTimeE: null, HomeTeamCode: "AAA011", HomeTeamName: "", VisitingTeamCode: "ACN011", VisitingTeamName: "" },
      { ...base, GameSno: 3, GameDate: "2026-10-20T00:00:00", PreExeDate: "2026-10-20T18:35:00", GameDateTimeS: "2026-10-20T18:35:00", GameDateTimeE: null, HomeTeamCode: "ACN011", HomeTeamName: "", VisitingTeamCode: "AAA011", VisitingTeamName: "" },
    ];
    expect(await importCpblJson(me, JSON.stringify(rows))).toContain("新增 2");
    const g1 = await prisma.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:C:1" }, include: { homeTeam: true, awayTeam: true, venue: true } });
    expect([g1.homeTeam.name, g1.awayTeam.name, g1.venue!.name, g1.gameType, g1.status]).toEqual(["味全龍", "中信兄弟", "臺北大巨蛋", "一軍總冠軍賽", "SCHEDULED"]);
    const g3 = await prisma.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:C:3" }, include: { homeTeam: true } });
    expect(g3.homeTeam.name).toBe("中信兄弟");
    expect(await prisma.team.count({ where: { name: "" } })).toBe(0);
    expect(await prisma.team.count()).toBe(6);
  });

  it("管理者可貼上官網 JSON 匯入；CSV 匯入用編號避免重複", async () => {
    const [me, A] = G.actors;
    await expect(importCpblJson(A, JSON.stringify(fx.E))).rejects.toThrow(/管理者/);
    expect(await importCpblJson(me, JSON.stringify(fx.E))).toContain("新增 4");
    expect(await importCpblJson(me, JSON.stringify(fx.E))).toContain("新增 0");
    const csv = "日期,時間,客隊,主隊,球場,狀態,客隊得分,主隊得分,編號\n2026/11/10,18:35,台鋼雄鷹,中信兄弟,洲際,,,,X1\n2026-11-11,17:05,中信兄弟,台鋼雄鷹,澄清湖,比賽結束,3,2,X2\n";
    expect(await importCsvGames(A, csv)).toContain("新增 2");
    expect(await importCsvGames(A, csv)).toContain("新增 0");
    const x2 = await prisma.game.findFirstOrThrow({ where: { externalKey: { endsWith: ":X2" } }, include: { homeTeam: true } });
    expect([x2.groupId, x2.homeTeam.name, x2.homeScore, x2.awayScore, x2.resultConfirmed]).toEqual([G.group.id, "台鋼雄鷹", 2, 3, true]);
    await expect(importCsvGames(A, "日期,時間,客隊,主隊\n2026-13-40,18:35,a,b")).rejects.toThrow(/第 2 列/);
  });
});

describe("備份、匯出與還原", () => {
  async function scenario() {
    const [me, A] = G.actors;
    const g = await makeOfficialGame({ home: "ACN011", away: "AJL011", date: "2026-08-01", venue: "洲際" });
    const o = await attendWithTicket(g.id);
    await prisma.ticket.updateMany({ where: { orderId: o.id, seq: 2 }, data: { secretInfo: "SERIAL-999" } });
    await createPayment(A, { orderId: o.id, payerId: A.userId, amount: 200, clientRequestId: rid() });
    await createSettlement(me, { userA: me.userId, userB: A.userId, expectedNet: 300, expectedPayerId: A.userId });
    await setAttendance(me, g.id, me.userId, { status: "ATTENDED", supportTeamId: (await team("ACN011")).id });
    return { g, o };
  }

  it("CSV／Excel 匯出包含關聯 ID，敏感資訊依權限遮蔽", async () => {
    await scenario();
    const asMember = await collectExports(G.actors[2]);
    const tickets = asMember.find((s) => s.name === "tickets")!.rows;
    expect(tickets).toHaveLength(4);
    expect(tickets.find((t) => t.第幾張 === 2)!.票券識別資訊).toBe("（無權限檢視）");
    const asAdmin = await collectExports(G.actors[0]);
    expect(asAdmin.find((s) => s.name === "tickets")!.rows.find((t) => t.第幾張 === 2)!.票券識別資訊).toBe("SERIAL-999");
    const money = asAdmin.find((s) => s.name === "money")!.rows;
    expect(money.map((m) => m.類型).sort()).toEqual(["付款", "結算付款"]);
    expect(asAdmin.find((s) => s.name === "settlements")!.rows[0].明細訂單ID).toBeTruthy();
    const csv = toCsv(asAdmin.find((s) => s.name === "orders")!.rows);
    expect(csv.startsWith("﻿訂單ID,")).toBe(true);
    const xlsx = await toXlsx(asAdmin);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    expect(toCsv([{ a: "=SUM(1)" }])).toContain("'=SUM(1)");
  });

  it("完整備份 → 驗證 → 需要確認文字 → 還原後資料與帳目完全一致", async () => {
    const { o } = await scenario();
    const [me] = G.actors;
    const before = await computeLedger(prisma, G.group.id);
    const json = JSON.stringify(await exportBackup(me));

    // 還原前資料被誤刪／修改
    await prisma.payment.updateMany({ where: { groupId: G.group.id }, data: { status: "REVOKED" } });
    expect(JSON.stringify(await computeLedger(prisma, G.group.id))).not.toBe(JSON.stringify(before));

    const { plan } = await analyzeBackup(me, json);
    expect(plan.ok).toBe(true);
    expect(plan.counts.訂單).toBe(1);
    await expect(restoreBackup(me, json, "好")).rejects.toThrow(/確認還原/);
    await restoreBackup(me, json, "確認還原");
    const after = await computeLedger(prisma, G.group.id);
    const norm = (rows: typeof before) => JSON.stringify([...rows].sort((a, b) => (a.orderId + a.debtorId).localeCompare(b.orderId + b.debtorId)));
    expect(norm(after)).toBe(norm(before));
    expect(await prisma.ticket.count({ where: { orderId: o.id } })).toBe(4);
    expect((await personalStats(me, me.userId)).total.games).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "RESTORE_PRE_SNAPSHOT" } })).toBe(1);
  });

  it("損壞或關聯錯誤的備份被拒絕，不寫入任何資料", async () => {
    await scenario();
    const [me] = G.actors;
    const good = await buildBackup(prisma, G.group.id);
    const ordersBefore = await prisma.ticketOrder.count();
    expect((await analyzeBackup(me, "not json")).plan.ok).toBe(false);
    expect((await analyzeBackup(me, JSON.stringify({ format: "other" }))).plan.errors[0]).toMatch(/不是本 APP/);
    const broken = JSON.parse(JSON.stringify(good));
    broken.tickets[0].orderId = "missing";
    const { plan } = await analyzeBackup(me, JSON.stringify(broken));
    expect(plan.ok).toBe(false);
    expect(plan.errors.join()).toMatch(/訂單不存在/);
    const dupe = JSON.parse(JSON.stringify(good));
    dupe.payments.push(dupe.payments[0]);
    expect((await analyzeBackup(me, JSON.stringify(dupe))).plan.errors.join()).toMatch(/重複/);
    await expect(restoreBackup(me, JSON.stringify(broken), "確認還原")).rejects.toThrow(/驗證失敗/);
    expect(await prisma.ticketOrder.count()).toBe(ordersBefore);
    await expect(analyzeBackup(G.actors[1], JSON.stringify(good))).rejects.toThrow(/管理者/);
  });
});

describe("重複比賽", () => {
  it("匯入官方賽程時，自動把同一天同兩隊的自建比賽併入官方比賽，票券與帳目不變", async () => {
    const [me, A] = G.actors;
    const [bro, dragon] = [await team("ACN011"), await team("AAA011")];
    // 使用者先手動建立（主客相反、時間不同）並買票、付款、記錄觀賽
    const manual = await createManualGame(A, { date: "2026-10-17", time: "18:35", homeTeamId: bro.id, awayTeamId: dragon.id, venueId: null });
    const o = await attendWithTicket(manual.id, 0, [0, 1]);
    await createPayment(A, { orderId: o.id, payerId: A.userId, amount: 200, clientRequestId: rid() });
    await setAttendance(me, manual.id, me.userId, { status: "PLANNED", supportTeamId: bro.id });
    const before = JSON.stringify(await computeLedger(prisma, G.group.id));
    const rows = [
      { KindCode: "C", Year: "2026", GameSno: 1, GameDate: "2026-10-17T00:00:00", PreExeDate: "2026-10-17T17:05:00", GameDateTimeS: "2026-10-17T17:05:00", GameDateTimeE: null, GameResult: "", PresentStatus: 1, IsPlayBall: "N", ReserveDate: null, HomeTeamCode: "AAA011", HomeTeamName: "", VisitingTeamCode: "ACN011", VisitingTeamName: "", FieldAbbe: "大巨蛋", VisitingScore: 0, HomeScore: 0 },
    ];
    const msg = await importCpblJson(me, JSON.stringify(rows));
    expect(msg).toContain("合併 1 場");
    const official = await prisma.game.findUniqueOrThrow({ where: { externalKey: "cpbl:2026:C:1" } });
    expect(await prisma.game.findUnique({ where: { id: manual.id } })).toBeNull();
    expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: o.id } })).gameId).toBe(official.id);
    expect(await prisma.ticket.count({ where: { gameId: official.id } })).toBe(2);
    expect(await prisma.gameAttendance.count({ where: { gameId: official.id } })).toBe(2);
    expect(JSON.stringify(await computeLedger(prisma, G.group.id))).toBe(before);
    // 之後不能再手動建立同一場
    await expect(createManualGame(A, { date: "2026-10-17", time: "17:05", homeTeamId: dragon.id, awayTeamId: bro.id, venueId: null })).rejects.toThrow(/官方賽程已經有這場/);
    // 不同對戰不受影響
    const other = await createManualGame(A, { date: "2026-10-17", time: "17:05", homeTeamId: (await team("AEO011")).id, awayTeamId: bro.id, venueId: null });
    await importCpblJson(me, JSON.stringify(rows));
    expect(await prisma.game.findUnique({ where: { id: other.id } })).not.toBeNull();
  });
});
