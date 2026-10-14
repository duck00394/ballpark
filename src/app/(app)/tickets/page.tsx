import Link from "next/link";
import { Card, Chevron, Empty, PageHeader, Status } from "@/components/ui";
import { fmtDate, hm } from "@/lib/time";
import { requireActor } from "@/server/session";
import { walletTickets } from "@/server/services/orders";

export const metadata = { title: "我的票券" };

type Tab = "todo" | "done";

/** 我的票券夾：依「未取票／已取票」分頁，每場比賽一張卡片，點進去逐張查看 */
export default async function WalletPage({ searchParams }: { searchParams: Promise<{ tab?: string; sent?: string }> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const all = await walletTickets(actor);
  const isDone = (s: string) => s === "PICKED" || s === "NOT_APPLICABLE";
  const todo = all.filter((t) => !isDone(t.pickupStatus));
  const done = all.filter((t) => isDone(t.pickupStatus));
  const tab: Tab = sp.tab === "done" ? "done" : sp.tab === "todo" ? "todo" : todo.length ? "todo" : "done";
  const list = tab === "todo" ? todo : done;
  const byGame = new Map<string, typeof list>();
  for (const t of list) (byGame.get(t.gameId) ?? byGame.set(t.gameId, []).get(t.gameId)!).push(t);

  return (
    <>
      <PageHeader title="我的票券" action={<Link href="/tickets/manage" className="btn btn-secondary btn-sm">群組票券管理</Link>} />
      {sp.sent ? (
        <p role="status" className="msg msg-ok mb-3">
          已轉送。對方會在自己的「我的票券」看到，需要按「我已取票」。
        </p>
      ) : null}
      <nav className="segmented" aria-label="取票狀態">
        <Link href="/tickets?tab=todo" aria-current={tab === "todo"}>
          未取票 <span className="num ml-1 opacity-70">{todo.length}</span>
        </Link>
        <Link href="/tickets?tab=done" aria-current={tab === "done"}>
          已取票 <span className="num ml-1 opacity-70">{done.length}</span>
        </Link>
      </nav>

      {byGame.size === 0 ? (
        <Card>
          <Empty action={tab === "todo" ? <Link href="/orders/new" className="btn btn-secondary">新增購票</Link> : undefined}>
            {tab === "todo" ? "沒有需要取的票" : "還沒有已取的票"}
          </Empty>
        </Card>
      ) : (
        [...byGame].map(([gameId, ts]) => {
          const g = ts[0].game;
          const unassigned = ts.filter((t) => !t.holderId).length;
          return (
            <Link key={gameId} href={`/tickets/game/${gameId}?tab=${tab}`} className="game-card flex items-center gap-3" data-wallet-game={gameId}>
              <div className="w-14 shrink-0 text-center rounded-lg bg-surface-2 py-2">
                <div className="text-xs text-faint num">{fmtDate(g.startAt).replace(/（.）/, "")}</div>
                <div className="text-sm font-bold num">{hm(g.startAt)}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold leading-snug">
                  {g.awayTeam.shortName} vs {g.homeTeam.shortName}
                </div>
                <div className="text-xs text-faint truncate">
                  {fmtDate(g.startAt)}・{g.venue?.name ?? "未定球場"}
                </div>
                <div className="status-line mt-1.5">
                  <Status tone={tab === "todo" ? "warn" : "good"}>
                    共 <span className="num">{ts.length}</span> 張{tab === "todo" ? "待取" : "已取"}
                  </Status>
                  {unassigned ? <Status tone="muted">{unassigned} 張尚未分配</Status> : null}
                </div>
              </div>
              <Chevron />
            </Link>
          );
        })
      )}
      <p className="text-xs text-faint mt-3">
        這裡只列出你持有的票，以及你購買但還沒分給別人的票。要看整個群組的票或依付款狀態篩選，請到「群組票券管理」。
      </p>
    </>
  );
}
