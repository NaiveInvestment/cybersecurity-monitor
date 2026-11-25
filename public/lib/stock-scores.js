// 제공된 기본 점수는 브라우저에서 개인 설정으로 덮어쓸 수 있다.
const prefix = "csm.stock-score.";
const scores = new Map();
const initial = new Map();

function readScore(id) {
  let value;
  try { value = localStorage.getItem(prefix + id); } catch { value = null; }
  if (value === null) return initial.get(id);
  if (!value.trim()) return undefined;
  const score = Number(value);
  return Number.isFinite(score) ? score : initial.get(id);
}

export const stockScore = id => scores.get(id);

export function bindScores(stocks, defaults, render) {
  for (const { id } of stocks) {
    if (Number.isFinite(defaults?.[id])) initial.set(id, defaults[id]);
    scores.set(id, readScore(id));
  }

  const table = document.querySelector("#table-wrap");
  const dialog = document.querySelector("#score-dialog");
  const form = dialog.querySelector("form");
  const input = form.elements.score;
  const error = dialog.querySelector("[role=alert]");
  let editing;

  table.addEventListener("click", event => {
    const button = event.target.closest("[data-edit-score]");
    if (!button) return;
    editing = button.dataset.editScore;
    dialog.querySelector("h2").textContent = button.getAttribute("aria-label");
    input.value = stockScore(editing) ?? "";
    error.textContent = "";
    dialog.showModal();
    input.focus();
    input.select();
  });
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const value = input.value === "" ? undefined : input.valueAsNumber;
    try {
      if (value === initial.get(editing)) localStorage.removeItem(prefix + editing);
      else localStorage.setItem(prefix + editing, value === undefined ? "" : String(value));
    } catch {
      error.textContent = "이 브라우저에서 저장할 수 없습니다. 브라우저의 사이트 저장 설정을 확인하세요.";
      return;
    }
    scores.set(editing, value);
    render();
    dialog.close();
  });
  dialog.addEventListener("close", () => {
    table.querySelector('[data-edit-score="' + CSS.escape(editing) + '"]')?.focus({ preventScroll: true });
  });
  window.addEventListener("storage", event => {
    if (event.key === null) {
      for (const id of scores.keys()) scores.set(id, readScore(id));
    } else {
      if (!event.key.startsWith(prefix)) return;
      const id = event.key.slice(prefix.length);
      if (!scores.has(id)) return;
      scores.set(id, readScore(id));
    }
    render();
  });
}
