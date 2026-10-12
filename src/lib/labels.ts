export const GAME_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "尚未開賽",
  IN_PROGRESS: "比賽進行中",
  FINAL: "比賽結束",
  POSTPONED: "延期",
  CANCELLED: "取消",
  SUSPENDED: "保留比賽",
  OTHER: "其他狀態",
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "待購票",
  BUYING: "購票中",
  PURCHASED: "已購票",
  FAILED: "購票失敗",
  CANCELLED: "取消",
  REFUNDING: "退票處理中",
  REFUNDED: "已退款",
};

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  UNASSIGNED: "尚未分配",
  ASSIGNED: "已指定持有人",
  DELIVERED: "已完成交付",
  REVOKED: "已撤銷",
};

export const PICKUP_STATUS_LABEL: Record<string, string> = {
  NOT_PICKED: "尚未取票",
  PICKED: "已取票",
  FAILED: "取票失敗",
  REFUNDED: "已退票",
  NOT_APPLICABLE: "不適用",
};

export const FEE_MODE_LABEL: Record<string, string> = {
  BUYER_ABSORBS: "購票人自行吸收",
  EQUAL_HOLDERS: "持票人平均分攤",
  PER_TICKET: "按票數分攤",
  CUSTOM: "自訂各人金額",
};

export const REFUND_STATUS_LABEL: Record<string, string> = {
  PROCESSING: "退款中",
  COMPLETED: "已退款",
  CANCELLED: "已取消",
};

export const ATTENDANCE_LABEL: Record<string, string> = {
  PLANNED: "預計到場",
  ATTENDED: "已到場",
  ABSENT: "未到場",
};

export const CPBL_KIND: Record<string, string> = {
  A: "一軍例行賽",
  B: "一軍明星賽",
  C: "一軍總冠軍賽",
  D: "二軍例行賽",
  E: "一軍季後挑戰賽",
  F: "二軍總冠軍賽",
  G: "一軍熱身賽",
  H: "未來之星邀請賽",
  X: "國際交流賽",
};

export type Outcome = "WIN" | "LOSS" | "TIE" | "NONE";
export const OUTCOME_LABEL: Record<Outcome, string> = { WIN: "勝", LOSS: "敗", TIE: "和", NONE: "不計" };
