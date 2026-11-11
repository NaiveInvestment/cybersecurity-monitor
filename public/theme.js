// 첫 그리기 전에 테마를 정한다. 저장된 선택이 없으면 시스템 설정을 따른다.
(function () {
  var stored = null;
  try { stored = localStorage.getItem("csm-theme"); } catch (error) { stored = null; }
  var system = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : system;
})();
