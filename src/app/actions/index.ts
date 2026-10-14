"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { AppError, errorMessage } from "@/lib/errors";
import { actorFor } from "@/server/context";
import { SESSION_COOKIE, currentSession, setSessionCookie } from "@/server/session";
import { changePassword, deleteSession, login, setupFirstAdmin, createSession } from "@/server/services/auth";
import { addMember, adminResetPassword, deactivateMember, setMemberRole, updateProfile } from "@/server/services/groups";
import { createManualGame, createTeam, createVenue, updateGameInfo, updateGameResult } from "@/server/services/games";
import {
  addTicket,
  archiveTicket,
  confirmTicketReceived,
  createOrder,
  createPlatform,
  setPickupStatus,
  transferTicket,
  updateOrder,
  updateTicket,
} from "@/server/services/orders";
import {
  cancelSettlement,
  confirmPayment,
  createMemberRefund,
  createPayment,
  createPlatformRefund,
  createSettlement,
  revokePayment,
  setRefundStatus,
} from "@/server/services/finance";
import { setAttendance } from "@/server/services/stats";
import { importCpblJson, importCsvGames, manualSync } from "@/server/services/schedule";
import { analyzeBackup, restoreBackup, type RestorePlan } from "@/server/services/backup";
import { type ActionResult, bool, int, optInt, optStr, run, str } from "./result";

// ───────── 登入 ─────────

export async function loginAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    const r = await login(str(fd, "username"), str(fd, "password"));
    await setSessionCookie(r.token, r.expiresAt);
  } catch (e) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  redirect("/");
}

export async function setupAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  try {
    if (str(fd, "password") !== str(fd, "password2")) return { ok: false, error: "兩次輸入的密碼不一致" };
    const { user, group } = await setupFirstAdmin({
      username: str(fd, "username"),
      password: str(fd, "password"),
      displayName: str(fd, "displayName"),
      groupName: str(fd, "groupName"),
    });
    const s = await createSession(user.id, group.id);
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return { ok: false, error: errorMessage(e), at: Date.now() };
  }
  redirect("/");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function switchGroupAction(fd: FormData) {
  const s = await currentSession();
  if (!s) redirect("/login");
  const groupId = str(fd, "groupId");
  await actorFor(s.userId, groupId); // 不是成員會拋出錯誤
  await prisma.session.update({ where: { id: s.id }, data: { activeGroupId: groupId } });
  redirect("/");
}

export async function changePasswordAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await currentSession();
  if (!s) return { ok: false, error: "請重新登入" };
  if (str(fd, "next") !== str(fd, "next2")) return { ok: false, error: "兩次輸入的新密碼不一致" };
  try {
    await changePassword(s.userId, str(fd, "current"), str(fd, "next"));
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  redirect("/login?m=pw");
}

// ───────── 成員與個人設定 ─────────

export async function profileAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await updateProfile(a, {
      displayName: str(fd, "displayName"),
      favoriteTeamId: optStr(fd, "favoriteTeamId"),
      followedTeamIds: fd.getAll("followedTeamIds").map(String).filter(Boolean),
      trackOtherTeams: bool(fd, "trackOtherTeams"),
    });
    return "個人設定已更新";
  });
}

export async function addMemberAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await addMember(a, {
      username: str(fd, "username"),
      displayName: str(fd, "displayName"),
      password: str(fd, "password") || undefined,
      role: str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER",
    });
    return "已新增成員，請把帳號與初始密碼告訴對方";
  });
}

export async function memberAdminAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const uid = str(fd, "userId");
    switch (str(fd, "op")) {
      case "role":
        await setMemberRole(a, uid, str(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER");
        return "已更新權限";
      case "deactivate":
        await deactivateMember(a, uid);
        return "已停用成員（歷史帳目保留）";
      case "reset":
        await adminResetPassword(a, uid, str(fd, "password"));
        return "已重設密碼";
    }
    return "未知操作";
  });
}

// ───────── 比賽 ─────────

function gameInput(fd: FormData) {
  return {
    date: str(fd, "date"),
    time: str(fd, "time"),
    homeTeamId: str(fd, "homeTeamId"),
    awayTeamId: str(fd, "awayTeamId"),
    venueId: optStr(fd, "venueId"),
    league: str(fd, "league") || "CPBL",
    gameType: str(fd, "gameType") || "例行賽",
    name: optStr(fd, "name"),
    note: optStr(fd, "note"),
  };
}

export async function createGameAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const g = await createManualGame(a, gameInput(fd));
    return { message: "已新增比賽", redirectTo: `/games/${g.id}` };
  });
}

export async function updateGameAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await updateGameInfo(a, str(fd, "gameId"), int(fd, "version"), gameInput(fd));
    return "比賽資料已更新";
  });
}

