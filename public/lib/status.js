// 카드 상태 문구의 색 구분. 진행 중이거나 예정인 표현을 먼저 본다("시행 예정"이 "시행"으로 읽히지 않게).
const PLAN = ["예정", "계획", "발표", "입법 중", "심사 중", "조사 중", "수사", "추진", "제소"];
const DONE = ["확정", "집행", "시행", "종결", "의결", "완료"];

export function statusTone(status) {
  const text = String(status ?? "");
  if (PLAN.some((word) => text.includes(word))) return "plan";
  if (DONE.some((word) => text.includes(word))) return "done";
  return "";
}
