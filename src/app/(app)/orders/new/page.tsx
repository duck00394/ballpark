import { notFound } from "next/navigation";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/ui";
import { addDays, fmtDate, hm, startOfTaipeiDay } from "@/lib/time";
import { requireActor } from "@/server/session";
import { getVisibleGame, listGames } from "@/server/services/games";
import { listMembers } from "@/server/services/groups";
import { listPlatforms } from "@/server/services/orders";
import { OrderCreateForm } from "./order-form";

export const metadata = { title: "新增購票" };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ gameId?: string }> }) {
  const actor = await requireActor();
  const { gameId } = await searchParams;
  let fixed = null;
  if (gameId) {
    try {
      fixed = await getVisibleGame(actor, gameId);
    } catch (e) {
      if (e instanceof AppError) notFound();
      throw e;
    }
  }
  const today = startOfTaipeiDay(new Date());
  const [games, members, platforms] = await Promise.all([
    fixed ? Promise.resolve([]) : listGames(actor, { from: today, to: addDays(today, 120) }, 400),
    listMembers(actor),
    listPlatforms(actor),
  ]);
  const toOpt = (g: { id: string; startAt: Date; homeTeam: { shortName: string; id: string }; awayTeam: { shortName: string; id: string }; venue: { name: string } | null; status: string }) => ({
    id: g.id,
    label: `${fmtDate(g.startAt)} ${hm(g.startAt)}　${g.awayTeam.shortName} @ ${g.homeTeam.shortName}`,
    venue: g.venue?.name ?? "未定球場",
    teams: [g.homeTeam.id, g.awayTeam.id],
    off: g.status === "POSTPONED" || g.status === "CANCELLED",
  });
  return (
    <>
      <PageHeader title="新增購票" back={fixed ? `/games/${fixed.id}` : "/"} />
      <OrderCreateForm
        fixedGame={fixed ? toOpt(fixed) : null}
        games={games.map(toOpt)}
        teams={[...new Map(games.flatMap((g) => [[g.homeTeam.id, g.homeTeam.shortName], [g.awayTeam.id, g.awayTeam.shortName]] as const)).entries()]}
        members={members.filter((m) => m.active).map((m) => ({ id: m.userId, name: m.displayName }))}
        platforms={platforms.map((p) => ({ id: p.id, name: p.name }))}
        me={actor.userId}
      />
    </>
  );
}