export async function gameResultAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await updateGameResult(a, str(fd, "gameId"), int(fd, "version"), {
      status: str(fd, "status") as "FINAL",
      homeScore: optInt(fd, "homeScore"),
      awayScore: optInt(fd, "awayScore"),
      resultConfirmed: bool(fd, "resultConfirmed"),
      manualLock: fd.has("manualLock") ? bool(fd, "manualLock") : undefined,
      note: fd.has("note") ? optStr(fd, "note") : undefined,
    });
    return "比賽結果已更新，統計會自動重新計算";
  });
}

export async function createTeamAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await createTeam(a, { name: str(fd, "name"), shortName: str(fd, "shortName"), league: str(fd, "league") });
    return "已新增球隊";
  });
}

export async function createVenueAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await createVenue(a, { name: str(fd, "name"), city: str(fd, "city") });
    return "已新增球場";
  });
}

export async function attendanceAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await setAttendance(a, str(fd, "gameId"), str(fd, "userId") || a.userId, {
      status: str(fd, "status") as "ATTENDED",
      supportTeamId: optStr(fd, "supportTeamId"),
    });
    return "觀賽紀錄已更新";
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function syncAction(_prev: ActionResult) {
  return run(async (a) => {
    const r = await manualSync(a);
    const failed = r.filter((x) => !x.ok);
    if (failed.length === r.length) throw new AppError("VALIDATION", "官網拒絕伺服器連線，無法自動同步。請到「匯入賽程」用書籤匯入（約 10 秒）。既有賽程不受影響。");
    return failed.length ? `部分完成：${failed.map((f) => `${f.kind} 失敗（${f.message}）`).join("；")}` : "賽程已同步";
  });
}

export async function importCpblAction(_: ActionResult, fd: FormData) {
  return run(async (a) => importCpblJson(a, str(fd, "json")));
}

export async function importCsvAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const file = fd.get("file");
    const text = file instanceof File && file.size ? await file.text() : str(fd, "csv");
    return importCsvGames(a, text);
  });
}

// ───────── 訂單與票券 ─────────

function orderFields(fd: FormData) {
  const custom: Record<string, number> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("custom_") && String(v) !== "") custom[k.slice(7)] = Number(v);
  return {
    platformId: optStr(fd, "platformId"),
    purchaseUrl: optStr(fd, "purchaseUrl"),
    purchasedDate: optStr(fd, "purchasedDate"),
    purchasedTime: optStr(fd, "purchasedTime"),
    buyerId: str(fd, "buyerId"),
    orderNumber: optStr(fd, "orderNumber"),
    ticketCategory: optStr(fd, "ticketCategory"),
    feeAmount: int(fd, "feeAmount"),
    otherFeeAmount: int(fd, "otherFeeAmount"),
    actualTotal: optInt(fd, "actualTotal"),
    feeSplitMode: str(fd, "feeSplitMode") as "PER_TICKET",
    customFeeSplit: str(fd, "feeSplitMode") === "CUSTOM" ? custom : null,
    status: (str(fd, "status") || "PURCHASED") as "PURCHASED",
    pickupDeadlineDate: optStr(fd, "pickupDeadlineDate"),
    pickupDeadlineTime: optStr(fd, "pickupDeadlineTime"),
    note: optStr(fd, "note"),
  };
}

export async function createOrderAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const count = int(fd, "count", 1);
    const price = int(fd, "pricePerTicket");
    const tickets = Array.from({ length: Math.max(0, Math.min(30, count)) }, (_, i) => ({
      holderId: optStr(fd, `t${i}_holderId`),
      price: optInt(fd, `t${i}_price`) ?? price,
      section: optStr(fd, `t${i}_section`),
      rowLabel: optStr(fd, `t${i}_rowLabel`),
      seatNumber: optStr(fd, `t${i}_seatNumber`),
      ticketType: optStr(fd, `t${i}_ticketType`),
    }));
    const o = await createOrder(a, {
      gameId: str(fd, "gameId"),
      ...orderFields(fd),
      pricePerTicket: price,
      tickets,
      clientRequestId: optStr(fd, "clientRequestId") ?? undefined,
    });
    return { message: "訂單已建立", redirectTo: `/orders/${o.id}` };
  });
}

export async function updateOrderAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await updateOrder(a, str(fd, "orderId"), int(fd, "version"), orderFields(fd));
    return "訂單已更新，應付金額已重新計算";
  });
}

export async function addTicketAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await addTicket(a, str(fd, "orderId"), optInt(fd, "price") ?? undefined);
    return "已新增一張票";
  });
}

export async function updateTicketAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await updateTicket(a, str(fd, "ticketId"), int(fd, "version"), {
      holderId: optStr(fd, "holderId"),
      price: int(fd, "price"),
      section: optStr(fd, "section"),
      rowLabel: optStr(fd, "rowLabel"),
      seatNumber: optStr(fd, "seatNumber"),
      ticketType: optStr(fd, "ticketType"),
      pickupMethod: optStr(fd, "pickupMethod"),
      secretInfo: fd.has("secretInfo") ? optStr(fd, "secretInfo") : undefined,
      note: optStr(fd, "note"),
      transferStatus: str(fd, "transferStatus") as "ASSIGNED",
      pickupStatus: str(fd, "pickupStatus") as "NOT_PICKED",
    });
    return "票券已更新";
  });
}

