import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { fmtPct, winPct } from "@/lib/results";
import { taipeiParts } from "@/lib/time";
import { requireActor } from "@/server/session";
import { listTeams, teamSeasonRecords } from "@/server/services/games";

export const metadata = { title: "球隊正式戰績" };

export default async function Standings({ searchParams }: { searchParams: Promise<{ season?: string; kind?: string }> }) {
  await requireActor();
  const sp = await searchParams;
  const season = Number(sp.season) || taipeiParts(new Date()).year;
  const kind = ["A", "E", "C"].includes(sp.kind ?? "") ? sp.kind! : "A";
  const [rec, teams] = await Promise.all([teamSeasonRecords(season, kind), listTeams()]);
  const rows = teams
    .map((t) => ({ t, r: rec.get(t.id) ?? { w: 0, l: 0, t: 0 } }))
    .filter((x) => x.r.w + x.r.l + x.r.t > 0)
    .sort((a, b) => (winPct(b.r.w, b.r.l) ?? 0) - (winPct(a.r.w, a.r.l) ?? 0));
  return (
    <>
      <PageHeader title="球隊正式戰績" back="/games" sub={`${season} 年`} />
      <div className="chip-row mb-2">
        {[["A", "例行賽"], ["E", "季後挑戰賽"], ["C", "總冠軍賽"]].map(([k, l]) => (
          <Link key={k} className="chip" aria-current={kind === k} href={`/games/standings?season=${season}&kind=${k}`}>{l}</Link>
        ))}
        <Link className="chip" href={`/games/standings?season=${season - 1}&kind=${kind}`}>{season - 1} 年</Link>
        {season < taipeiParts(new Date()).year ? <Link className="chip" href={`/games/standings?season=${season + 1}&kind=${kind}`}>{season + 1} 年</Link> : null}
      </div>
      <p className="text-sm text-muted mb-2">依已同步的官方賽程中「正式確認結束」的比賽計算，是球隊整季戰績，與個人到場觀賽戰績分開。勝率 = 勝 ÷（勝＋敗）。</p>
      <Card>
        {rows.length === 0 ? (
          <p className="text-muted text-center py-4">尚無資料，請先同步賽程</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-muted text-left">
                <th className="py-2">球隊</th><th>勝</th><th>敗</th><th>和</th><th>勝率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, r }) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="py-2 font-semibold">{t.name}</td><td>{r.w}</td><td>{r.l}</td><td>{r.t}</td><td>{fmtPct(winPct(r.w, r.l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
