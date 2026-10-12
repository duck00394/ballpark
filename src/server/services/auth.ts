import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AppError, invalid } from "@/lib/errors";
import { audit, withTx } from "@/server/context";

export const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
let dummyHash: string | undefined;

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "帳號至少 3 個字元")
  .max(32, "帳號最多 32 個字元")
  .regex(/^[a-zA-Z0-9_.-]+$/, "帳號只能使用英文、數字、底線、點或減號");
export const passwordSchema = z.string().min(8, "密碼至少 8 個字元").max(128, "密碼太長");
export const displayNameSchema = z.string().trim().min(1, "請輸入顯示名稱").max(30, "顯示名稱最多 30 字");

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function createSession(userId: string, activeGroupId: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, activeGroupId, expiresAt } });
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined | null) {
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!s || s.expiresAt < new Date() || s.user.disabled) return null;
  return s;
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export async function login(usernameRaw: string, password: string) {
  const username = usernameRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { username } });
  const generic = new AppError("UNAUTHENTICATED", "帳號或密碼錯誤");
  if (!user || user.disabled) {
    dummyHash ??= bcrypt.hashSync("dummy-password", 10);
    await bcrypt.compare(password, dummyHash); // 讓回應時間一致，避免猜測帳號是否存在
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError("RATE_LIMIT", "登入失敗次數過多，請 15 分鐘後再試");
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: failed >= MAX_FAILED ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    throw generic;
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
  const firstGroup = await prisma.groupMember.findFirst({
    where: { userId: user.id, active: true },
    orderBy: { joinedAt: "asc" },
  });
  return { user, ...(await createSession(user.id, firstGroup?.groupId ?? null)) };
}

/** 首次啟用：系統內沒有任何使用者時，建立第一位管理者與私人群組 */
export async function setupFirstAdmin(input: {
  username: string;
  password: string;
  displayName: string;
  groupName: string;
}) {
  const data = z
    .object({
      username: usernameSchema,
      password: passwordSchema,
      displayName: displayNameSchema,
      groupName: z.string().trim().min(1, "請輸入群組名稱").max(40),
    })
    .parse(input);
  return withTx(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('setup'))`;
    if ((await tx.user.count()) > 0) throw new AppError("FORBIDDEN", "系統已完成初始設定");
    const user = await tx.user.create({
      data: {
        username: data.username.toLowerCase(),
        passwordHash: await hashPassword(data.password),
        displayName: data.displayName,
      },
    });
    const group = await tx.group.create({ data: { name: data.groupName } });
    await tx.groupMember.create({ data: { groupId: group.id, userId: user.id, role: "ADMIN" } });
    await audit(tx, { userId: user.id, groupId: group.id }, "SETUP", "Group", group.id);
    return { user, group };
  });
}

export async function changePassword(userId: string, current: string, next: string) {
  passwordSchema.parse(next);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(current, user.passwordHash))) throw invalid("目前密碼不正確");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
  await prisma.session.deleteMany({ where: { userId } });
}
