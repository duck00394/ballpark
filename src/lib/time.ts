// 所有時間以 UTC 儲存，顯示與輸入一律以台灣時間（UTC+8，無日光節約）處理。
const TZ = "Asia/Taipei";
const OFFSET_MS = 8 * 3600_000;

/** 'YYYY-MM-DD' + 'HH:mm' (台灣時間) → Date */
export function fromTaipei(date: string, time = "00:00"): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m || !t) throw new Error("日期或時間格式錯誤");
  const [y, mo, da, h, mi] = [+m[1], +m[2], +m[3], +t[1], +t[2]];
  const local = new Date(Date.UTC(y, mo - 1, da, h, mi));
  // 拒絕 2026-13-40、25:00 這類會被自動進位的日期
  if (
    Number.isNaN(local.getTime()) ||
    local.getUTCFullYear() !== y ||
    local.getUTCMonth() !== mo - 1 ||
    local.getUTCDate() !== da ||
    h > 23 ||
    mi > 59
  )
    throw new Error("日期或時間不存在");
  return new Date(local.getTime() - OFFSET_MS);
}

/** CPBL 原始時間字串（台灣當地時間、無時區），例如 2026-10-12T18:35:00 */
export function parseLocalIso(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) - OFFSET_MS);
}

/** Date → 台灣時間的各部位 */
export function taipeiParts(d: Date) {
  const x = new Date(d.getTime() + OFFSET_MS);
  return {
    year: x.getUTCFullYear(),
    month: x.getUTCMonth() + 1,
    day: x.getUTCDate(),
    hour: x.getUTCHours(),
    minute: x.getUTCMinutes(),
    weekday: x.getUTCDay(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const WD = "日一二三四五六";

export function ymd(d: Date) {
  const p = taipeiParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export function hm(d: Date) {
  const p = taipeiParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
export function fmtDate(d: Date) {
  const p = taipeiParts(d);
  return `${p.month}/${p.day}（${WD[p.weekday]}）`;
}
export function fmtDateTime(d: Date) {
  return `${fmtDate(d)} ${hm(d)}`;
}
export function fmtFull(d: Date) {
  const p = taipeiParts(d);
  return `${p.year}/${pad(p.month)}/${pad(p.day)} ${hm(d)}`;
}

/** 台灣時間某日 00:00 對應的 UTC Date */
export function startOfTaipeiDay(d: Date) {
  return fromTaipei(ymd(d));
}
export function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86400_000);
}
export const TIMEZONE = TZ;
