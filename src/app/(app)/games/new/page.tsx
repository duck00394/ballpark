import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireActor } from "@/server/session";
import { listTeams, listVenues } from "@/server/services/games";
import { GameForm } from "../forms";
import { TeamVenueForms } from "./team-venue-forms";

export const metadata = { title: "新增比賽" };

export default async function NewGamePage() {
  await requireActor();
  const [teams, venues] = await Promise.all([listTeams(), listVenues()]);
  return (
    <>
      <PageHeader title="新增比賽" back="/games" />
      <p className="text-sm text-muted mb-3">
        中華職棒賽程會自動同步，一般不需要手動新增。若是官網未收錄的比賽（國際賽、友誼賽等）再於此建立；建立後只有本群組看得到。
        想從賽程選擇比賽買票，請到 <Link href="/orders/new" className="link">新增購票</Link>。
      </p>
      <Card>
        <GameForm teams={teams} venues={venues} />
      </Card>
      <TeamVenueForms />
    </>
  );
}
