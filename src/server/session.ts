import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { actorFor, type Actor } from "@/server/context";
import { getSessionUser } from "@/server/services/auth";

export const SESSION_COOKIE = "bp_session";

export const currentSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(token);
});

/** 取得目前登入者與目前群組的權限；未登入導向登入頁 */
export const requireActor = cache(async (): Promise<Actor & { displayName: string; groupName: string }> => {
  const s = await currentSession();
  if (!s) redirect("/login");
  let groupId = s.activeGroupId;
  if (!groupId) {
    const m = await prisma.groupMember.findFirst({ where: { userId: s.userId, active: true } });
    if (!m) redirect("/login?e=nogroup");
    groupId = m.groupId;
  }
  try {
    const actor = await actorFor(s.userId, groupId);
    const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    return { ...actor, displayName: s.user.displayName, groupName: group.name };
  } catch {
    redirect("/login?e=nogroup");
  }
});

/** Server Action 用：不 redirect，回傳 null 讓呼叫端回應錯誤 */
export async function actorOrNull(): Promise<Actor | null> {
  const s = await currentSession();
  if (!s || !s.activeGroupId) return null;
  try {
    return await actorFor(s.userId, s.activeGroupId);
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}
