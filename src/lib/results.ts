import type { Outcome } from "./labels";

export interface ResultGame {
  status: string;
  resultConfirmed: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
}

/** 只有「比賽結束」且「正式確認」且雙方比分都存在，才算正式結果 */
export function isCountable(g: ResultGame): boolean {
  return g.status === "FINAL" && g.resultConfirmed && g.homeScore != null && g.awayScore != null;
}

export function officialResult(g: ResultGame): "HOME" | "AWAY" | "TIE" | null {
  if (!isCountable(g)) return null;
  if (g.homeScore! > g.awayScore!) return "HOME";
  if (g.homeScore! < g.awayScore!) return "AWAY";
  return "TIE";
}

/** 指定球隊在該場的結果；球隊未參賽或比賽不計入時回傳 NONE */
export function outcomeForTeam(g: ResultGame, teamId: string | null | undefined): Outcome {
  if (!teamId) return "NONE";
  const r = officialResult(g);
  if (!r) return "NONE";
  const side = teamId === g.homeTeamId ? "HOME" : teamId === g.awayTeamId ? "AWAY" : null;
  if (!side) return "NONE";
  if (r === "TIE") return "TIE";
  return r === side ? "WIN" : "LOSS";
}

/** 勝率 = 勝 /（勝 + 敗），和局不列入；無勝敗時回傳 null */
export function winPct(w: number, l: number): number | null {
  return w + l === 0 ? null : w / (w + l);
}

export function fmtPct(p: number | null): string {
  return p == null ? "—" : p.toFixed(3).replace(/^0/, "");
}

export function resultText(g: ResultGame & { homeTeamName: string; awayTeamName: string }): string {
  const r = officialResult(g);
  if (!r) return "";
  if (r === "TIE") return "和局";
  return `${r === "HOME" ? g.homeTeamName : g.awayTeamName} 勝`;
}
