// 첫 그리기 전에 테마를 정한다. 저장된 선택이 있으면 그것을, 없으면 문서의 기본값(다크)을 쓴다.
// 기본을 다크로 둔 것은 같은 계열인 홍대현 Universe의 모니터 다크 기본과 맞추기 위해서다.
(function () {
  var root = document.documentElement;
  var stored = null;
  try { stored = localStorage.getItem("csm-theme"); } catch (error) { stored = null; }
  var fallback = root.getAttribute("data-default-theme") === "light" ? "light" : "dark";
  root.dataset.theme = stored === "light" || stored === "dark" ? stored : fallback;
})();
