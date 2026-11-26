/*! Daily Market View · 2026.11 */
/* 신기술 테마: 카드 목록 → 상세(개요 / 관련 기업 / 흐름 / 리스크·체크) */
(function () {
  "use strict";
  function start() {
    const { $, esc, isN, cls, pct, spark, seg, staleBadge, openModal, fmtPx } = window.MV;
    const NC = "?t=" + Date.now();
    const STAGES = ["태동", "기대", "확산", "검증"];
    const REL = { direct: ["직접", "테마 관련 제품·매출 있음"], indirect: ["간접", "업황 수혜, 직접 참여는 미확인"],
      expect: ["기대", "사업 계획 단계"], alt: ["대체 관계", "테마 확산 시 수요 잠식 가능"] };
    const CC = { KR: "국내", US: "미국", JP: "일본", TW: "대만", CN: "중국" };
    const sg = (el, arr, c, fn) => seg(el, arr.map(([k, l]) => ({ k, l })), c, fn);
    const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
    let DATA = null, cur = null, tab = "ov", stF = { area: "all", rel: "all", sort: "group" }, per = 63, lineSet = "all";

    fetch(`data/themes.json${NC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => {
      DATA = d; renderCards();
      const m = location.hash.match(/^#theme=([\w-]+)/);
      if (m) openTheme(m[1]);
    });

    /* ── 카드 ─────────────────────────────────────── */
    function renderCards() {
      const box = $("#thCards");
      if (!DATA || !DATA.themes) return (box.innerHTML = `<div class="err">테마 데이터를 불러오지 못했습니다.</div>`);
      $("#asof-th").innerHTML = `갱신 ${esc(DATA.updated || "")}` + staleBadge("themes");
      box.innerHTML = DATA.themes.map((t) => {
        const st = t.stat || {};
        const kr = t.stocks.filter((s) => s.country === "KR").length;
        return `<button type="button" class="th-card" data-id="${esc(t.id)}">
          <div class="th-top"><span class="th-tag">${esc(t.tag)}</span><span class="th-stg">${STAGES[t.stage - 1] || ""}</span></div>
          <div class="th-name">${esc(t.name)}<small>${esc(t.en)}</small></div>
          <p class="th-sum">${esc(t.summary)}</p>
          <div class="th-idx"><div><span class="k">테마 지수 1개월</span><span class="v ${cls(st.r1m)}">${pct(st.r1m)}</span></div>
            <div class="th-sp">${spark(st.spark, 160, 40)}</div></div>
          <div class="th-foot"><span>관련 기업 국내 ${kr} · 해외 ${t.stocks.length - kr}</span><span class="th-more">자세히 →</span></div>
        </button>`;
      }).join("") + `<div class="th-card th-soon"><b>다음 테마 준비 중</b><span>자료 검토 후 순차적으로 추가됩니다.</span></div>`;
      box.querySelectorAll(".th-card[data-id]").forEach((el) => (el.onclick = () => openTheme(el.dataset.id)));
    }

    /* ── 상세 ─────────────────────────────────────── */
    function openTheme(id, keepTab) {
      cur = DATA && DATA.themes.find((t) => t.id === id);
      if (!cur) return;
      if (!keepTab) tab = "ov";
      if (location.hash !== `#theme=${id}`) history.replaceState(null, "", `#theme=${id}`);
      const t = cur;
      $("#modalBox").classList.add("wide");
      $("#modalBox").innerHTML = `
        <div class="m-h"><div><h3>${esc(t.name)} <span class="th-en">${esc(t.en)}</span></h3>
          <div class="th-stage">${STAGES.map((s, i) => `<span class="${i === t.stage - 1 ? "on" : ""}">${s}</span>`).join("")}</div>
          <div class="s">${esc(t.stage_note || "")} · 내용 기준 ${esc(t.asof)}</div></div>
          <button type="button" class="m-x" id="mClose" aria-label="닫기">✕</button></div>
        <div class="seg th-tabs" id="thTabs"></div>
        <div id="thBody"></div>`;
      $("#modal").classList.add("show");
      $("#mClose").onclick = close;
      sg($("#thTabs"), [["ov", "개요"], ["st", "관련 기업"], ["fl", "흐름"], ["rk", "리스크·체크"]], tab, (k) => { tab = k; body(); $("#modalBox").scrollTop = 0; });
      body();
    }
    function close() {
      $("#modal").classList.remove("show");
      $("#modalBox").classList.remove("wide");
      if (location.hash.startsWith("#theme=")) history.replaceState(null, "", location.pathname + location.search);
    }
    // 바깥 클릭·ESC로 닫힐 때도 wide/해시 정리
    new MutationObserver(() => { if (!$("#modal").classList.contains("show")) { $("#modalBox").classList.remove("wide");
      if (location.hash.startsWith("#theme=")) history.replaceState(null, "", location.pathname + location.search); } })
      .observe($("#modal"), { attributes: true, attributeFilter: ["class"] });

    function body() {
      const el = $("#thBody");
      if (tab === "ov") el.innerHTML = overview(cur);
      if (tab === "st") return stocksTab(el);
      if (tab === "fl") return flowTab(el);
      if (tab === "rk") el.innerHTML = risks(cur);
    }

    function overview(t) {
      const blocks = (t.blocks || []).map((b, i) => {
        let inner = "";
        if (b.table) inner += `<div class="th-scroll"><table class="th-tbl"><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
          ${b.table.rows.map((r) => `<tr>${r.map((c, j) => (j ? `<td>${md(c)}</td>` : `<th>${md(c)}</th>`)).join("")}</tr>`).join("")}</table></div>`;
        if (b.pairs) inner += `<div class="th-pairs">${b.pairs.map(([h, x]) => `<div><b>${esc(h)}</b><p>${md(x)}</p></div>`).join("")}</div>`;
        if (b.timeline) inner += `<div class="th-tl">${b.timeline.map(([w, x]) => `<span class="w">${esc(w)}</span><span>${md(x)}</span>`).join("")}</div>`;
        if (b.list) inner += `<ul class="th-ul">${b.list.map((x) => `<li>${md(x)}</li>`).join("")}</ul>`;
        if (b.note) inner += `<p class="th-note">${md(b.note)}</p>`;
        return `<details class="th-det"${i === 0 ? " open" : ""}><summary>${esc(b.title)}${b.sub ? `<small>${esc(b.sub)}</small>` : ""}</summary>${inner}</details>`;
      }).join("");
      return `<p class="th-lead">${esc(t.summary)}</p>
        <div class="th-ana"><b>쉽게 말하면</b> ${md(t.analogy)}</div>
        <h4 class="th-h">왜 지금 주목받나</h4><ul class="th-ul">${t.why.map((x) => `<li>${md(x)}</li>`).join("")}</ul>
        ${blocks}`;
    }

    function stocksTab(el) {
      el.innerHTML = `<div class="controls th-ctl"><div class="seg" id="thArea"></div><div class="seg" id="thRel"></div><div class="seg" id="thSort"></div></div>
        <div class="th-scroll"><table class="th-st" id="thSt"></table></div>
        <p class="th-note">${Object.entries(REL).map(([k, [l, d]]) => `<span class="rel r-${k}">${l}</span> ${d}`).join(" &nbsp; ")}<br>종목을 누르면 차트가 열립니다. 해외는 현지 통화 기준입니다.</p>`;
      sg($("#thArea"), [["all", "전체"], ["kr", "국내"], ["gl", "해외"]], stF.area, (k) => { stF.area = k; rows(); });
      sg($("#thRel"), [["all", "연관도 전체"], ["direct", "직접"], ["indirect", "간접"], ["expect", "기대"], ["alt", "대체 관계"]], stF.rel, (k) => { stF.rel = k; rows(); });
      sg($("#thSort"), [["group", "단계순"], ["r1m", "1개월순"], ["ytd", "연초 이후순"]], stF.sort, (k) => { stF.sort = k; rows(); });
      rows();
    }
    function rows() {
      let list = cur.stocks.map((s, i) => ({ ...s, i }))
        .filter((s) => stF.area === "all" || (stF.area === "kr") === (s.country === "KR"))
        .filter((s) => stF.rel === "all" || s.rel === stF.rel);
      if (stF.sort !== "group") list.sort((a, b) => (isN(b[stF.sort]) ? b[stF.sort] : -1e9) - (isN(a[stF.sort]) ? a[stF.sort] : -1e9));
      let last = "";
      $("#thSt").innerHTML = `<tr><th>기업</th><th>연관도</th><th class="why">근거</th><th class="n">1일</th><th class="n">1개월</th><th class="n">연초 이후</th></tr>` +
        list.map((s) => {
          const g = stF.sort === "group" && s.group !== last ? `<tr class="grp"><td colspan="6">${esc(s.group)}</td></tr>` : "";
          last = s.group;
          const [rl] = REL[s.rel] || ["–"];
          return `${g}<tr class="row" data-i="${s.i}"><td class="nm"><b>${esc(s.name)}</b><span>${esc(s.ticker)} · ${CC[s.country] || s.country}</span></td>
            <td><span class="rel r-${s.rel}">${rl}</span></td><td class="why">${esc(s.why)}</td>
            <td class="n ${cls(s.pct)}">${pct(s.pct)}</td><td class="n ${cls(s.r1m)}">${pct(s.r1m)}</td><td class="n ${cls(s.ytd)}">${pct(s.ytd)}</td></tr>`;
        }).join("") + (list.length ? "" : `<tr><td colspan="6" class="empty">해당 조건의 기업이 없습니다.</td></tr>`);
      $("#thSt").querySelectorAll("tr.row").forEach((tr) => (tr.onclick = () => stockChart(cur.stocks[+tr.dataset.i])));
    }
    function stockChart(s) {
      const id = cur.id;
      openModal({ name: `${cur.name} · ${s.group}` }, { ...s, mcap: s.country === "KR" && s.cap ? s.cap / 1e4 : null }, s.ccy);
      const h = $("#modalBox .m-h");
      const b = document.createElement("button");
      b.type = "button"; b.className = "th-back"; b.textContent = `← ${cur.name} 테마로`;
      b.onclick = () => openTheme(id, true);
      h.parentNode.insertBefore(b, h);
    }

    /* 흐름: 테마 지수 vs KOSPI·나스닥 */
    function flowTab(el) {
      const ix = cur.index;
      if (!ix || !ix.theme) return (el.innerHTML = `<div class="err">테마 지수를 계산하지 못했습니다.</div>`);
      el.innerHTML = `<div class="controls th-ctl"><div class="seg" id="thPer"></div><div class="seg" id="thSet"></div></div>
        <div class="th-legend" id="thLeg"></div><div class="th-chart" id="thChart"></div>
        <div class="th-stats" id="thStats"></div>
        <h4 class="th-h">기업별 등락 <small id="thRankP"></small></h4><div class="th-rank" id="thRank"></div>
        <p class="th-note">테마 지수는 관련 기업 ${ix.members}곳(대체 관계 제외)의 하루 등락률을 같은 비중으로 평균해 이어 붙인 값입니다. 나라별 휴장일은 직전 종가로 채웠습니다. 시가총액 가중이 아니어서 소형주 움직임이 크게 반영됩니다.</p>`;
      sg($("#thPer"), [[21, "1개월"], [63, "3개월"], [126, "6개월"], [252, "1년"]], per, (k) => { per = +k; draw(); });
      sg($("#thSet"), [["all", "테마 전체"], ["split", "국내 vs 해외"]], lineSet, (k) => { lineSet = k; draw(); });
      draw();
    }
    function draw() {
      const ix = cur.index, n = ix.dates.length, from = Math.max(0, n - 1 - per);
      const L = lineSet === "all"
        ? [["theme", `${cur.name} 테마`, "var(--accent)", ""], ["kospi", "KOSPI", "var(--muted)", "5 4"], ["nasdaq", "나스닥", "var(--down)", "2 3"]]
        : [["kr", "국내 관련주", "var(--up)", ""], ["gl", "해외 관련주", "var(--down)", ""], ["kospi", "KOSPI", "var(--muted)", "5 4"]];
      const ser = L.filter(([k]) => ix[k]).map(([k, label, c, dash]) => {
        const raw = ix[k].slice(from), b = raw.find(isN);
        return { k, label, c, dash, v: raw.map((x) => (isN(x) && b ? (x / b - 1) * 100 : null)) };
      });
      const W = 640, H = 230, P = 6;
      const all = ser.flatMap((s) => s.v.filter(isN));
      const mn = Math.min(0, ...all), mx = Math.max(0, ...all), rg = mx - mn || 1, len = ser[0].v.length;
      const X = (i) => P + (i / (len - 1)) * (W - 2 * P), Y = (v) => H - P - ((v - mn) / rg) * (H - 2 * P);
      const path = (v) => v.map((x, i) => (isN(x) ? `${i && isN(v[i - 1]) ? "L" : "M"}${X(i).toFixed(1)} ${Y(x).toFixed(1)}` : "")).join("");
      $("#thChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" class="zero"/>
        ${ser.map((s) => `<path d="${path(s.v)}" fill="none" stroke="${s.c}" stroke-width="${s.k === "theme" || lineSet !== "all" && s.k !== "kospi" ? 2.2 : 1.4}" stroke-dasharray="${s.dash}" vector-effect="non-scaling-stroke"/>`).join("")}
        <line id="thCur" y1="0" y2="${H}" class="cur" style="display:none"/></svg>
        <div class="th-axis"><span>${ix.dates[from]}</span><span>${ix.dates[n - 1]}</span></div>
        <div class="th-tip" id="thTip"></div>`;
      const leg = (i) => ser.map((s) => { const v = i == null ? s.v[len - 1] : s.v[i];
        return `<span><i style="background:${s.c}"></i>${esc(s.label)} <b class="${cls(v)}">${pct(v)}</b></span>`; }).join("");
      $("#thLeg").innerHTML = leg();
      const svg = $("#thChart svg"), curL = $("#thCur");
      svg.onmousemove = (e) => {
        const r = svg.getBoundingClientRect(), i = Math.round(((e.clientX - r.left) / r.width) * (len - 1));
        if (i < 0 || i >= len) return;
        curL.style.display = ""; curL.setAttribute("x1", X(i)); curL.setAttribute("x2", X(i));
        $("#thLeg").innerHTML = `<span class="d">${ix.dates[from + i]}</span>` + leg(i);
      };
      svg.onmouseleave = () => { curL.style.display = "none"; $("#thLeg").innerHTML = leg(); };
      const st = cur.stat || {};
      $("#thStats").innerHTML = [["1일", st.pct], ["1주", st.r1w], ["1개월", st.r1m], ["3개월", st.r3m], ["연초 이후", st.ytd]]
        .map(([k, v]) => `<div><span class="k">테마 지수 ${k}</span><span class="v ${cls(v)}">${pct(v)}</span></div>`).join("");
      const key = per <= 21 ? "r1m" : per <= 63 ? "r3m" : "ytd";
      $("#thRankP").textContent = { r1m: "1개월", r3m: "3개월", ytd: "연초 이후" }[key] + " 기준" + (per > 63 ? " (6개월·1년 선택 시 연초 이후로 표시)" : "");
      const rs = cur.stocks.filter((s) => isN(s[key])).sort((a, b) => b[key] - a[key]);
      const am = Math.max(...rs.map((s) => Math.abs(s[key])), 1);
      $("#thRank").innerHTML = rs.map((s) => `<div class="rk"><span class="nm">${esc(s.name)}${s.rel === "alt" ? ' <em>대체</em>' : ""}</span>
        <span class="bar"><i class="${s[key] >= 0 ? "up" : "down"}" style="width:${(Math.abs(s[key]) / am) * 50}%;${s[key] >= 0 ? "left:50%" : `right:50%`}"></i></span>
        <span class="v ${cls(s[key])}">${pct(s[key])}</span></div>`).join("");
    }

    function risks(t) {
      return `<h4 class="th-h">반론과 리스크</h4><ul class="th-ul">${t.risks.map((x) => `<li>${md(x)}</li>`).join("")}</ul>
        <h4 class="th-h">앞으로 볼 체크포인트</h4><div class="th-tl">${t.checks.map(([w, x]) => `<span class="w">${esc(w)}</span><span>${md(x)}</span>`).join("")}</div>
        <h4 class="th-h">참고자료</h4><ul class="th-ul th-src">${t.sources.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <p class="th-disc">공개 자료를 바탕으로 정리한 참고용 설명이며, 특정 종목의 매수·매도 권유가 아닙니다. '관련 기업'은 기술과의 연관성을 뜻하며 수혜를 보장하지 않습니다.</p>`;
    }
  }
  if (window.MV) start(); else document.addEventListener("mv:ready", start, { once: true });
})();