export async function ticketQuickAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = str(fd, "ticketId");
    switch (str(fd, "op")) {
      case "received":
        await confirmTicketReceived(a, id);
        return "已確認收到票券";
      case "picked":
        await setPickupStatus(a, id, "PICKED");
        return "已標記為已取票";
      case "pickfail":
        await setPickupStatus(a, id, "FAILED");
        return "已標記為取票失敗";
      case "unpicked":
        await setPickupStatus(a, id, "NOT_PICKED");
        return "已改回尚未取票";
      case "transfer":
        await transferTicket(a, id, str(fd, "toUserId"));
        return { redirectTo: "/tickets?sent=1" };
      case "archive":
        await archiveTicket(a, id);
        return "已移除票券（帳目紀錄保留）";
    }
    return "未知操作";
  });
}

export async function createPlatformAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await createPlatform(a, { name: str(fd, "name"), webUrl: optStr(fd, "webUrl"), appUrl: optStr(fd, "appUrl") });
    return "已新增售票平台";
  });
}

// ───────── 付款、退款、結算 ─────────

export async function paymentAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await createPayment(a, {
      orderId: str(fd, "orderId"),
      payerId: str(fd, "payerId"),
      amount: int(fd, "amount"),
      method: optStr(fd, "method"),
      paidDate: optStr(fd, "paidDate"),
      note: optStr(fd, "note"),
      clientRequestId: optStr(fd, "clientRequestId") ?? undefined,
    });
    return { redirectTo: `/orders/${str(fd, "orderId")}?ok=pay#pay` };
  });
}

export async function paymentOpAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const id = str(fd, "paymentId");
    if (str(fd, "op") === "confirm") {
      await confirmPayment(a, id);
      return "已確認";
    }
    await revokePayment(a, id, str(fd, "reason"));
    return "付款已撤銷（紀錄保留）";
  });
}

export async function refundAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    if (str(fd, "kind") === "PLATFORM") {
      await createPlatformRefund(a, {
        orderId: str(fd, "orderId"),
        amount: int(fd, "amount"),
        completed: bool(fd, "completed"),
        note: optStr(fd, "note"),
        clientRequestId: optStr(fd, "clientRequestId") ?? undefined,
      });
    } else {
      await createMemberRefund(a, {
        orderId: str(fd, "orderId"),
        fromUserId: str(fd, "fromUserId"),
        toUserId: str(fd, "toUserId"),
        amount: int(fd, "amount"),
        completed: bool(fd, "completed"),
        method: optStr(fd, "method"),
        note: optStr(fd, "note"),
        clientRequestId: optStr(fd, "clientRequestId") ?? undefined,
      });
    }
    return { redirectTo: `/orders/${str(fd, "orderId")}?ok=refund#refunds` };
  });
}

export async function refundOpAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await setRefundStatus(a, str(fd, "refundId"), str(fd, "op") === "complete" ? "COMPLETED" : "CANCELLED");
    return str(fd, "op") === "complete" ? "已標記為已退款" : "已取消退款";
  });
}

export async function settlementAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    const s = await createSettlement(a, {
      userA: a.userId,
      userB: str(fd, "otherId"),
      expectedNet: int(fd, "expectedNet"),
      expectedPayerId: str(fd, "expectedPayerId"),
      method: optStr(fd, "method"),
      note: optStr(fd, "note"),
      clientRequestId: optStr(fd, "clientRequestId") ?? undefined,
    });
    return { redirectTo: `/settle?done=${s.id}` };
  });
}

export async function cancelSettlementAction(_: ActionResult, fd: FormData) {
  return run(async (a) => {
    await cancelSettlement(a, str(fd, "settlementId"), str(fd, "reason"));
    return "結算已取消，原帳目恢復為未結";
  });
}

// ───────── 備份還原 ─────────

export type RestoreState = ActionResult & { plan?: RestorePlan; json?: string };

export async function analyzeBackupAction(_: RestoreState, fd: FormData): Promise<RestoreState> {
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "請選擇備份檔" };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: "備份檔過大" };
  const json = await file.text();
  const r = await run(async (a) => {
    const { plan } = await analyzeBackup(a, json);
    return { message: JSON.stringify(plan) };
  });
  if (!r.ok) return r;
  return { ok: true, plan: JSON.parse(r.message!), json };
}

export async function restoreBackupAction(_: RestoreState, fd: FormData): Promise<RestoreState> {
  return run(async (a) => {
    await restoreBackup(a, str(fd, "json"), str(fd, "confirm"));
    return "還原完成。還原前的資料已自動保存在操作紀錄中。";
  });
}
