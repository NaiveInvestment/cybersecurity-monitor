import { initTheme } from "./common.js";
initTheme();

const overview = document.getElementById("overview");
const table = overview.querySelector("table");
for (const period of document.querySelectorAll(".period")) {
  const group = table.createTBody();
  const heading = document.createElement("th");
  heading.scope = "rowgroup";
  heading.colSpan = 5;
  heading.textContent = period.querySelector("h3").textContent;
  group.insertRow().append(heading);

  for (const event of period.querySelectorAll("li")) {
    const row = group.insertRow();
    row.className = "calendar-row";
    row.insertCell().textContent = event.querySelector(".when").textContent;
    row.insertCell().append(event.querySelector(".event-rating").cloneNode(true));

    const link = document.createElement("a");
    link.href = "#" + event.id;
    link.id = "summary-" + event.id;
    link.textContent = event.querySelector("h4").textContent;
    row.insertCell().append(link);

    const sector = document.createElement("span");
    sector.className = "sector-label";
    sector.textContent = event.dataset.sector || "기타";
    row.insertCell().append(sector);
    row.insertCell().textContent = event.dataset.impact || "수혜 대상 미정";
    row.addEventListener("click", (e) => {
      if (!e.target.closest("a") && !window.getSelection()?.toString()) link.click();
    });

    const back = document.createElement("a");
    back.className = "back-to-overview";
    back.href = "#" + link.id;
    back.textContent = "목록으로";
    event.querySelector(".sources").append(back);
  }
}
overview.hidden = !table.tBodies.length;

function showCategory() {
  const company = window.location.hash === "#company";
  document.getElementById("policy").hidden = company;
  document.getElementById("company").hidden = !company;
  for (const link of document.querySelectorAll(".event-categories a")) {
    const selected = link.hash === (company ? "#company" : "#policy");
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (/^#(?:summary-)?event-/.test(location.hash)) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start" });
    }
  }
}
window.addEventListener("hashchange", showCategory);
showCategory();
