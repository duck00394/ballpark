import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { outcomeForTeam, officialResult, winPct } from "@/lib/results";
import { normalizeCpblRows, parseCpblResponse } from "@/lib/sync/cpbl";
import { fromTaipei, ymd, hm } from "@/lib/time";

const g = (o: Partial<Parameters<typeof outcomeForTeam>[0]> = {}) => ({
  status: "FINAL",
  resultConfirmed: true,
  homeTeamId: "H",
  awayTeamId: "V",
  homeScore: 3,
  awayScore: 2,
  ...o,
});

describe("比賽結果判定", () => {
  it("主隊勝 / 客隊勝 / 和局", () => {
    expect(officialResult(g())).toBe("HOME");
    expect(outcomeForTeam(g(), "H")).toBe("WIN");
    expect(outcomeForTeam(g(), "V")).toBe("LOSS");
    expect(outcomeForTeam(g({ homeScore: 1, awayScore: 5 }), "V")).toBe("WIN");
    expect(outcomeForTeam(g({ homeScore: 1, awayScore: 5 }), "H")).toBe("LOSS");
    expect(outcomeForTeam(g({ homeScore: 2, awayScore: 2 }), "H")).toBe("TIE");
  });
  it("延期、取消、保留、未開賽、未確認都不計入", () => {
    for (const status of ["POSTPONED", "CANCELLED", "SUSPENDED", "SCHEDULED", "IN_PROGRESS", "OTHER"])
      expect(outcomeForTeam(g({ status }), "H")).toBe("NONE");
    expect(outcomeForTeam(g({ resultConfirmed: false }), "H")).toBe("NONE");
    expect(outcomeForTeam(g({ homeScore: null }), "H")).toBe("NONE");
  });
  it("支持球隊未參賽不計入", () => {
    expect(outcomeForTeam(g(), "OTHER")).toBe("NONE");
    expect(outcomeForTeam(g(), null)).toBe("NONE");
  });
  it("勝率不含和局", () => {
    expect(winPct(3, 1)).toBe(0.75);
    expect(winPct(0, 0)).toBeNull();
  });
});

describe("台灣時間", () => {
  it("輸入與顯示一致", () => {
    const d = fromTaipei("2026-10-12", "18:35");
    expect(d.toISOString()).toBe("2026-10-12T10:35:00.000Z");
    expect(ymd(d)).toBe("2026-10-12");
    expect(hm(d)).toBe("18:35");
  });
});

describe("CPBL 官網資料解析（使用 2026-10-12 實際取得的資料）", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/cpbl-2026.json"), "utf8"));
  const A = normalizeCpblRows(parseCpblResponse(JSON.stringify(fx.A)), new Date("2026-10-12T00:00:00Z")).games;
  const E = normalizeCpblRows(parseCpblResponse(JSON.stringify(fx.E)), new Date("2026-10-12T00:00:00Z")).games;
  const byNo = (list: typeof A, n: number) => list.find((x) => x.gameNumber === n)!;

  it("同一場比賽多列（延賽兩次後完賽）只產生一場，採用最終完賽日期與比分", () => {
    expect(A.filter((x) => x.gameNumber === 14)).toHaveLength(1);
    const x = byNo(A, 14);
    expect(x.externalKey).toBe("cpbl:2026:A:14");
    expect(x.status).toBe("FINAL");
    expect(ymd(x.startAt)).toBe("2026-10-05");
    expect(hm(x.startAt)).toBe("18:35");
    expect(x.away.name).toBe("統一7-ELEVEn獅");
    expect(x.home.name).toBe("中信兄弟");
    expect([x.awayScore, x.homeScore]).toEqual([7, 4]);
    expect(x.resultConfirmed).toBe(true);
    expect(x.note).toContain("延賽 2 次");
  });
  it("保留比賽後續賽完成，以續賽日為準", () => {
    const x = byNo(A, 151);
    expect(x.status).toBe("FINAL");
    expect(ymd(x.startAt)).toBe("2026-06-28");
    expect([x.awayScore, x.homeScore]).toEqual([1, 4]);
  });
  it("只有保留列時狀態為保留比賽，且不計正式結果", () => {
    const rows = JSON.parse(fx.A.GameDatas).filter((r: { GameSno: number; GameResult: string }) => r.GameSno === 326 && r.GameResult === "2");
    const [x] = normalizeCpblRows(rows).games;
    expect(x.status).toBe("SUSPENDED");
    expect(x.resultConfirmed).toBe(false);
    expect(ymd(x.reserveDate!)).toBe("2026-10-01");
    expect(hm(x.startAt)).toBe("18:37"); // PreExeDate 只有日期，改用實際開打時間
  });
  it("只有延賽列時狀態為延期", () => {
    const rows = JSON.parse(fx.A.GameDatas).filter((r: { GameSno: number; GameResult: string }) => r.GameSno === 14 && r.GameResult === "1");
    const [x] = normalizeCpblRows(rows).games;
    expect(x.status).toBe("POSTPONED");
    expect(x.homeScore).toBeNull();
  });
  it("和局正確辨識", () => {
    const x = byNo(A, 23);
    expect(x.status).toBe("FINAL");
    expect(x.homeScore).toBe(x.awayScore);
  });
  it("季後賽主客場依資料來源（第二戰主客對調）", () => {
    expect(byNo(E, 1).home.name).toBe("中信兄弟");
    expect(byNo(E, 2).home.name).toBe("統一7-ELEVEn獅");
    expect(byNo(E, 2).venueName).toBe("亞太主");
    expect(byNo(E, 4).status).toBe("SCHEDULED");
    expect(byNo(E, 4).homeScore).toBeNull();
    expect(byNo(E, 4).gameType).toBe("一軍季後挑戰賽");
  });
  it("格式不符的列會被略過並回報", () => {
    const r = normalizeCpblRows([{ foo: 1 }, ...JSON.parse(fx.E.GameDatas)]);
    expect(r.skipped).toBe(1);
    expect(r.games).toHaveLength(4);
  });
  it("官網回應失敗或非 JSON 時拋出錯誤", () => {
    expect(() => parseCpblResponse("<html>")).toThrow(/JSON/);
    expect(() => parseCpblResponse(JSON.stringify({ Success: false }))).toThrow(/失敗/);
  });
});
