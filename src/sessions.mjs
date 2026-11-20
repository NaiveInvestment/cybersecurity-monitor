// 실시간 폴러의 가동 구간 판정. 모두 KST 기준이며 휴장일은 따지지 않는다(휴장일에는 같은 종가가 다시 올라갈 뿐이다).
const KST_OFFSET_MS = 9 * 3600 * 1000;

// 한국 종목은 NXT 프리마켓부터 애프터마켓 마감까지 포함한다.
// 아시아 정규장(일본 종목, KRX 지수와 비교 종목)은 평일 08:55~15:40 KST.
// 미국 정규장: 평일 22:25 KST ~ 다음 날 06:10 KST. 서머타임(22:30~05:00)과 표준시(23:30~06:00)를 모두 덮는다.
const WINDOWS = {
  kr: { start: 8 * 60, end: 20 * 60 + 5 },
  asia: { start: 8 * 60 + 55, end: 15 * 60 + 40 },
  us: { start: 22 * 60 + 25, end: 6 * 60 + 10 },
};

function kstParts(date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return { day: shifted.getUTCDay(), minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes() };
}

export function activeSessions(date = new Date()) {
  const { day, minutes } = kstParts(date);
  const weekday = day >= 1 && day <= 5;
  const kr = weekday && minutes >= WINDOWS.kr.start && minutes < WINDOWS.kr.end;
  const asia = weekday && minutes >= WINDOWS.asia.start && minutes < WINDOWS.asia.end;
  // 미국장은 월~금 밤에 열려 화~토 새벽에 닫힌다.
  const usEvening = weekday && minutes >= WINDOWS.us.start;
  const usMorning = day >= 2 && day <= 6 && minutes < WINDOWS.us.end;
  return { kr, asia, us: usEvening || usMorning };
}

// 다음 구간 시작까지 남은 분. 이미 구간 안이면 0.
export function minutesToNextSession(date = new Date()) {
  for (let step = 0; step <= 4 * 24 * 60; step += 5) {
    const sessions = activeSessions(new Date(date.getTime() + step * 60000));
    if (sessions.kr || sessions.asia || sessions.us) return step;
  }
  return Infinity;
}
