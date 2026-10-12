import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage } from "@/lib/errors";
import { actorOrNull } from "@/server/session";
import type { Actor } from "@/server/context";

export type ActionResult = { ok: boolean; error?: string; message?: string; redirectTo?: string; at?: number };

/** Server Action 共用包裝：驗證登入、轉換錯誤訊息、成功後重新整理畫面資料、需要時換頁 */
export async function run(
  fn: (actor: Actor) => Promise<string | { message?: string; redirectTo?: string } | void>,
): Promise<ActionResult> {
  const actor = await actorOrNull();
  if (!actor) return { ok: false, error: "登入已過期或沒有權限，請重新登入", at: Date.now() };
  let to: string | undefined;
  try {
    const r = await fn(actor);
    revalidatePath("/", "layout");
    if (typeof r === "string") return { ok: true, message: r, at: Date.now() };
    if (!r?.redirectTo) return { ok: true, message: r?.message ?? "已儲存", at: Date.now() };
    to = r.redirectTo;
  } catch (e) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  redirect(to);
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, k: string) => str(fd, k) || null;
export const int = (fd: FormData, k: string, def = 0) => {
  const s = str(fd, k).replace(/,/g, "");
  if (s === "") return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
export const optInt = (fd: FormData, k: string) => (str(fd, k) === "" ? null : int(fd, k));
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
