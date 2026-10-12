import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, invalid, notFound } from "@/lib/errors";
import { type Actor, audit, requireAdmin, withTx } from "@/server/context";
import { displayNameSchema, hashPassword, passwordSchema, usernameSchema } from "./auth";

export async function listMembers(actor: Actor) {
  const ms = await prisma.groupMember.findMany({
    where: { groupId: actor.groupId },
    include: { user: { select: { id: true, username: true, displayName: true, favoriteTeamId: true, disabled: true } } },
    orderBy: { joinedAt: "asc" },
  });
  return ms.map((m) => ({
    userId: m.userId,
    username: m.user.username,
    displayName: m.user.displayName,
    favoriteTeamId: m.user.favoriteTeamId,
    role: m.role,
    active: m.active && !m.user.disabled,
  }));
}

/** 管理者新增成員：若帳號已存在則加入群組，否則建立新帳號（初始密碼由管理者告知本人，登入後可自行修改） */
export async function addMember(
  actor: Actor,
  input: { username: string; displayName: string; password?: string; role?: "ADMIN" | "MEMBER" },
) {
  requireAdmin(actor);
  const username = usernameSchema.parse(input.username).toLowerCase();
  const displayName = displayNameSchema.parse(input.displayName);
  return withTx(async (tx) => {
    let user = await tx.user.findUnique({ where: { username } });
    if (!user) {
      const pw = passwordSchema.parse(input.password ?? "");
      user = await tx.user.create({ data: { username, displayName, passwordHash: await hashPassword(pw) } });
    }
    const existing = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId: actor.groupId, userId: user.id } },
    });
    if (existing?.active) throw invalid("此帳號已經是群組成員");
    const m = existing
      ? await tx.groupMember.update({ where: { id: existing.id }, data: { active: true, role: input.role ?? "MEMBER" } })
      : await tx.groupMember.create({
          data: { groupId: actor.groupId, userId: user.id, role: input.role ?? "MEMBER" },
        });
    await audit(tx, actor, "MEMBER_ADD", "GroupMember", m.id, { username });
    return m;
  });
}

export async function setMemberRole(actor: Actor, userId: string, role: "ADMIN" | "MEMBER") {
  requireAdmin(actor);
  return withTx(async (tx) => {
    const m = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: actor.groupId, userId } } });
    if (!m) throw notFound();
    if (role === "MEMBER" && m.role === "ADMIN") {
      const admins = await tx.groupMember.count({ where: { groupId: actor.groupId, role: "ADMIN", active: true } });
      if (admins <= 1) throw invalid("群組至少需要一位管理者");
    }
    await tx.groupMember.update({ where: { id: m.id }, data: { role } });
    await audit(tx, actor, "MEMBER_ROLE", "GroupMember", m.id, { role });
  });
}

/** 停用成員（不刪除，歷史帳目保留） */
export async function deactivateMember(actor: Actor, userId: string) {
  requireAdmin(actor);
  if (userId === actor.userId) throw invalid("不能停用自己");
  return withTx(async (tx) => {
    const m = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: actor.groupId, userId } } });
    if (!m) throw notFound();
    await tx.groupMember.update({ where: { id: m.id }, data: { active: false } });
    await tx.session.deleteMany({ where: { userId, activeGroupId: actor.groupId } });
    await audit(tx, actor, "MEMBER_DEACTIVATE", "GroupMember", m.id);
  });
}

export async function adminResetPassword(actor: Actor, userId: string, newPassword: string) {
  requireAdmin(actor);
  passwordSchema.parse(newPassword);
  const m = await prisma.groupMember.findUnique({ where: { groupId_userId: { groupId: actor.groupId, userId } } });
  if (!m) throw notFound();
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null },
  });
  await prisma.session.deleteMany({ where: { userId } });
  await audit(prisma, actor, "PASSWORD_RESET", "User", userId);
}

const profileSchema = z.object({
  displayName: displayNameSchema,
  favoriteTeamId: z.string().nullable(),
  followedTeamIds: z.array(z.string()).max(20),
  trackOtherTeams: z.boolean(),
});

export async function updateProfile(actor: Actor, input: z.input<typeof profileSchema>) {
  const data = profileSchema.parse(input);
  const teamIds = [...new Set([...(data.favoriteTeamId ? [data.favoriteTeamId] : []), ...data.followedTeamIds])];
  if (teamIds.length) {
    const n = await prisma.team.count({ where: { id: { in: teamIds } } });
    if (n !== teamIds.length) throw new AppError("VALIDATION", "球隊不存在");
  }
  await prisma.user.update({
    where: { id: actor.userId },
    data: {
      displayName: data.displayName,
      favoriteTeamId: data.favoriteTeamId,
      followedTeamIds: data.followedTeamIds.filter((t) => t !== data.favoriteTeamId),
      trackOtherTeams: data.trackOtherTeams,
    },
  });
  await audit(prisma, actor, "PROFILE_UPDATE", "User", actor.userId);
}

export async function myGroups(userId: string) {
  return prisma.groupMember.findMany({
    where: { userId, active: true },
    include: { group: true },
    orderBy: { joinedAt: "asc" },
  });
}
