/*! Daily Market View · 기획·개발 김용진 (한화투자증권 WM지원팀) · 2026.11 */
/* 좁은 화면: 아래 탭 바(묶음별 첫 섹션으로 이동) + 헤더의 '현재 섹션' 표시 */
(function () {
  "use strict";
  function start() {
    const { $, esc } = window.MV;
    const TABS = [
      ["☀", "브리핑", ["#sec-brief"]],
      ["📈", "시장", ["#sec-guide", "#sec-index", "#sec-macro", "#sec-cal"]],
      ["🧩", "섹터·종목", ["#sec-sector", "#sec-stocks", "#sec-vc", "#sec-theme"]],
      ["⚡", "시그널", ["#sec-scan", "#sec-flow", "#sec-ds", "#sec-news"]],
    ];
    const has = (h) => document.querySelector(h);
    const bar = document.createElement("nav");
    bar.className = "mtab"; bar.id = "mtab";
    bar.innerHTML = TABS.map(([i, l, hs], k) => `<a href="${hs.find(has) || "#"}" data-k="${k}"><i>${i}</i><span>${l}</span></a>`).join("") +
      `<button type="button" id="mtabAll"><i>☰</i><span>전체</span></button>`;
    document.body.appendChild(bar);
    $("#mtabAll").onclick = () => document.body.classList.add("drawer-open");

    const pill = document.createElement("button");
    pill.type = "button"; pill.className = "mcur"; pill.id = "mcur";
    $(".top").appendChild(pill);
    pill.onclick = () => document.body.classList.add("drawer-open");

    const secs = [...document.querySelectorAll("section.sec")];
    const name = (s) => { const h = s.querySelector(".sec-h h2"); return h ? h.textContent.trim() : ""; };
    let raf = 0;
    const update = () => {
      raf = 0;
      let cur = secs[0];
      for (const s of secs) if (s.getBoundingClientRect().top <= 120) cur = s;
      const id = "#" + cur.id;
      const k = TABS.findIndex((t) => t[2].includes(id));
      bar.querySelectorAll("a").forEach((a) => a.classList.toggle("on", +a.dataset.k === k));
      const g = k >= 0 ? TABS[k][1] : "";
      pill.innerHTML = `<span class="g">${esc(g)}</span><b>${esc(name(cur))}</b><span class="v">▾ 섹션 이동</span>`;
    };
    addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }
  if (window.MV) start(); else document.addEventListener("mv:ready", start, { once: true });
})();
