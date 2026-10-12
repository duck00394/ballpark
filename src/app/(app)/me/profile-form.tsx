"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { profileAction } from "@/app/actions";

export function ProfileForm({
  displayName,
  favoriteTeamId,
  followed,
  trackOtherTeams,
  teams,
}: {
  displayName: string;
  favoriteTeamId: string | null;
  followed: string[];
  trackOtherTeams: boolean;
  teams: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={profileAction}>
      <label className="field">
        <span className="field-label">顯示名稱</span>
        <input className="input" name="displayName" defaultValue={displayName} required />
      </label>
      <label className="field">
        <span className="field-label">最支持的球隊</span>
        <select className="select" name="favoriteTeamId" defaultValue={favoriteTeamId ?? ""}>
          <option value="">未設定</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="field-hint">拿到票時，若這隊有出賽，會自動預設為該場的支持球隊（每場仍可個別修改）。</span>
      </label>
      <fieldset className="field">
        <legend className="field-label">其他關注球隊</legend>
        <div className="grid-2">
          {teams.map((t) => (
            <label key={t.id} className="check">
              <input type="checkbox" name="followedTeamIds" value={t.id} defaultChecked={followed.includes(t.id)} />
              <span>{t.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check">
        <input type="checkbox" name="trackOtherTeams" defaultChecked={trackOtherTeams} />
        <span>統計時分開顯示我支持過的各球隊戰績</span>
      </label>
      <SubmitButton block>儲存個人設定</SubmitButton>
    </ActionForm>
  );
}
