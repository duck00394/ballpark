import { Card, PageHeader } from "@/components/ui";
import { requireActor } from "@/server/session";
import { PasswordForm } from "./form";

export default async function PasswordPage() {
  await requireActor();
  return (
    <>
      <PageHeader title="修改密碼" back="/me" />
      <Card>
        <PasswordForm />
      </Card>
    </>
  );
}
