"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { syncAction } from "@/app/actions";

export function SyncButton() {
  return (
    <ActionForm action={syncAction} className="shrink-0 text-right max-w-[55%]">
      <SubmitButton variant="secondary" className="btn-sm" pendingText="同步中…">
        立即同步
      </SubmitButton>
    </ActionForm>
  );
}
