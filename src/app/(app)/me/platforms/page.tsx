import { Badge, Card, PageHeader } from "@/components/ui";
import { requireActor } from "@/server/session";
import { listPlatforms } from "@/server/services/orders";
import { PlatformForm } from "./form";

export default async function PlatformsPage() {
  const actor = await requireActor();
  const list = await listPlatforms(actor);
  return (
    <>
      <PageHeader title="售票平台" back="/me" />
      <Card className="py-1">
        {list.map((p) => (
          <div key={p.id} className="list-row">
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm text-muted truncate">{p.webUrl ?? "無網址"}{p.appUrl ? `・App：${p.appUrl}` : ""}</div>
            </div>
            <Badge tone="muted">{p.groupId ? "群組新增" : "預設"}</Badge>
          </div>
        ))}
      </Card>
      <Card>
        <div className="font-semibold mb-2">新增售票平台</div>
        <PlatformForm />
      </Card>
    </>
  );
}
