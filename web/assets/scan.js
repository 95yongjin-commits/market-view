/* 섹터 밸류체인 + 차트 포착기 (app.js 의 window.MV 공용 함수 사용) */
(function () {
  "use strict";
  function start() {
    const { $, esc, isN, cls, sgn, num, pct, spark, seg, staleBadge, openModal, fmtPx } = window.MV;
    const NC = "?t=" + Date.now();
    const get = (n) => fetch(`data/${n}.json${NC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    /* ════════ 섹터 밸류체인 ════════ */
    const VC = { sec: 0, per: "1D" };
    const VKEY = { "1D": "pct", "1W": "r1w", "1M": "r1m" };
    const VSCALE = { "1D": 5, "1W": 10, "1M": 20 }; // 이 폭(%)에서 색이 가장 진함
    let vcData;
    const median = (a) => { const v = a.filter(isN).sort((x, y) => x - y); if (!v.length) return null; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    function heat(v) {
      if (!isN(v)) return "";
      const a = Math.min(Math.abs(v) / VSCALE[VC.per], 1) * 0.55 + 0.06;
      return `background:color-mix(in srgb, var(--${v >= 0 ? "up" : "down"}) ${Math.round(a * 100)}%, var(--card))`;
    }
    function renderVC() {
      if (!vcData) return ($("#vcFlow").innerHTML = `<div class="err">밸류체인 데이터를 불러오지 못했습니다.</div>`);
      const sec = vcData.sectors[VC.sec], key = VKEY[VC.per], flow = sec.flow !== false;
      $("#vcFlow").classList.toggle("noflow", !flow);
      $("#vcHint").textContent = flow ? "단계는 공정 순서(왼쪽 → 오른쪽)이고, 칸 색이 진할수록 등락폭이 큽니다. 종목을 누르면 차트가 열립니다."
        : `${sec.name}은 공정 순서가 아니라 ${sec.kind || "구분"}입니다. 칸 색이 진할수록 등락폭이 크고, 종목을 누르면 차트가 열립니다.`;
      $("#asof-vc").innerHTML = `갱신 ${vcData.updated} · <span class="stale">${esc(vcData.note || "초안")}</span>` + staleBadge("valuechain");
      const stages = sec.stages.map((st) => ({ ...st, med: median(st.stocks.map((s) => s[key])) }));
      const mx = Math.max(0.5, ...stages.map((s) => Math.abs(s.med || 0)));
      $("#vcStrength").innerHTML = `<div class="vs-t">${flow ? "단계별" : esc(sec.kind || "구분") + "별"} 강도 <span class="muted">(중앙값)</span></div><div class="vs-row">` + stages.map((st) => {
        const w = isN(st.med) ? (Math.abs(st.med) / mx) * 100 : 0;
        return `<div class="vs"><span class="vs-n">${esc(st.name)}</span><span class="vs-bar"><i class="${cls(st.med)}" style="width:${Math.max(w, 3)}%"></i></span><b class="${cls(st.med)}">${pct(st.med, 1)}</b></div>`;
      }).join("") + "</div>";
      $("#vcFlow").innerHTML = stages.map((st, i) => {
        const kr = st.stocks.filter((s) => s.country === "KR").sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9));
        const us = st.stocks.filter((s) => s.country === "US").sort((a, b) => (b[key] ?? -1e9) - (a[key] ?? -1e9));
        const tile = (s) => `<button type="button" class="vt" data-t="${esc(s.ticker)}" style="${heat(s[key])}" title="${esc(s.role || "")}">
            <span class="vt-n">${esc(s.name)}</span><span class="vt-p">${pct(s[key])}</span><span class="vt-r">${esc(s.role || "")}</span></button>`;
        return `${i && flow ? '<div class="vc-arrow">›</div>' : ""}<div class="vc-col">
          <div class="vc-h">${flow ? `<span class="vc-no">${i + 1}</span>` : ""}<b>${esc(st.name)}</b><span class="${cls(st.med)}">${pct(st.med, 1)}</span></div>
          <div class="vc-sub">${esc(st.sub || "")}</div>
          ${kr.length ? `<div class="vc-ctry">국내</div>${kr.map(tile).join("")}` : ""}
          ${us.length ? `<div class="vc-ctry">미국</div>${us.map(tile).join("")}` : ""}</div>`;
      }).join("");
      $("#vcFlow").onclick = (e) => {
        const b = e.target.closest(".vt");
        if (!b) return;
        const st = sec.stages.find((x) => x.stocks.some((s) => s.ticker === b.dataset.t));
        const s = st.stocks.find((x) => x.ticker === b.dataset.t);
        const isKr = s.country === "KR";
        openModal({ name: `${sec.name} · ${st.name}` }, { ...s, mcap: isKr && s.cap ? s.cap / 1e4 : null }, isKr ? "KRW" : "USD");
      };
    }
    function initVC() {
      seg($("#vcSec"), vcData.sectors.map((s, i) => ({ k: String(i), l: s.name })), "0", (k) => { VC.sec = +k; renderVC(); });
      seg($("#vcPer"), [{ k: "1D", l: "1일" }, { k: "1W", l: "1주" }, { k: "1M", l: "1개월" }], VC.per, (k) => { VC.per = k; renderVC(); });
      renderVC();
    }

    /* ════════ 차트 포착기 ════════ */
    const DEF = {
      kr: { ma: [5, 20, 60, 120], bbN: 20, bbK: 2, gcS: 5, gcL: 20, hold: 20, recent: 3, tol: 0, fibN: 120, fibMin: 20, fibLv: 61.8, fibTol: 2 },
      us: { ma: [5, 20, 50, 120], bbN: 20, bbK: 2, gcS: 5, gcL: 20, hold: 20, recent: 3, tol: 0, fibN: 120, fibMin: 20, fibLv: 61.8, fibTol: 2 },
    };
    const SC = { mkt: "kr", sector: "", cap: 0, sort: "cap", limit: 50, conds: new Set(), set: loadSet() };
    let scData, computed = null;
    function loadSet() {
      try { const s = JSON.parse(localStorage.getItem("mv-scan-set") || "null"); if (s && s.kr && s.us) return { kr: { ...DEF.kr, ...s.kr }, us: { ...DEF.us, ...s.us } }; } catch (e) {}
      return JSON.parse(JSON.stringify(DEF));
    }
    function saveSet() { try { localStorage.setItem("mv-scan-set", JSON.stringify(SC.set)); } catch (e) {} }
    const CONDS = () => {
      const p = SC.set[SC.mkt], m = p.ma.join(">");
      return [
        { g: `볼린저밴드 (${p.bbN}일, ${p.bbK}σ)`, items: [["bbAbove", "상단 위"], ["bbBreak", "오늘 상단 돌파"]] },
        { g: `정배열 (${m})`, items: [["alignHold", "정배열 유지"], ["alignNew", `${p.recent}일 내 전환`]] },
        { g: `골든크로스 (${p.gcS}일선 ↗ ${p.gcL}일선)`, items: [["gcHold", `유지 (${p.hold}일 이내 발생)`], ["gcNew", `${p.recent}일 내 발생`]] },
        { g: "신고가 (종가)" + (p.tol ? ` · -${p.tol}% 이내` : ""), items: [["hi52", "52주 신고가"], ["ath", "역사적 신고가"]] },
        { g: `피보나치 되돌림 (${p.fibN}일 상승파동 ${p.fibLv}% ±${p.fibTol}%)`, items: [["fibNear", "되돌림 레벨 근접"], ["fibBounce", `${p.recent}일 내 레벨 지지 후 반등`]] },
      ];
    };
    const LABEL = { bbAbove: "볼밴 상단 위", bbBreak: "볼밴 돌파", alignHold: "정배열", alignNew: "정배열 전환", gcHold: "골든크로스 유지", gcNew: "골든크로스", hi52: "52주 신고가", ath: "역사적 신고가", fibNear: "피보 레벨 근접", fibBounce: "피보 지지 반등" };

    function smaArr(c, n) {
      const out = new Array(c.length).fill(null);
      let s = 0, cnt = 0;
      for (let i = 0; i < c.length; i++) {
        if (c[i] == null) { s = 0; cnt = 0; continue; }
        s += c[i]; cnt++;
        if (cnt > n) { s -= c[i - n]; cnt = n; }
        if (cnt === n) out[i] = s / n;
      }
      return out;
    }
    function bbUpper(c, ma, n, k) {
      const out = new Array(c.length).fill(null);
      for (let i = n - 1; i < c.length; i++) {
        if (ma[i] == null) continue;
        let v = 0;
        for (let j = i - n + 1; j <= i; j++) v += (c[j] - ma[i]) ** 2;
        out[i] = ma[i] + k * Math.sqrt(v / n);
      }
      return out;
    }
    // 피보나치: 최근 fibN일 안의 고점(H)과 그 이전 저점(L)으로 상승파동을 잡고, 고점에서 fibLv% 되돌린 가격을 기준 레벨로 쓴다
    const FIB_LV = [0, 23.6, 38.2, 50, 61.8, 78.6, 100];
    function fibOf(c, t, p) {
      const s0 = Math.max(0, t - p.fibN + 1);
      let hi = -Infinity, hiI = -1, lo = Infinity, loI = -1;
      for (let i = s0; i <= t; i++) if (c[i] != null && c[i] > hi) { hi = c[i]; hiI = i; }
      for (let i = s0; i < hiI; i++) if (c[i] != null && c[i] < lo) { lo = c[i]; loI = i; }
      if (loI < 0 || hi / lo - 1 < p.fibMin / 100) return null;
      return { hi, lo, hiI, loI, lv: hi - ((hi - lo) * p.fibLv) / 100, at: (r) => hi - ((hi - lo) * r) / 100 };
    }
    // 조건이 '연속으로' 참인 마지막 구간 길이 (오늘부터 거꾸로). 중간에 데이터 없으면 Infinity(=발생 시점 모름)
    function runLen(fn, t) {
      let r = 0;
      for (let i = t; i >= 0; i--) { const v = fn(i); if (v === null) return i === t ? 0 : Infinity; if (!v) return r; r++; }
      return Infinity;
    }
    function computeStock(it, p) {
      const c = it[5], t = c.length - 1, last = c[t];
      if (last == null) return null;
      const [a, b, cc, d] = p.ma.map((n) => smaArr(c, n));
      const al = (i) => (d[i] == null ? null : a[i] > b[i] && b[i] > cc[i] && cc[i] > d[i]);
      const gs = smaArr(c, p.gcS), gl = smaArr(c, p.gcL);
      const up = (i) => (gl[i] == null ? null : gs[i] > gl[i]);
      const bm = smaArr(c, p.bbN), bu = bbUpper(c, bm, p.bbN, p.bbK);
      const prior = c.slice(Math.max(0, t - 251), t).filter((x) => x != null);
      const hi = prior.length ? Math.max(...prior) : null;
      const tol = 1 - (p.tol || 0) / 100;
      const alRun = runLen(al, t), gcRun = runLen(up, t);
      const fb = fibOf(c, t, p), ft = (p.fibTol || 0) / 100;
      let fibBounce = false;
      if (fb && fb.hiI < t - 1) {
        const w = c.slice(Math.max(fb.hiI + 1, t - p.recent), t).filter((x) => x != null);
        const mn = w.length ? Math.min(...w) : null;
        fibBounce = mn != null && mn <= fb.lv * (1 + ft) && mn >= fb.lv * (1 - ft) && last > fb.lv && last > c[t - 1];
      }
      const f = {
        bbAbove: bu[t] != null && last > bu[t],
        bbBreak: bu[t] != null && bu[t - 1] != null && last > bu[t] && c[t - 1] <= bu[t - 1],
        alignHold: alRun >= 1,
        alignNew: alRun >= 1 && alRun <= p.recent,
        gcHold: gcRun >= 1 && gcRun <= p.hold,
        gcNew: gcRun >= 1 && gcRun <= p.recent,
        hi52: prior.length >= 200 && last >= hi * tol,
        ath: isN(it[4]) && last >= it[4] * tol,
        fibNear: !!fb && fb.hiI < t && Math.abs(last / fb.lv - 1) <= ft,
        fibBounce,
      };
      const prev = c[t - 1];
      return { f, chg: prev ? (last / prev - 1) * 100 : null, fromHi: hi ? (last / Math.max(hi, last) - 1) * 100 : null, gcRun, alRun };
    }
    function computeAll() {
      const d = scData[SC.mkt], p = SC.set[SC.mkt];
      computed = d.items.map((it) => ({ it, r: computeStock(it, p) })).filter((x) => x.r);
    }
    function capOpts() {
      return SC.mkt === "kr"
        ? [[0, "시총 전체 (1천억↑)"], [3000, "3천억 이상"], [10000, "1조 이상"], [50000, "5조 이상"]]
        : [[0, "시총 전체 ($10B↑)"], [5e10, "$50B 이상"], [2e11, "$200B 이상"]];
    }
    const capTxt = (v) => (SC.mkt === "kr" ? (v >= 10000 ? `${num(v / 10000, 1)}조` : `${Math.round(v).toLocaleString()}억`) : `$${v >= 1e12 ? num(v / 1e12, 2) + "T" : Math.round(v / 1e9) + "B"}`);

    function renderFilters() {
      const d = scData[SC.mkt];
      const secs = [...new Set(d.items.map((x) => x[2]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
      $("#scSector").innerHTML = `<option value="">섹터 전체</option>` + secs.map((s) => `<option ${s === SC.sector ? "selected" : ""}>${esc(s)}</option>`).join("");
      $("#scCap").innerHTML = capOpts().map(([v, l]) => `<option value="${v}" ${+v === SC.cap ? "selected" : ""}>${l}</option>`).join("");
      $("#asof-scan").innerHTML = `${SC.mkt === "kr" ? "국내" : "미국"} ${d.dates[d.dates.length - 1]} 기준 · ${d.items.length.toLocaleString()}종목 · 야후 수정주가` + staleBadge("scan");
    }
    function pool() {
      return computed.filter(({ it }) => (!SC.sector || it[2] === SC.sector) && it[3] >= SC.cap);
    }
    function renderConds() {
      const base = pool();
      $("#scConds").innerHTML = CONDS().map((g) => `<div class="cg"><div class="cg-t">${esc(g.g)}</div>
        ${g.items.map(([k, l]) => `<label class="ck ${SC.conds.has(k) ? "on" : ""}"><input type="checkbox" data-k="${k}" ${SC.conds.has(k) ? "checked" : ""}>${esc(l)}<em>${base.filter((x) => x.r.f[k]).length}</em></label>`).join("")}</div>`).join("");
    }
    function renderResult() {
      const conds = [...SC.conds];
      const rows = pool().filter(({ r }) => conds.every((k) => r.f[k]));
      const sorters = { cap: (a, b) => b.it[3] - a.it[3], chg: (a, b) => (b.r.chg ?? -1e9) - (a.r.chg ?? -1e9), hi: (a, b) => (b.r.fromHi ?? -1e9) - (a.r.fromHi ?? -1e9) };
      rows.sort(sorters[SC.sort]);
      $("#scCount").innerHTML = conds.length ? `<b>${rows.length.toLocaleString()}</b>종목이 ${conds.map((k) => `<span class="tag">${LABEL[k]}</span>`).join(" + ")} 조건을 모두 만족` : `위에서 조건을 골라주세요 <span class="muted">(전체 ${rows.length.toLocaleString()}종목)</span>`;
      if (!conds.length) { $("#scTable").innerHTML = `<div class="empty-s" style="padding:18px">조건을 하나 이상 선택하면 결과가 나옵니다.</div>`; $("#scMore").style.display = "none"; return; }
      const ccy = SC.mkt === "kr" ? "KRW" : "USD";
      $("#scTable").innerHTML = rows.length ? `<table class="t"><thead><tr><th>#</th><th style="text-align:left">종목</th><th>시총</th><th>현재가</th><th>등락률</th><th>52주 고점 대비</th><th style="text-align:left">충족 조건</th><th></th></tr></thead><tbody>` +
        rows.slice(0, SC.limit).map(({ it, r }, i) => {
          const tags = Object.keys(LABEL).filter((k) => r.f[k]).map((k) => `<span class="tag ${SC.conds.has(k) ? "hl" : ""}">${LABEL[k]}</span>`).join("");
          return `<tr class="sr" data-t="${esc(it[0])}"><td class="muted">${i + 1}</td><td class="nm">${esc(it[1])}<span class="tk">${esc(it[0])}${it[2] ? " · " + esc(it[2]) : ""}</span></td>
            <td>${capTxt(it[3])}</td><td class="v">${fmtPx(it[5][it[5].length - 1], ccy)}</td><td>${`<span class="${cls(r.chg)}">${pct(r.chg)}</span>`}</td>
            <td><span class="${cls(r.fromHi)}">${pct(r.fromHi, 1)}</span></td><td class="tags">${tags}</td><td class="sp">${spark(it[5].slice(-60), 70, 22)}</td></tr>`;
        }).join("") + `</tbody></table>` : `<div class="empty-s" style="padding:18px">조건을 모두 만족하는 종목이 없습니다.</div>`;
      $("#scMore").style.display = rows.length > SC.limit ? "block" : "none";
    }
    function renderScan() {
      if (!scData) return;
      computeAll(); renderFilters(); renderConds(); renderResult(); renderSettings();
    }

    /* 기준값 설정 */
    function setBtn() {
      const changed = JSON.stringify(SC.set[SC.mkt]) !== JSON.stringify(DEF[SC.mkt]);
      $("#scSetBtn").innerHTML = `⚙ 기준값 설정${changed ? ' <span class="tag hl">변경됨</span>' : ""}`;
    }
    function renderSettings() {
      const p = SC.set[SC.mkt];
      setBtn();
      const inp = (k, v, lbl, w = 52, step = 1) => `<label>${lbl}<input type="number" min="0" step="${step}" data-k="${k}" value="${v}" style="width:${w}px"></label>`;
      $("#scSettings").innerHTML = `<div class="ss-row"><b>${SC.mkt === "kr" ? "국내" : "미국"} 기준값</b><span class="muted">브라우저에 저장되어 다음에도 유지됩니다</span></div>
        <div class="ss-row">${inp("ma0", p.ma[0], "정배열 이평선")}${inp("ma1", p.ma[1], "&gt;")}${inp("ma2", p.ma[2], "&gt;")}${inp("ma3", p.ma[3], "&gt;")}</div>
        <div class="ss-row">${inp("bbN", p.bbN, "볼린저 기간")}${inp("bbK", p.bbK, "표준편차 배수", 52, 0.5)}</div>
        <div class="ss-row">${inp("gcS", p.gcS, "골든크로스 단기선")}${inp("gcL", p.gcL, "장기선")}${inp("hold", p.hold, "유지 인정 기간(일)")}</div>
        <div class="ss-row">${inp("recent", p.recent, "'최근 발생' 기간(일)")}${inp("tol", p.tol, "신고가 근접 허용(%)", 52, 0.5)}</div>
        <div class="ss-row">${inp("fibN", p.fibN, "피보나치 파동 구간(일)")}${inp("fibMin", p.fibMin, "최소 상승폭(%)")}
          <label>되돌림 레벨<select class="sel" data-k="fibLv">${[23.6, 38.2, 50, 61.8, 78.6].map((v) => `<option value="${v}" ${v === p.fibLv ? "selected" : ""}>${v}%</option>`).join("")}</select></label>${inp("fibTol", p.fibTol, "레벨 ± 허용(%)", 52, 0.5)}</div>
        <div class="ss-row"><button type="button" class="ghost-btn" id="ssReset">기본값으로</button></div>`;
      $("#scSettings").oninput = (e) => {
        const k = e.target.dataset.k; if (!k) return;
        const v = parseFloat(e.target.value); if (!isFinite(v) || v < 0) return;
        if (k.startsWith("ma")) p.ma[+k.slice(2)] = Math.max(1, Math.round(v));
        else if (k === "fibN") p[k] = Math.min(255, Math.max(10, Math.round(v)));
        else p[k] = ["bbK", "tol", "fibLv", "fibTol", "fibMin"].includes(k) ? v : Math.max(1, Math.round(v));
        saveSet(); clearTimeout(renderSettings.t);
        renderSettings.t = setTimeout(() => { computeAll(); renderConds(); renderResult(); setBtn(); }, 250);
      };
      const r = $("#ssReset"); if (r) r.onclick = () => { SC.set[SC.mkt] = JSON.parse(JSON.stringify(DEF[SC.mkt])); saveSet(); renderScan(); };
    }

    /* 종목 차트 (이평선·볼린저·신고가선) */
    function chartModal(it) {
      const p = SC.set[SC.mkt], c = it[5], n = Math.min(180, c.length), off = c.length - n;
      const mas = p.ma.map((m) => smaArr(c, m).slice(off));
      const bm = smaArr(c, p.bbN), bu = bbUpper(c, bm, p.bbN, p.bbK).slice(off);
      const bl = bm.slice(off).map((m, i) => (m == null || bu[i] == null ? null : 2 * m - bu[i]));
      const cs = c.slice(off);
      const prior = c.slice(Math.max(0, c.length - 252), c.length - 1).filter((x) => x != null);
      const hi52 = prior.length ? Math.max(...prior) : null;
      const fb = fibOf(c, c.length - 1, p);
      const fibIn = fb && fb.loI >= off;
      const vals = [...cs, ...bu, ...bl, ...mas.flat(), ...(fibIn ? [fb.hi, fb.lo] : [])].filter(isN);
      const mn = Math.min(...vals), mx = Math.max(...vals, hi52 || -Infinity) || 1, W = 600, H = 230, rg = mx - mn || 1;
      const X = (i) => (i / (n - 1)) * W, Y = (v) => H - 4 - ((v - mn) / rg) * (H - 8);
      const path = (arr) => { let d = "", on = false; arr.forEach((v, i) => { if (v == null) { on = false; return; } d += (on ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); on = true; }); return d; };
      const MC = ["#f5a524", "#e5484d", "#8b5cf6", "#22a06b"];
      let band = "";
      const pts = bu.map((v, i) => (v != null && bl[i] != null ? [X(i), Y(v), Y(bl[i])] : null)).filter(Boolean);
      if (pts.length) band = `<path d="M${pts.map((q) => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L")}L${pts.slice().reverse().map((q) => q[0].toFixed(1) + " " + q[2].toFixed(1)).join("L")}Z" fill="var(--accent)" opacity=".08"/>`;
      const hline = hi52 && hi52 <= mx ? `<line x1="0" x2="${W}" y1="${Y(hi52)}" y2="${Y(hi52)}" stroke="var(--muted)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>` : "";
      const fibSvg = fibIn ? FIB_LV.map((r) => { const y = Y(fb.at(r)).toFixed(1), on = r === p.fibLv;
          return `<line x1="${X(fb.loI - off).toFixed(1)}" x2="${W}" y1="${y}" y2="${y}" stroke="${on ? "#f5a524" : "var(--muted)"}" stroke-width="${on ? 1.4 : 0.8}" stroke-dasharray="${on ? "6 3" : "2 4"}" opacity="${on ? 1 : 0.6}" vector-effect="non-scaling-stroke"/>`; }).join("") : "";
      const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:230px;display:block;margin:10px 0 4px">${band}${hline}${fibSvg}
        ${mas.map((m, k) => `<path d="${path(m)}" fill="none" stroke="${MC[k]}" stroke-width="1.1" opacity=".9" vector-effect="non-scaling-stroke"/>`).join("")}
        <path d="${path(cs)}" fill="none" stroke="var(--ink)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
      const r = computed.find((x) => x.it === it).r;
      const ccy = SC.mkt === "kr" ? "KRW" : "USD";
      const link = SC.mkt === "kr" ? `https://m.stock.naver.com/domestic/stock/${it[0]}/total` : `https://finance.yahoo.com/quote/${encodeURIComponent(it[0])}`;
      $("#modalBox").innerHTML = `<div class="m-h"><div><h3>${esc(it[1])}</h3><div class="s">${esc(it[0])}${it[2] ? " · " + esc(it[2]) : ""} · 시총 ${capTxt(it[3])}</div></div>
        <button type="button" class="m-x" id="mClose">✕</button></div>
        <div class="m-px">${fmtPx(cs[cs.length - 1], ccy)}<span class="${cls(r.chg)}">${pct(r.chg)}</span></div>
        ${svg}
        <div class="legend"><span><i style="background:var(--ink)"></i>종가</span>${p.ma.map((m, k) => `<span><i style="background:${MC[k]}"></i>${m}일선</span>`).join("")}<span><i style="background:var(--accent);opacity:.3"></i>볼린저밴드</span>${hi52 ? `<span>┄ 52주 고점 ${fmtPx(hi52, ccy)}</span>` : ""}</div>
        ${fb ? `<div class="fib-lv"><b>피보나치</b> <span class="muted">${p.fibN}일 상승파동 ${fmtPx(fb.lo, ccy)} → ${fmtPx(fb.hi, ccy)}${fibIn ? "" : " (차트 범위 밖)"}</span><br>${FIB_LV.slice(1, -1).map((r) => `<span class="${r === p.fibLv ? "on" : ""}">${r}% ${fmtPx(fb.at(r), ccy)}</span>`).join("")}</div>` : `<div class="fib-lv muted">피보나치: 최근 ${p.fibN}일에 ${p.fibMin}% 이상 상승파동이 없어 레벨을 계산하지 않음</div>`}
        <div class="tags" style="margin-top:12px">${Object.keys(LABEL).map((k) => `<span class="tag ${r.f[k] ? "hl" : "off"}">${r.f[k] ? "✓" : "–"} ${LABEL[k]}</span>`).join("")}</div>
        <div class="m-axis" style="margin-top:8px"><span>최근 ${n}거래일 · 역사적 고가 ${isN(it[4]) ? fmtPx(it[4], ccy) : "–"}</span></div>
        <a class="m-link" href="${link}" target="_blank" rel="noopener">${SC.mkt === "kr" ? "네이버 증권에서 보기" : "Yahoo Finance에서 보기"} ↗</a>`;
      $("#modal").classList.add("show");
      $("#mClose").onclick = () => $("#modal").classList.remove("show");
    }

    function initScan() {
      seg($("#scMkt"), [{ k: "kr", l: "국내" }, { k: "us", l: "미국" }], SC.mkt, (k) => { SC.mkt = k; SC.sector = ""; SC.cap = 0; SC.limit = 50; renderScan(); });
      $("#scSector").onchange = (e) => { SC.sector = e.target.value; SC.limit = 50; renderConds(); renderResult(); };
      $("#scCap").onchange = (e) => { SC.cap = +e.target.value; SC.limit = 50; renderConds(); renderResult(); };
      $("#scSort").onchange = (e) => { SC.sort = e.target.value; renderResult(); };
      $("#scConds").onchange = (e) => { const k = e.target.dataset.k; if (!k) return; e.target.checked ? SC.conds.add(k) : SC.conds.delete(k); SC.limit = 50; renderConds(); renderResult(); };
      $("#scMore").onclick = () => { SC.limit += 50; renderResult(); };
      $("#scSetBtn").onclick = () => $("#scSettings").classList.toggle("show");
      $("#scTable").onclick = (e) => { const tr = e.target.closest(".sr"); if (!tr) return; const x = computed.find((q) => q.it[0] === tr.dataset.t); if (x) chartModal(x.it); };
      renderScan();
    }

    get("valuechain").then((d) => { vcData = d; if (d) initVC(); else renderVC(); });
    get("scan").then((d) => {
      scData = d;
      if (!d) { $("#scTable").innerHTML = `<div class="err">가격 데이터를 불러오지 못했습니다.</div>`; return; }
      initScan();
    });
  }
  if (window.MV) start(); else document.addEventListener("mv:ready", start, { once: true });
})();
