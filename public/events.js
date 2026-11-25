import { initTheme } from "./common.js";
initTheme();

function showCategory() {
  const company = window.location.hash === "#company";
  document.getElementById("policy").hidden = company;
  document.getElementById("company").hidden = !company;
  for (const link of document.querySelectorAll(".event-categories a")) {
    const selected = link.hash === (company ? "#company" : "#policy");
    if (selected) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", showCategory);
showCategory();
