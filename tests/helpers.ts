import { prisma } from "@/lib/db";
import { seedReference } from "@/server/seed/reference";
import { actorFor, type Actor } from "@/server/context";
import { hashPassword } from "@/server/services/auth";
import { fromTaipei } from "@/lib/time";

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await seedReference(prisma);
}

let pwHash: string | undefined;
export async function makeGroup(names: string[], groupName = "看球團") {
  pwHash ??= await hashPassword("password123");
  const group = await prisma.group.create({ data: { name: groupName } });
  const users = [];
  for (const [i, n] of names.entries()) {
    const u = await prisma.user.create({ data: { username: `u_${group.id.slice(-8)}_${i}`, displayName: n, passwordHash: pwHash } });
    await prisma.groupMember.create({ data: { groupId: group.id, userId: u.id, role: i === 0 ? "ADMIN" : "MEMBER" } });
    users.push(u);
  }
  const actors: Actor[] = [];
  for (const u of users) actors.push(await actorFor(u.id, group.id));
  return { group, users, actors };
}

export async function team(code: string) {
  return prisma.team.findFirstOrThrow({ where: { code } });
}

export async function makeOfficialGame(opts: { home: string; away: string; date: string; time?: string; key?: string; venue?: string }) {
  const [h, a] = await Promise.all([team(opts.home), team(opts.away)]);
  const venue = opts.venue ? await prisma.venue.findFirst({ where: { sourceName: opts.venue } }) : null;
  return prisma.game.create({
    data: {
      groupId: null,
      source: "CPBL",
      externalKey: opts.key ?? `test:${opts.date}:${opts.home}:${opts.away}:${Math.random()}`,
      season: Number(opts.date.slice(0, 4)),
      kindCode: "A",
      gameType: "一軍例行賽",
      startAt: fromTaipei(opts.date, opts.time ?? "18:35"),
      homeTeamId: h.id,
      awayTeamId: a.id,
      venueId: venue?.id ?? null,
    },
  });
}

export const rid = () => `req-${Math.random().toString(36).slice(2)}-${Date.now()}`;
