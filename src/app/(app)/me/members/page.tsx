import { Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { requireActor } from "@/server/session";
import { listMembers } from "@/server/services/groups";
import { AddMemberForm, MemberOps } from "./forms";

export default async function MembersPage() {
  const actor = await requireActor();
  const members = await listMembers(actor);
  const admin = actor.role === "ADMIN";
  return (
    <>
      <PageHeader title={admin ? "成員管理" : "成員名單"} back="/me" sub={actor.groupName} />
      <Card className="py-1">
        {members.map((m) => (
          <div key={m.userId} className="py-3 border-b border-line last:border-0">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{m.displayName}</div>
                <div className="text-sm text-muted">帳號：{m.username}</div>
              </div>
              <div className="flex gap-1">
                <Badge tone={m.role === "ADMIN" ? "info" : "neutral"}>{m.role === "ADMIN" ? "管理者" : "成員"}</Badge>
                {!m.active ? <Badge tone="muted">已停用</Badge> : null}
              </div>
            </div>
            {admin && m.userId !== actor.userId ? <MemberOps userId={m.userId} role={m.role} active={m.active} /> : null}
          </div>
        ))}
      </Card>
      {admin ? (
        <>
          <SectionTitle>新增成員</SectionTitle>
          <Card>
            <AddMemberForm />
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted">新增或停用成員請聯絡管理者。</p>
      )}
    </>
  );
}
