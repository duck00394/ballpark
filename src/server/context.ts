import { prisma, type Tx } from "@/lib/db";
import { AppError, forbidden } from "@/lib/errors";
import type { GroupRole } from "@prisma/client";

/** 伺服器端操作者：所有服務函式都以此做權限判斷 */
export interface Actor {
  userId: string;
  groupId: string;
  role: GroupRole;
}

/** 確認使用者是群組的有效成員，回傳 Actor。非成員一律拒絕。 */
export async function actorFor(userId: string, groupId: string, db: Tx = prisma): Promise<Actor> {
  const m = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    include: { user: { select: { disabled: true } } },
  });
  if (!m || !m.active || m.user.disabled) throw forbidden("你不是此群組成員");
  return { userId, groupId, role: m.role };
}

export function requireAdmin(actor: Actor) {
  if (actor.role !== "ADMIN") throw forbidden("只有管理者可以執行此操作");
}

/** 確認某使用者是同群組有效成員（指定持有人、付款對象時使用） */
export async function assertGroupMember(db: Tx, groupId: string, userId: string, label = "成員") {
  const m = await db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!m || !m.active) throw new AppError("VALIDATION", `${label}不是此群組成員`);
}

export async function groupMemberIds(db: Tx, groupId: string): Promise<string[]> {
  const ms = await db.groupMember.findMany({ where: { groupId, active: true }, select: { userId: true } });
  return ms.map((m) => m.userId);
}

/** 以群組為單位的交易鎖，避免多人同時修改金額造成不一致 */
export async function lockGroup(tx: Tx, groupId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"group:" + groupId}))`;
}

export async function audit(
  db: Tx,
  actor: { userId: string; groupId?: string | null } | null,
  action: string,
  entityType: string,
  entityId: string | null,
  detail?: unknown,
) {
  await db.auditLog.create({
    data: {
      groupId: actor?.groupId ?? null,
      actorId: actor?.userId ?? null,
      action,
      entityType,
      entityId,
      detail: detail === undefined ? undefined : JSON.parse(JSON.stringify(detail)),
    },
  });
}

/** 在交易中執行（含 Serializable 重試） */
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => fn(tx), { timeout: 20000, maxWait: 10000 });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if ((code === "P2034" || code === "40001") && attempt < 3) continue;
      throw e;
    }
  }
}
