import { z } from "zod";

// 預設驗證訊息使用繁體中文
z.config(z.locales.zhTW());

export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "RATE_LIMIT";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "沒有權限執行此操作") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "找不到資料，或你沒有權限查看") => new AppError("NOT_FOUND", msg);
export const invalid = (msg: string) => new AppError("VALIDATION", msg);
export const conflict = (msg = "資料已被其他人修改，請重新整理後再試") => new AppError("CONFLICT", msg);

export function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e && typeof e === "object" && "issues" in e) {
    const issues = (e as { issues: { message: string }[] }).issues;
    return issues.map((i) => i.message).join("；");
  }
  if (e instanceof Error && /Unique constraint/.test(e.message)) return "資料重複，可能已經送出過";
  console.error(e);
  return "發生未預期的錯誤，請稍後再試";
}
