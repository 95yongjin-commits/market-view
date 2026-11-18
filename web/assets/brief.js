/*! Daily Market View · 기획·개발 김용진 (한화투자증권 WM지원팀) · 2026.11 */
/* 오늘 한눈에: 수집된 숫자로 정해진 규칙에 따라 문장을 만든다(AI 해석 없음). 줄을 누르면 해당 섹션으로 이동. */
(function () {
  "use strict";
  function start() {
    const { $, esc, isN, num } = window.MV;
    const NC = "?t=" + Date.now();
    const get = (n) => fetch(`data/${n}.json${NC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const sg = (v, d = 1) => (isN(v) ? `${v > 0 ? "+" : ""}${v.toFixed(d)}` : "–");
    const P = (v, d = 1) => `<b class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${sg(v, d)}%</b>`;
    const BP = (v) => `<b class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${sg(v, 0)}bp</b>`;
    const WDK = ["일", "월", "화", "수", "목", "금", "토"];
    const md = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}(${WDK[d.getDay()]})`; };
    const tone = (v, hi, lo) => (v >= hi ? "강세" : v <= -hi ? "약세" : v >= lo ? "소폭 상승" : v <= -lo ? "소폭 하락" : "보합");

    // 모닝 브리핑은 아침 실행 때 만든 고정본(brief.json)만 쓴다 → 장중에 숫자가 바뀌지 않는다
    get("brief").then((b) => {
      if (!b) { $("#briefBox").innerHTML = `<div class="err">모닝 브리핑을 불러오지 못했습니다.</div>`; return; }
      const { global: g, rates: r, korea: k, calendar: c, themes: th } = b;
      const L = [];
      /* 1) 미국 증시 */
      if (g) {
        const f = (t) => g.indices.us.find((x) => x.ticker === t);
        const sp = f("^GSPC"), nq = f("^IXIC"), sox = f("^SOX");
        const secs = [...(g.us_sectors || [])].filter((x) => isN(x.pct)).sort((a, b) => b.pct - a.pct);
        if (nq) {
          L.push({ ico: "🌎", k: "美 증시", to: "#sec-index",
            t: `나스닥 ${P(nq.pct)}·S&P500 ${P(sp && sp.pct)}로 <em>${tone(nq.pct, 1, 0.3)}</em>` +
              (sox ? `, 반도체 ${P(sox.pct)}` : "") +
              (secs.length ? ` · 업종 1위 ${esc(secs[0].name)} ${P(secs[0].pct)}, 꼴찌 ${esc(secs[secs.length - 1].name)} ${P(secs[secs.length - 1].pct)}` : ""),
            d: `${md(nq.date)} 종가` });
        }
      }
      /* 2) 국내 증시 */
      if (g) {
        const ks = g.indices.kr.find((x) => x.ticker === "^KS11"), kq = g.indices.kr.find((x) => x.ticker === "^KQ11");
        const b = k && k.breadth && k.breadth.KOSPI;
        if (ks) L.push({ ico: "📊", k: "국내 증시", to: "#sec-index",
          t: `코스피 ${num(ks.last, 2)} ${P(ks.pct)}, 코스닥 ${P(kq && kq.pct)}로 <em>${tone(ks.pct, 1, 0.3)}</em>` +
            (b ? ` · 코스피 상승 ${b.up} / 하락 ${b.down}종목` : ""), d: md(ks.date) });
      }
      /* 3) 금리·환율 */
      if (r) {
        const us = r.bonds.find((x) => x.code === "US10YT=RR"), kr3 = r.bonds.find((x) => x.code === "KR3YT=RR");
        const fx = r.fx.find((x) => x.code === "FX_USDKRW");
        const rw = (v) => (v >= 15 ? "급등" : v <= -15 ? "급락" : v >= 5 ? "상승" : v <= -5 ? "하락" : "안정");
        const fw = (v) => (v >= 1.5 ? "원화 약세" : v <= -1.5 ? "원화 강세" : "보합권");
        const parts = [];
        if (us) parts.push(`美 10년 ${us.last.toFixed(2)}%(1주 ${BP(us.bp1w)}, <em>${rw(us.bp1w)}</em>)`);
        if (kr3) parts.push(`국고 3년 ${kr3.last.toFixed(2)}%`);
        if (fx) parts.push(`원/달러 ${num(fx.last, 1)}(1주 ${P(fx.r1w)}, <em>${fw(fx.r1w)}</em>)`);
        if (parts.length) L.push({ ico: "💵", k: "금리·환율", to: "#sec-macro", t: parts.join(" · "), d: us ? md(us.date) : "" });
      }
      /* 4) 국내 업종 */
      if (k && k.sectors && k.sectors.KOSPI) {
        const s = k.sectors.KOSPI.filter((x) => isN(x.r1d) && x.count >= 5).sort((a, b) => b.r1d - a.r1d);
        if (s.length > 2) L.push({ ico: "🔥", k: "국내 업종", to: "#sec-sector",
          t: `강세 ${s.slice(0, 2).map((x) => `${esc(x.sector)} ${P(x.r1d)}`).join(", ")} · 약세 ${s.slice(-2).reverse().map((x) => `${esc(x.sector)} ${P(x.r1d)}`).join(", ")}`,
          d: `${md(k.date)} 코스피` });
      }
      /* 5) 수급 */
      if (k && k.flow && k.flow.KOSPI && k.flow.KOSPI.length) {
        const fl = k.flow.KOSPI, last = fl[fl.length - 1], s5 = fl.slice(-5).reduce((a, x) => a + (x["외국인"] || 0), 0);
        const jo = (v) => `<b class="${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "+" : ""}${num(v / 10000, 2)}조</b>`;
        const fb = k.tops && k.tops.foreign_buy_5d && k.tops.foreign_buy_5d[0], fs = k.tops && k.tops.foreign_sell_5d && k.tops.foreign_sell_5d[0];
        L.push({ ico: "👥", k: "수급", to: "#sec-flow",
          t: `코스피 외국인 당일 ${jo(last["외국인"])}, 5일 ${jo(s5)} <em>${s5 >= 10000 ? "순매수 지속" : s5 <= -10000 ? "순매도 지속" : "중립"}</em>` +
            (fb ? ` · 5일 순매수 1위 ${esc(fb.name)}` : "") + (fs ? `, 순매도 1위 ${esc(fs.name)}` : ""),
          d: md(last.date) });
      }
      /* 6) 오늘(또는 다음 영업일) 일정 */
      if (c) {
        const dates = [...new Set([...(c.events || []).map((e) => e.date), ...(c.earnings || []).map((e) => e.date), ...(c.notes || []).map((e) => e.date)])]
          .filter((d) => d >= c.today).sort();
        const d = dates[0];
        if (d) {
          const ev = (c.events || []).filter((e) => e.date === d && e.w >= 2).map((e) => e.name);
          const nt = (c.notes || []).filter((e) => e.date === d).map((e) => e.text);
          const er = (c.earnings || []).filter((e) => e.date === d).slice(0, 3).map((e) => e.name);
          const items = [...ev, ...nt].slice(0, 4);
          if (er.length) items.push(`실적: ${er.join(", ")}`);
          if (items.length) L.push({ ico: "📅", k: d === c.today ? "오늘 일정" : `${md(d)} 일정`, to: "#sec-cal",
            t: items.map(esc).join(" · "), d: "" });
        }
      }
      /* 7) 신기술 테마 */
      if (th && th.themes && th.themes.length) {
        L.push({ ico: "🧪", k: "신기술 테마", to: "#sec-theme",
          t: th.themes.filter((x) => x.stat).map((x) => `${esc(x.name)} 테마 1주 ${P(x.stat.r1w)}, 1개월 ${P(x.stat.r1m)}`).join(" · "), d: "" });
      }

      const cr = b.created || "", cd = cr.slice(0, 10);
      const nq = g && g.indices.us.find((x) => x.ticker === "^IXIC");
      // 다음 갱신: 다음 날(일요일이면 월요일) 06:30
      const nx = new Date(cd + "T00:00:00"); nx.setDate(nx.getDate() + 1); if (nx.getDay() === 0) nx.setDate(nx.getDate() + 1);
      const nxIso = `${nx.getFullYear()}-${String(nx.getMonth() + 1).padStart(2, "0")}-${String(nx.getDate()).padStart(2, "0")}`;
      $("#briefBox").innerHTML = L.length ? L.map((x) => `<a class="bf" href="${x.to}"><span class="bf-i">${x.ico}</span><span class="bf-k">${esc(x.k)}</span>
          <span class="bf-t">${x.t}</span><span class="bf-d">${esc(x.d)}</span></a>`).join("") : `<div class="err">요약을 만들 데이터가 없습니다.</div>`;
      $("#asof-brief").textContent = cr ? `${md(cd)} ${cr.slice(11)} 작성 · 美 ${nq ? md(nq.date) : "–"} 종가 · 국내 ${k && k.date ? md(k.date) : "–"} 마감` : "";
      $("#cad-brief").textContent = `⟳ 매일 06:30 갱신(월~토) · 장중 수치 변동은 반영되지 않습니다 · 다음 갱신 ${md(nxIso)} 06:30`;
    });
  }
  if (window.MV) start(); else document.addEventListener("mv:ready", start, { once: true });
})();
