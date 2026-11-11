// 두 페이지가 함께 쓰는 화면 도우미: 이스케이프, 숫자 표기, 테마 전환, 데이터 로드.

export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const number = (value, digits = 0) => value.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 억원 값을 "1,234억" 또는 "12.3조"로.
export function fmtEok(value) {
  if (value == null) return "-";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${number(value / 1e4)}<span class="unit">조</span>`;
  if (abs >= 1e4) return `${number(value / 1e4, 1)}<span class="unit">조</span>`;
  return `${number(value, abs < 10 ? 1 : 0)}<span class="unit">억</span>`;
}

// 현지 통화 백만 단위 값을 "$1,471M", "$231.2B", "¥290.7B"로.
export function fmtLocalMillion(value, cur) {
  if (value == null) return "-";
  const symbol = cur === "JPY" ? "¥" : "$";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e5) return `${sign}${symbol}${number(abs / 1e3)}<span class="unit">B</span>`;
  if (abs >= 1e3) return `${sign}${symbol}${number(abs / 1e3, abs >= 1e4 ? 1 : 2)}<span class="unit">B</span>`;
  return `${sign}${symbol}${number(abs, abs < 10 ? 1 : 0)}<span class="unit">M</span>`;
}

export function fmtPrice(value, cur) {
  if (value == null) return "-";
  if (cur === "KRW") return number(value);
  if (cur === "JPY") return `¥${number(value)}`;
  return `$${number(value, 2)}`;
}

export function fmtPct(value, digits = 1) {
  if (value == null) return "-";
  return `${value > 0 ? "+" : ""}${number(value, digits)}%`;
}

export const signClass = (value) => (value == null ? "na" : value > 0 ? "pos" : value < 0 ? "neg" : "");

export function fmtKst(iso, withDate = true) {
  if (!iso) return "-";
  const date = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return withDate ? `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${time}` : time;
}

export async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export function initTheme() {
  const button = document.querySelector("[data-theme-toggle]");
  if (!button) return;
  const label = () => { button.textContent = document.documentElement.dataset.theme === "light" ? "다크 모드" : "라이트 모드"; };
  label();
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("csm-theme", next); } catch { /* 저장소를 못 써도 화면 전환은 된다 */ }
    label();
  });
}
