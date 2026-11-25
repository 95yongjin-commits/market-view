/*! Daily Market View · 기획·개발 김용진 (한화투자증권 WM지원팀) · 2026.11 */
/* 방문 통계(GoatCounter, 비공개 대시보드). 화면에는 아무것도 표시하지 않는다.
   페이지 열림은 count.js가 자동 집계, 아래는 어떤 메뉴·테마·공시를 눌렀는지만 이벤트로 보낸다. */
(function () {
  "use strict";
  const send = (path, title) => {
    try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path, title: title || path, event: true }); } catch (e) {}
  };
  const where = (el) => (el.closest("#side") ? "사이드바" : el.closest("#mtab") ? "하단탭" : el.closest("#nav") ? "상단메뉴" : "");
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a, button");
    if (!a) return;
    const h = a.getAttribute("href") || "";
    if (h.startsWith("#sec-") && where(a)) return send(`메뉴/${h.slice(5)}`, `${where(a)} · ${a.textContent.trim()}`);
    if (a.classList.contains("th-card") && a.dataset.id) return send(`테마/${a.dataset.id}`, `신기술 테마 · ${a.dataset.id}`);
    if (a.classList.contains("ds")) return send("공시/원문", "주요 공시 원문 열기");
    if (a.classList.contains("lk")) return send("추천자료/열기", "추천 영상·자료 열기");
  }, true);
})();
