import { initTheme } from "./common.js";
initTheme();

const overview = document.getElementById("overview");
const grid = overview.querySelector(".overview-grid");
for (const period of document.querySelectorAll(".period")) {
  const group = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = period.querySelector("h3").textContent;
  const list = document.createElement("ul");
  for (const event of period.querySelectorAll("li")) {
    const link = document.createElement("a");
    link.href = "#" + event.id;
    link.id = "summary-" + event.id;
    const date = event.querySelector(".when").cloneNode(true);
    const title = document.createElement("span");
    title.textContent = event.querySelector("h4").textContent;
    const rating = event.querySelector(".event-rating").cloneNode(true);
    link.append(date, title, rating);
    const item = document.createElement("li");
    item.append(link);
    list.append(item);

    const back = document.createElement("a");
    back.className = "back-to-overview";
    back.href = "#" + link.id;
    back.textContent = "목록으로";
    event.querySelector(".sources").append(back);
  }
  group.append(heading, list);
  grid.append(group);
}
overview.hidden = !grid.childElementCount;

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
