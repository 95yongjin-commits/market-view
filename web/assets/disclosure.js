/*! Daily Market View · 2026.11 */
/* 주요 공시 (DART): 분류 버튼 + 날짜별 목록, 처음 20건만 */
(function () {
  "use strict";
  function start() {
    const { $, esc, seg, staleBadge } = window.MV;
    const NC = "?t=" + Date.now();
    const WDK = ["일", "월", "화", "수", "목", "금", "토"];
    const md = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()} (${WDK[d.getDay()]})`; };
    const CC = { 수주: "c-ord", 실적: "c-ern", 자본: "c-cap", 주주환원: "c-ret", 지배구조: "c-gov", 투자: "c-inv", 거래: "c-trd" };
    let D = null, cat = "all", all = false;

    fetch(`data/disclosures.json${NC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
      D = d;
      if (!D) { $("#dsList").innerHTML = `<div class="err">공시를 불러오지 못했습니다.</div>`; return; }
      $("#asof-ds").innerHTML = `갱신 ${esc(D.updated || "")} · 출처 DART` + staleBadge("disclosures");
      const cnt = (c) => D.items.filter((x) => c === "all" || x.cat === c).length;
      seg($("#dsCat"), [{ k: "all", l: `전체 ${cnt("all")}` }, ...D.cats.filter((c) => cnt(c)).map((c) => ({ k: c, l: `${c} ${cnt(c)}` }))], cat,
        (k) => { cat = k; all = false; render(); });
      render();
    });

    function render() {
      const list = D.items.filter((x) => cat === "all" || x.cat === cat);
      const show = all ? list : list.slice(0, 20);
      let last = "";
      $("#dsList").innerHTML = (show.length ? show.map((x) => {
        const h = x.date !== last ? `<div class="cal-day">${md(x.date)}</div>` : "";
        last = x.date;
        const fl = (x.flags || []).map((f) => `<span class="ds-f">${esc(f)}${f === "정정" && x.n > 1 ? ` ${x.n}회` : ""}</span>`).join("");
        return `${h}<a class="ds" href="${esc(x.url)}" target="_blank" rel="noopener">
          <span class="ds-c ${CC[x.cat] || ""}">${esc(x.cat)}</span>
          <span class="ds-n"><b>${esc(x.name)}</b><small>${esc(x.code)}${x.cap ? ` · 시총 ${x.cap >= 10000 ? (x.cap / 10000).toFixed(1) + "조" : Math.round(x.cap).toLocaleString() + "억"}` : ""}</small></span>
          <span class="ds-t">${esc(x.title)}${fl}</span><span class="ds-go">원문 ↗</span></a>`;
      }).join("") : `<p class="empty-s">해당 분류의 공시가 없습니다.</p>`) +
        (list.length > 20 ? `<button type="button" class="nt-more" id="dsMore">${all ? "접기" : `${list.length - 20}건 더 보기`}</button>` : "");
      const b = $("#dsMore");
      if (b) b.onclick = () => { all = !all; render(); };
    }
  }
  if (window.MV) start(); else document.addEventListener("mv:ready", start, { once: true });
})();
