"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { attendanceAction, createGameAction, gameResultAction, updateGameAction } from "@/app/actions";
import { GAME_STATUS_LABEL } from "@/lib/labels";

type Opt = { id: string; name: string };

export function GameForm({
  teams,
  venues,
  initial,
  gameId,
  version,
}: {
  teams: Opt[];
  venues: Opt[];
  initial?: { date: string; time: string; homeTeamId: string; awayTeamId: string; venueId: string | null; gameType: string; league: string; name: string | null; note: string | null };
  gameId?: string;
  version?: number;
}) {
  return (
    <ActionForm action={gameId ? updateGameAction : createGameAction}>
      {gameId ? (
        <>
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="version" value={version} />
        </>
      ) : null}
      <div className="grid-2">
        <label className="field">
          <span className="field-label">日期</span>
          <input className="input" type="date" name="date" required defaultValue={initial?.date} />
        </label>
        <label className="field">
          <span className="field-label">開賽時間</span>
          <input className="input" type="time" name="time" required defaultValue={initial?.time ?? "18:35"} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">客隊</span>
        <select className="select" name="awayTeamId" required defaultValue={initial?.awayTeamId ?? ""}>
          <option value="" disabled>請選擇</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">主隊</span>
        <select className="select" name="homeTeamId" required defaultValue={initial?.homeTeamId ?? ""}>
          <option value="" disabled>請選擇</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span className="field-label">球場</span>
        <select className="select" name="venueId" defaultValue={initial?.venueId ?? ""}>
          <option value="">未定</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">賽事類型</span>
          <input className="input" name="gameType" defaultValue={initial?.gameType ?? "例行賽"} list="game-types" />
          <datalist id="game-types">
            {["例行賽", "季後挑戰賽", "總冠軍賽", "熱身賽", "明星賽", "國際賽", "二軍"].map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">聯盟</span>
          <input className="input" name="league" defaultValue={initial?.league ?? "CPBL"} />
        </label>
      </div>
      <label className="field">
        <span className="field-label">賽事名稱（選填）</span>
        <input className="input" name="name" defaultValue={initial?.name ?? ""} placeholder="例如：主題日、冠軍賽 G7" />
      </label>
      <label className="field">
        <span className="field-label">備註</span>
        <textarea className="textarea" name="note" defaultValue={initial?.note ?? ""} />
      </label>
      <SubmitButton block>{gameId ? "儲存比賽資料" : "新增比賽"}</SubmitButton>
    </ActionForm>
  );
}

export function ResultForm({
  gameId,
  version,
  status,
  homeScore,
  awayScore,
  resultConfirmed,
  homeName,
  awayName,
  official,
}: {
  gameId: string;
  version: number;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  resultConfirmed: boolean;
  homeName: string;
  awayName: string;
  official: boolean;
  manualLock: boolean;
}) {
  const [st, setSt] = useState(status);
  return (
    <ActionForm action={gameResultAction}>
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="version" value={version} />
      <label className="field">
        <span className="field-label">比賽狀態</span>
        <select className="select" name="status" value={st} onChange={(e) => setSt(e.target.value)}>
          {Object.entries(GAME_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <div className="grid-2">
        <label className="field">
          <span className="field-label">客隊 {awayName} 得分</span>
          <input className="input" name="awayScore" type="number" inputMode="numeric" min={0} defaultValue={awayScore ?? ""} />
        </label>
        <label className="field">
          <span className="field-label">主隊 {homeName} 得分</span>
          <input className="input" name="homeScore" type="number" inputMode="numeric" min={0} defaultValue={homeScore ?? ""} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" name="resultConfirmed" defaultChecked={resultConfirmed} disabled={st !== "FINAL"} />
        <span>正式確認比賽結果（確認後才計入勝敗統計）</span>
      </label>
      {official ? (
        <label className="check">
          <input type="checkbox" name="manualLock" defaultChecked />
          <span>鎖定手動結果，之後同步不覆蓋狀態與比分</span>
        </label>
      ) : null}
      <SubmitButton block>儲存結果</SubmitButton>
    </ActionForm>
  );
}

export function AttendanceForm({
  gameId,
  userId,
  status,
  supportTeamId,
  teams,
}: {
  gameId: string;
  userId: string;
  status: string | null;
  supportTeamId: string | null;
  teams: Opt[];
}) {
  return (
    <ActionForm action={attendanceAction}>
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="userId" value={userId} />
      <fieldset className="field">
        <legend className="field-label">這場是否到場</legend>
        <div className="grid-3">
          {[
            ["ATTENDED", "已到場"],
            ["PLANNED", "預計到場"],
            ["ABSENT", "沒去"],
          ].map(([v, l]) => (
            <label key={v} className="check">
              <input type="radio" name="status" value={v} defaultChecked={(status ?? "PLANNED") === v} />
              <span>{l}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend className="field-label">這場支持哪一隊</legend>
        <div className="grid-3">
          {teams.map((t) => (
            <label key={t.id} className="check">
              <input type="radio" name="supportTeamId" value={t.id} defaultChecked={supportTeamId === t.id} />
              <span>{t.name}</span>
            </label>
          ))}
          <label className="check">
            <input type="radio" name="supportTeamId" value="" defaultChecked={!supportTeamId} />
            <span>不選邊</span>
          </label>
        </div>
      </fieldset>
      <SubmitButton block>儲存觀賽紀錄</SubmitButton>
    </ActionForm>
  );
}
