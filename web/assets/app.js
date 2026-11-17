/*! Daily Market View · 기획·개발 김용진 (한화투자증권 WM지원팀) · 2026.11 */
/* 데일리 마켓뷰 — data/*.json 을 읽어 화면을 그린다 (라이브러리 없음) */
(function () {
  "use strict";
  const $ = (s, el) => (el || document).querySelector(s);
  const NC = "?t=" + Date.now();
  const D = {};

  /* ── 포맷 ─────────────────────────────────────────── */
  const isN = (v) => typeof v === "number" && isFinite(v);
  const cls = (v) => (!isN(v) || v === 0 ? "flat" : v > 0 ? "up" : "down");
  const sgn = (v) => (v > 0 ? "+" : "");
  const num = (v, d = 2) => (isN(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "–");
  const pct = (v, d = 2) => (isN(v) ? sgn(v) + v.toFixed(d) + "%" : "–");
  const bp = (v) => (isN(v) ? sgn(v) + v.toFixed(1) + "bp" : "–");
  const eok = (v) => (isN(v) ? sgn(v) + Math.round(v).toLocaleString("en-US") : "–");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const digitsFor = (v) => (!isN(v) ? 2 : Math.abs(v) >= 10000 ? 0 : 2);
  const span = (txt, v) => `<span class="${cls(v)}">${txt}</span>`;

  function spark(arr, w, h, cssW) {
    const a = (arr || []).filter(isN);
    if (a.length < 2) return "";
    const mn = Math.min(...a), mx = Math.max(...a), rg = mx - mn || 1;
    const pts = a.map((v, i) => [(i / (a.length - 1)) * w, h - 2 - ((v - mn) / rg) * (h - 4)]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const c = a[a.length - 1] >= a[0] ? "var(--up)" : "var(--down)";
    const area = d + `L${w} ${h}L0 ${h}Z`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" ${cssW ? `style="width:${cssW}"` : ""}>
      <path d="${area}" fill="${c}" opacity=".08"/>
      <path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function seg(el, opts, cur, onChange) {
    el.innerHTML = opts.map((o) => `<button type="button" data-k="${o.k}" class="${o.k === cur ? "on" : ""}">${o.l}</button>`).join("");
    el.onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      onChange(b.dataset.k);
    };
  }

  const tip = $("#tip");
  function showTip(e, html) {
    tip.innerHTML = html;
    tip.classList.add("show");
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => tip.classList.remove("show");

  function staleBadge(name) {
    const s = D.meta && D.meta.sections && D.meta.sections[name];
    return s && s.ok === false ? `<span class="stale" title="${esc(s.error || "")}">갱신 실패 · 이전 데이터</span>` : "";
  }

  /* ── 테마 ─────────────────────────────────────────── */
  function initTheme() {
    const btn = $("#themeBtn");
    const lbl = () => ($(".theme-lbl", btn).textContent = document.documentElement.dataset.theme === "dark" ? "라이트 모드" : "다크 모드");
    lbl();
    btn.onclick = () => {
      const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("mv-theme", t); } catch (e) {}
      lbl();
    };
  }

  /* ── 티커 테이프 ───────────────────────────────────── */
  function renderTape() {
    const g = D.global, r = D.rates;
    const all = {};
    if (g) {
      Object.values(g.indices).flat().forEach((x) => (all[x.ticker] = x));
      g.commodities.forEach((x) => (all[x.ticker] = x));
    }
    if (r) { r.fx.forEach((x) => (all[x.code] = x)); r.bonds.forEach((x) => (all[x.code] = x)); }
    const keys = [["^KS11", "코스피"], ["^KQ11", "코스닥"], ["^GSPC", "S&P 500"], ["^IXIC", "나스닥"], ["^SOX", "필라델피아 반도체"],
      ["FX_USDKRW", "원/달러"], ["KR3YT=RR", "국고 3년"], ["US10YT=RR", "美 10년"], ["CL=F", "WTI"], ["GC=F", "금"],
      ["BTC-USD", "비트코인"], ["^VIX", "VIX"]];
    $("#tape").innerHTML = keys.filter(([k]) => all[k]).map(([k, n]) => {
      const x = all[k], isBond = "bp1d" in x;
      const ch = isBond ? bp(x.bp1d) : pct(x.pct);
      const v = isBond ? x.last.toFixed(3) + "%" : num(x.last, digitsFor(x.last));
      return `<div class="tq"><span class="nm">${n}</span><span><span class="v">${v}</span>${span(`<span class="c">${ch}</span>`, isBond ? x.bp1d : x.pct)}</span></div>`;
    }).join("");
  }

  /* ── 지수 ─────────────────────────────────────────── */
  function renderIndices() {
    const g = D.global;
    if (!g) return ($("#indices").innerHTML = `<div class="err">지수 데이터를 불러오지 못했습니다.</div>`);
    $("#asof-index").innerHTML = `갱신 ${g.updated} · 각 시장 최근 종가` + staleBadge("global");
    const groups = [["kr", "국내"], ["us", "미국"], ["world", "아시아 · 유럽"]];
    $("#indices").innerHTML = groups.map(([k, t]) => `
      <div class="grp-t">${t}</div>
      <div class="idx-grid">${(g.indices[k] || []).map((x) => {
        const d = digitsFor(x.last);
        return `<div class="idx">
          <div class="idx-top"><span class="nm">${esc(x.name)}</span>${span(`<span class="pct">${pct(x.pct)}</span>`, x.pct)}</div>
          <div><span class="v">${num(x.last, d)}</span>${span(`<span class="chg">${sgn(x.chg)}${num(x.chg, d)}</span>`, x.chg)}</div>
          ${spark(x.spark, 200, 38)}
          <div class="idx-foot"><span>1주${span(`<b>${pct(x.r1w, 1)}</b>`, x.r1w)}</span><span>1개월${span(`<b>${pct(x.r1m, 1)}</b>`, x.r1m)}</span><span>YTD${span(`<b>${pct(x.ytd, 1)}</b>`, x.ytd)}</span></div>
        </div>`;
      }).join("")}</div>`).join("");
  }

  /* ── 환율 · 금리 · 원자재 ──────────────────────────── */
  function renderMacro() {
    const g = D.global, r = D.rates;
    const upd = (r && r.updated) || (g && g.updated) || "";
    $("#asof-macro").innerHTML = `갱신 ${upd}` + staleBadge("rates");
    const head = (a) => `<thead><tr><th>${a}</th><th>현재</th><th>1D</th><th>1W</th><th>1M</th><th></th></tr></thead>`;
    const rowP = (x, unit) => `<tr><td class="nm">${esc(x.name)}${unit ? ` <span class="muted sm-txt">${esc(unit)}</span>` : ""}</td>
      <td class="v">${num(x.last, digitsFor(x.last))}</td><td>${span(pct(x.pct), x.pct)}</td>
      <td>${span(pct(x.r1w, 1), x.r1w)}</td><td>${span(pct(x.r1m, 1), x.r1m)}</td><td class="sp">${spark(x.spark, 70, 22)}</td></tr>`;
    const rowB = (x) => `<tr><td class="nm">${esc(x.name)}</td><td class="v">${x.last.toFixed(3)}</td>
      <td>${span(bp(x.bp1d), x.bp1d)}</td><td>${span(bp(x.bp1w), x.bp1w)}</td><td>${span(bp(x.bp1m), x.bp1m)}</td><td class="sp">${spark(x.spark, 70, 22)}</td></tr>`;
    const cm = g ? Object.fromEntries(g.commodities.map((x) => [x.ticker, x])) : {};
    const fxRows = (r ? r.fx.map((x) => rowP(x)) : []).concat(["DX-Y.NYB", "JPY=X", "EURUSD=X"].filter((k) => cm[k]).map((k) => rowP(cm[k])));
    const bondRows = r ? r.bonds.map(rowB) : [];
    const cmRows = ["CL=F", "BZ=F", "GC=F", "SI=F", "HG=F", "NG=F", "BTC-USD"].filter((k) => cm[k]).map((k) => rowP(cm[k], cm[k].unit));
    const spreads = r && r.spreads.length ? `<div class="spreads">${r.spreads.map((s) => `<span>${esc(s.name)}<b>${s.bp > 0 ? "+" : ""}${s.bp.toFixed(1)}bp</b></span>`).join("")}</div>` : "";
    $("#macro").innerHTML = `
      <div class="card"><div class="card-h"><h3>환율</h3><span class="muted sm-txt">원화 환율: 하나은행 고시</span></div><table class="t">${head("통화")}<tbody>${fxRows.join("")}</tbody></table></div>
      <div class="card"><div class="card-h"><h3>금리</h3><span class="muted sm-txt">변동폭 bp</span></div><table class="t">${head("만기")}<tbody>${bondRows.join("")}</tbody></table>${spreads}</div>
      <div class="card"><div class="card-h"><h3>원자재 · 기타</h3><span class="muted sm-txt">근월물</span></div><table class="t">${head("품목")}<tbody>${cmRows.join("")}</tbody></table></div>`;
  }

  /* ── 섹터 강세 ─────────────────────────────────────── */
  const SEC = { uni: "KOSPI", per: "1D" };
  const UNIS = [{ k: "KOSPI", l: "코스피 업종" }, { k: "KOSDAQ", l: "코스닥 업종" }, { k: "US", l: "미국 섹터" }, { k: "THEME", l: "글로벌 테마 ETF" }];
  const PER_KR = [{ k: "1D", l: "1일" }, { k: "1W", l: "1주" }, { k: "1M", l: "1개월" }];
  const PER_GL = PER_KR.concat([{ k: "3M", l: "3개월" }, { k: "YTD", l: "YTD" }]);
  const KEY_KR = { "1D": "r1d", "1W": "r1w", "1M": "r1m" };
  const KEY_GL = { "1D": "pct", "1W": "r1w", "1M": "r1m", "3M": "r3m", YTD: "ytd" };

  function renderSector() {
    const isKr = SEC.uni === "KOSPI" || SEC.uni === "KOSDAQ";
    const pers = isKr ? PER_KR : PER_GL;
    if (!pers.some((p) => p.k === SEC.per)) SEC.per = "1D";
    seg($("#secPer"), pers, SEC.per, (k) => { SEC.per = k; renderSector(); });
    let rows, key;
    if (isKr) {
      if (!D.korea) return ($("#sectorBars").innerHTML = `<div class="err">국내 업종 데이터를 불러오지 못했습니다.</div>`);
      rows = D.korea.sectors[SEC.uni] || []; key = KEY_KR[SEC.per];
      $("#asof-sector").innerHTML = `KRX ${D.korea.date} 종가 기준 · 시가총액 가중` + staleBadge("korea");
      $("#sectorHint").textContent = "KRX 업종 분류 기준, 업종 내 시가총액 가중 수익률입니다. 업종을 누르면 대표 종목과 수급을 볼 수 있습니다.";
    } else {
      if (!D.global) return ($("#sectorBars").innerHTML = `<div class="err">해외 섹터 데이터를 불러오지 못했습니다.</div>`);
      rows = SEC.uni === "US" ? D.global.us_sectors : D.global.themes; key = KEY_GL[SEC.per];
      const dt = rows[0] && rows[0].date;
      $("#asof-sector").innerHTML = `미국 ${dt || ""} 종가 기준 · 대표 ETF 수익률` + staleBadge("global");
      $("#sectorHint").textContent = SEC.uni === "US" ? "S&P 500 섹터 SPDR ETF(XLK 등) 기준입니다." : "미국 상장 대표 테마 ETF 기준입니다. 이름 옆이 ETF 티커입니다.";
    }
    rows = rows.filter((r) => isN(r[key])).sort((a, b) => b[key] - a[key]);
    const mx = Math.max(...rows.map((r) => Math.abs(r[key])), 0.01);
    $("#sectorBars").innerHTML = rows.map((r, i) => {
      const v = r[key], w = (Math.abs(v) / mx) * 50;
      const left = v >= 0 ? 50 : 50 - w;
      const lb = isKr ? `${esc(r.sector)}<small>${r.count}</small>` : `${esc(r.name)}<small>${esc(r.ticker)}</small>`;
      return `<div class="brow"><span class="rk">${i + 1}</span><span class="lb">${lb}</span>
        <span class="track"><span class="fill ${cls(v)}" style="left:${left}%;width:${Math.max(w, 0.4)}%"></span></span>
        <span class="val ${cls(v)}">${pct(v)}</span><span class="car">▶</span></div>
        <div class="bdet">${isKr ? detKr(r) : detGl(r)}</div>`;
    }).join("") || `<div class="err">표시할 데이터가 없습니다.</div>`;
    $("#sectorBars").onclick = (e) => {
      const row = e.target.closest(".brow");
      if (row) row.classList.toggle("open");
    };
  }
  function detKr(r) {
    return `<div class="kv"><span>1일${span(`<b>${pct(r.r1d)}</b>`, r.r1d)}</span><span>1주${span(`<b>${pct(r.r1w)}</b>`, r.r1w)}</span>
      <span>1개월${span(`<b>${pct(r.r1m)}</b>`, r.r1m)}</span><span>시총<b>${num(r.mcap_t, 1)}조</b></span>
      <span>상승/하락<b>${r.up} / ${r.down}</b></span><span>외국인${span(`<b>${eok(r.f_net)}억</b>`, r.f_net)}</span>
      <span>기관${span(`<b>${eok(r.i_net)}억</b>`, r.i_net)}</span></div>
      <div class="ldr">${r.leaders.map((l) => `<div><span>${esc(l.name)}</span>${span(pct(l.r1d), l.r1d)}</div>`).join("")}</div>`;
  }
  function detGl(r) {
    return `<div class="kv"><span>종가<b>$${num(r.last)}</b></span><span>1일${span(`<b>${pct(r.pct)}</b>`, r.pct)}</span>
      <span>1주${span(`<b>${pct(r.r1w)}</b>`, r.r1w)}</span><span>1개월${span(`<b>${pct(r.r1m)}</b>`, r.r1m)}</span>
      <span>3개월${span(`<b>${pct(r.r3m)}</b>`, r.r3m)}</span><span>YTD${span(`<b>${pct(r.ytd)}</b>`, r.ytd)}</span>
      <span>52주 고점 대비${span(`<b>${pct(r.from_hi)}</b>`, r.from_hi)}</span></div>`;
  }

  /* ── 섹터별 종목 카드 ──────────────────────────────── */
  const ST = { uni: "kr", per: "1D" };
  const ST_KEY = { "1D": "pct", "1W": "r1w", "1M": "r1m", "3M": "r3m", YTD: "ytd" };
  const stData = () => (ST.uni === "kr" ? D.stocks_kr : D.stocks_global);
  const PX_PRE = { USD: "$", JPY: "¥", TWD: "NT$", CNY: "CN¥" };
  const fmtPx = (v, ccy) => (!isN(v) ? "–" : ccy === "KRW" ? Math.round(v).toLocaleString("en-US") : (PX_PRE[ccy] || "$") + num(v, v >= 1000 ? 0 : 2));

  function renderStocks() {
    const d = stData();
    const board = $("#stBoard");
    if (d === undefined) return (board.innerHTML = `<div class="err">종목 데이터 불러오는 중…</div>`);
    if (!d) { $("#stJump").innerHTML = ""; return (board.innerHTML = `<div class="err">종목 데이터를 불러오지 못했습니다.</div>`); }
    const isKr = ST.uni === "kr";
    $("#asof-stocks").innerHTML = (isKr ? `KRX ${d.date} 종가 기준 · WICS 중분류 · 업종별 시총 상위 최대 20종목`
      : `미국 ${d.date} 종가 기준 · 미국 상장 대형주(ADR 포함) · 테마별 시총 상위 최대 20종목`) + staleBadge(isKr ? "stocks_kr" : "stocks_global");
    const key = ST_KEY[ST.per];
    const secs = d.sectors.slice().sort((a, b) => (isN(b.med[ST.per]) ? b.med[ST.per] : -1e9) - (isN(a.med[ST.per]) ? a.med[ST.per] : -1e9));
    $("#stJump").innerHTML = secs.map((s, i) => `<button type="button" class="chip" data-j="${i}">${esc(s.name)}<span class="pc ${cls(s.med[ST.per])}">${pct(s.med[ST.per], 1)}</span></button>`).join("");
    $("#stJump").onclick = (e) => {
      const b = e.target.closest(".chip");
      if (b) document.getElementById("sb-" + b.dataset.j).scrollIntoView({ behavior: "smooth" });
    };
    board.innerHTML = secs.map((s, i) => {
      const rows = s.stocks.slice().sort((a, b) => (isN(b[key]) ? b[key] : -1e9) - (isN(a[key]) ? a[key] : -1e9));
      const ups = rows.filter((r) => r[key] > 0).length, downs = rows.filter((r) => r[key] < 0).length;
      return `<div class="sblk" id="sb-${i}">
        <div class="sblk-h"><h3>${esc(s.name)}</h3><span class="med ${cls(s.med[ST.per])}">중앙값 ${pct(s.med[ST.per])}</span>
          <span class="meta">강세 ${i + 1}위 · ${rows.length}종목 · 상승 ${ups} / 하락 ${downs}</span></div>
        <div class="sgrid">${rows.map((r, j) => card(r, key, d.ccy, j === 0 && r[key] > 0, i, s.stocks.indexOf(r))).join("")}</div>
      </div>`;
    }).join("");
    board.onclick = (e) => {
      const c = e.target.closest(".sc");
      if (c) openModal(secs[+c.dataset.s], secs[+c.dataset.s].stocks[+c.dataset.k], d.ccy);
    };
  }
  function card(r, key, ccy, best, si, k) {
    const isKr = ccy === "KRW";
    const sub = isKr ? `${r.ticker} · 시총 ${r.rank}위` : `${r.ticker}${r.rank ? ` · 시총 ${r.rank}위` : ""}`;
    const pe = isKr
      ? `PER <b>${isN(r.per) ? r.per.toFixed(1) : "–"}</b><i>·</i>PBR <b>${isN(r.pbr) ? r.pbr.toFixed(2) : "–"}</b>`
      : `올해 <b>${isN(r.pe0) ? r.pe0.toFixed(1) : "–"}</b><i>·</i>내년 <b class="hl">${isN(r.pe1) ? r.pe1.toFixed(1) : "–"}</b>`;
    return `<div class="sc ${best ? "best" : ""}" data-s="${si}" data-k="${k}">
      <div class="sc-top"><span class="sc-nm">${esc(r.name)}</span><span class="p ${cls(r[key])}">${pct(r[key])}</span></div>
      <div class="sc-sub">${esc(sub)}</div>
      ${spark((r.spark || []).slice(-60), 160, 40)}
      <div class="sc-px">${fmtPx(r.last, ccy)}</div>
      <div class="sc-pe">${pe}</div></div>`;
  }

  function openModal(sec, r, ccy) {
    const isKr = ccy === "KRW";
    const sp = r.spark || [];
    const link = isKr ? `https://m.stock.naver.com/domestic/stock/${r.ticker}/total` : `https://finance.yahoo.com/quote/${encodeURIComponent(r.ticker)}`;
    const cells = [["1일", r.pct], ["1주", r.r1w], ["1개월", r.r1m], ["3개월", r.r3m], ["YTD", r.ytd], ["52주 고점 대비", r.from_hi]];
    const extra = isKr
      ? [["시가총액", `${num(r.mcap, 1)}조`], ["PER", isN(r.per) ? r.per.toFixed(1) : "–"], ["PBR", isN(r.pbr) ? r.pbr.toFixed(2) : "–"]]
      : [["시가총액", r.mcap ? `$${num(r.mcap / 1000, 2)}T` : "–"], ["올해 예상 PER", isN(r.pe0) ? r.pe0.toFixed(1) : "–"], ["내년 예상 PER", isN(r.pe1) ? r.pe1.toFixed(1) : "–"]];
    const mn = sp.length ? Math.min(...sp) : null, mx = sp.length ? Math.max(...sp) : null;
    $("#modalBox").innerHTML = `
      <div class="m-h"><div><h3>${esc(r.name)}</h3><div class="s">${esc(r.ticker)} · ${esc(sec.name)}${r.rank ? ` · 시총 ${r.rank}위` : ""}</div></div>
        <button type="button" class="m-x" id="mClose" aria-label="닫기">✕</button></div>
      <div class="m-px">${fmtPx(r.last, ccy)}<span class="${cls(r.pct)}">${pct(r.pct)}</span></div>
      <div class="m-chart">${spark(sp, 600, 190)}</div>
      <div class="m-axis"><span>최근 ${sp.length}거래일</span><span>최저 ${fmtPx(mn, ccy)} · 최고 ${fmtPx(mx, ccy)}</span></div>
      <div class="m-grid">${cells.map(([k, v]) => `<div><span class="k">${k}</span><span class="v ${cls(v)}">${pct(v)}</span></div>`).join("")}
        ${extra.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}</div>
      <a class="m-link" href="${link}" target="_blank" rel="noopener">${isKr ? "네이버 증권에서 보기" : "Yahoo Finance에서 보기"} ↗</a>`;
    $("#modal").classList.add("show");
    $("#mClose").onclick = closeModal;
  }
  function closeModal() { $("#modal").classList.remove("show"); }
  $("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  function initStockControls() {
    seg($("#stUni"), [{ k: "kr", l: "국내 (WICS)" }, { k: "global", l: "글로벌" }], ST.uni, (k) => { ST.uni = k; renderStocks(); });
    seg($("#stPer"), PER_GL, ST.per, (k) => { ST.per = k; renderStocks(); });
  }

  /* ── 수급 ─────────────────────────────────────────── */
  const FL = { mkt: "KOSPI", inv: "foreign", dir: "buy", win: "1d" };
  const INV_C = { 개인: "var(--c-ind)", 외국인: "var(--c-for)", 기관: "var(--c-ins)" };

  function renderFlow() {
    const k = D.korea;
    if (!k) {
      $("#flowToday").innerHTML = `<div class="err">수급 데이터를 불러오지 못했습니다.</div>`;
      return;
    }
    $("#asof-flow").innerHTML = `KRX ${k.date} 장마감 기준 · 단위 억원` + staleBadge("korea");
    const rows = k.flow[FL.mkt] || [];
    const last = rows[rows.length - 1] || {};
    const b = k.breadth[FL.mkt] || { up: 0, down: 0, flat: 0 };
    const tot = b.up + b.down + b.flat || 1;
    $("#flowToday").innerHTML = `<div class="ft">${["개인", "외국인", "기관"].map((n) =>
      `<div><span class="k"><i style="background:${INV_C[n]}"></i>${n}</span><span class="v ${cls(last[n])}">${eok(last[n])}<small>억</small></span></div>`).join("")}</div>
      <div class="breadth"><span style="width:${(b.up / tot) * 100}%;background:var(--up)"></span><span style="width:${(b.flat / tot) * 100}%;background:var(--line-2)"></span><span style="width:${(b.down / tot) * 100}%;background:var(--down)"></span></div>
      <div class="breadth-lbl"><span class="up">상승 ${b.up}</span><span>보합 ${b.flat}</span><span class="down">하락 ${b.down}</span></div>`;
    drawFlowChart(rows);
    // 업종별 외국인+기관
    const secs = (k.sectors[FL.mkt] || []).map((s) => ({ n: s.sector, v: (s.f_net || 0) + (s.i_net || 0), f: s.f_net, i: s.i_net }));
    const inn = secs.filter((s) => s.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
    const out = secs.filter((s) => s.v < 0).sort((a, b) => a.v - b.v).slice(0, 5);
    const li = (s) => `<div class="r" title="외국인 ${eok(s.f)}억 / 기관 ${eok(s.i)}억"><span>${esc(s.n)}</span>${span(eok(s.v), s.v)}</div>`;
    $("#flowSecMkt").textContent = `${FL.mkt} · ${k.date.slice(5).replace("-", "/")}`;
    $("#flowSector").innerHTML = `<div class="fsec"><div><h4>유입 상위</h4>${inn.map(li).join("") || '<p class="muted">없음</p>'}</div>
      <div><h4>유출 상위</h4>${out.map(li).join("") || '<p class="muted">없음</p>'}</div></div>`;
    renderTop();
  }

  function drawFlowChart(rows) {
    const el = $("#flowChart");
    const W = Math.max(el.clientWidth || 500, 280), H = 170, padL = 44, padB = 20, padT = 8;
    const ser = ["개인", "외국인", "기관"];
    const mx = Math.max(1, ...rows.flatMap((r) => ser.map((s) => Math.abs(r[s] || 0))));
    const y0 = padT + (H - padT - padB) / 2, sc = (H - padT - padB) / 2 / mx;
    const n = rows.length || 1, gw = (W - padL) / n, bw = Math.max(2, Math.min(8, (gw - 4) / 3));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
    const tick = niceTick(mx);
    for (const t of [-tick, 0, tick]) {
      const y = y0 - t * sc;
      if (y < padT - 1 || y > H - padB + 1) continue;
      s += `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line${t ? "" : "-2"})" ${t ? 'stroke-dasharray="2 3"' : ""}/>`;
      s += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)">${t ? eok(t) : "0"}</text>`;
    }
    rows.forEach((r, i) => {
      const gx = padL + i * gw + (gw - bw * 3) / 2;
      ser.forEach((k, j) => {
        const v = r[k] || 0, h = Math.abs(v) * sc;
        s += `<rect x="${(gx + j * bw).toFixed(1)}" y="${(v >= 0 ? y0 - h : y0).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${Math.max(h, 0.5).toFixed(1)}" fill="${INV_C[k]}" rx="1"/>`;
      });
      s += `<rect class="hit" data-i="${i}" x="${padL + i * gw}" y="0" width="${gw}" height="${H}" fill="transparent"/>`;
      if (i % 5 === (n - 1) % 5) s += `<text x="${padL + i * gw + gw / 2}" y="${H - 5}" text-anchor="middle" font-size="10.5" fill="var(--muted)">${r.date.slice(5).replace("-", "/")}</text>`;
    });
    s += "</svg>";
    el.innerHTML = `<div class="fchart">${s}</div><div class="legend">${ser.map((k) => `<span><i style="background:${INV_C[k]}"></i>${k}</span>`).join("")}<span>최근 ${n}거래일</span></div>`;
    el.querySelector("svg").onmousemove = (e) => {
      const h = e.target.closest(".hit");
      if (!h) return hideTip();
      const r = rows[+h.dataset.i];
      showTip(e, `<b>${r.date}</b><br>${ser.map((k) => `${k} <span class="${cls(r[k])}">${eok(r[k])}억</span>`).join("<br>")}`);
    };
    el.querySelector("svg").onmouseleave = hideTip;
  }
  function niceTick(mx) {
    const p = Math.pow(10, Math.floor(Math.log10(mx)));
    const m = mx / p;
    return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
  }

  function renderTop() {
    const k = D.korea;
    const list = (k.tops[`${FL.inv}_${FL.dir}_${FL.win}`] || []).slice(0, 15);
    const days = k.days5 || [];
    const stk = (n) => `<span class="streak" title="최근 5거래일 중 ${n}일 연속">${[0, 1, 2, 3, 4].map((i) => `<i class="${i >= 5 - n ? (FL.dir === "buy" ? "b" : "s") : ""}"></i>`).join("")}</span>`;
    const lbl = FL.win === "1d" ? `${(days[days.length - 1] || "")} 순매${FL.dir === "buy" ? "수" : "도"}` : `${days[0] || ""}~${days[days.length - 1] || ""} 누적`;
    $("#topTable").innerHTML = `<table class="t"><thead><tr><th>#</th><th style="text-align:left">종목</th><th>${lbl}(억)</th><th>종가</th><th>등락률</th><th>연속</th></tr></thead><tbody>
      ${list.map((r, i) => `<tr><td class="muted">${i + 1}</td><td class="nm">${esc(r.name)}<span class="tk">${esc(r.sector || "")}</span></td>
        <td class="v">${span(eok(r.net), r.net)}</td><td>${num(r.close, 0)}</td><td>${span(pct(r.r1d), r.r1d)}</td><td>${stk(r.streak)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  function initFlowControls() {
    seg($("#flowMkt"), [{ k: "KOSPI", l: "코스피" }, { k: "KOSDAQ", l: "코스닥" }], FL.mkt, (v) => { FL.mkt = v; renderFlow(); });
    seg($("#topInv"), [{ k: "foreign", l: "외국인" }, { k: "inst", l: "기관" }], FL.inv, (v) => { FL.inv = v; D.korea && renderTop(); });
    seg($("#topDir"), [{ k: "buy", l: "순매수" }, { k: "sell", l: "순매도" }], FL.dir, (v) => { FL.dir = v; D.korea && renderTop(); });
    seg($("#topWin"), [{ k: "1d", l: "당일" }, { k: "5d", l: "5일 누적" }], FL.win, (v) => { FL.win = v; D.korea && renderTop(); });
  }

  /* ── 뉴스플로우 ────────────────────────────────────── */
  const NW = { region: "all", tag: "", q: "", limit: 60 };
  const WD = ["일", "월", "화", "수", "목", "금", "토"];

  function newsFiltered(ignoreTag) {
    const q = NW.q.trim().toLowerCase();
    return (D.news ? D.news.items : []).filter((x) =>
      (NW.region === "all" || x.region === NW.region) &&
      (ignoreTag || !NW.tag || x.tags.includes(NW.tag)) &&
      (!q || x.title.toLowerCase().includes(q) || x.src.toLowerCase().includes(q)));
  }
  function renderNews() {
    if (!D.news) return ($("#newsList").innerHTML = `<li class="empty">뉴스를 불러오지 못했습니다.</li>`);
    $("#asof-news").innerHTML = `${D.news.updated} 갱신 · 최근 48시간` + staleBadge("news");
    const base = newsFiltered(true);
    const cnt = {};
    base.forEach((x) => x.tags.forEach((t) => (cnt[t] = (cnt[t] || 0) + 1)));
    $("#newsTags").innerHTML = `<button type="button" class="chip ${NW.tag ? "" : "on"}" data-t="">전체<em>${base.length}</em></button>` +
      D.news.tags.filter((t) => cnt[t]).map((t) => `<button type="button" class="chip ${NW.tag === t ? "on" : ""}" data-t="${esc(t)}">${esc(t)}<em>${cnt[t]}</em></button>`).join("");
    const items = newsFiltered(false);
    let html = "", day = "";
    items.slice(0, NW.limit).forEach((x) => {
      const d = x.t.slice(0, 10);
      if (d !== day) {
        day = d;
        const dt = new Date(d + "T00:00:00");
        html += `<li class="day">${dt.getMonth() + 1}월 ${dt.getDate()}일 (${WD[dt.getDay()]})</li>`;
      }
      html += `<li class="it"><span class="tm">${x.t.slice(11)}</span><span class="src ${x.region === "global" ? "g" : ""}">${esc(x.src)}</span>
        <span class="ttl"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>${x.tags.map((t) => `<span class="tg">${esc(t)}</span>`).join("")}</span></li>`;
    });
    $("#newsList").innerHTML = html || `<li class="empty">조건에 맞는 뉴스가 없습니다.</li>`;
    $("#newsMore").style.display = items.length > NW.limit ? "block" : "none";
  }
  function initNewsControls() {
    seg($("#newsRegion"), [{ k: "all", l: "전체" }, { k: "kr", l: "국내" }, { k: "global", l: "해외" }], NW.region, (v) => { NW.region = v; NW.limit = 60; renderNews(); });
    $("#newsTags").onclick = (e) => {
      const b = e.target.closest(".chip");
      if (!b) return;
      NW.tag = b.dataset.t; NW.limit = 60; renderNews();
    };
    let tm;
    $("#newsQ").oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { NW.q = e.target.value; NW.limit = 60; renderNews(); }, 150); };
    $("#newsMore").onclick = () => { NW.limit += 60; renderNews(); };
  }

  /* ── 주요 일정 ─────────────────────────────────────── */
  const CAL = { week: 0 };
  const md = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()} (${WD[d.getDay()]})`; };
  function renderCal() {
    const c = D.calendar;
    if (!c) { $("#calEvents").innerHTML = $("#calEarn").innerHTML = `<p class="empty-s">일정을 불러오지 못했습니다.</p>`; return; }
    $("#asof-cal").innerHTML = `갱신 ${c.updated} · 출처 Nasdaq 캘린더` + staleBadge("calendar");
    const days = c.days.slice(CAL.week * 5, CAL.week * 5 + 5);
    const dayHead = (d) => `<div class="cal-day ${d < c.today ? "past" : ""}">${md(d)}${d === c.today ? '<span class="today">오늘</span>' : ""}</div>`;
    $("#calEvents").innerHTML = days.map((d) => {
      const ev = c.events.filter((e) => e.date === d);
      return dayHead(d) + (ev.length ? ev.map((e) => {
        const v = [e.actual ? `실제 <b>${esc(e.actual)}</b>` : "", e.consensus ? `예상 ${esc(e.consensus)}` : "", e.previous ? `이전 ${esc(e.previous)}` : ""].filter(Boolean).join(" · ");
        return `<div class="ev ${e.w >= 2 ? "hi" : ""}"><span class="tm">${esc(e.kst || "")}</span><span class="ct">${esc(e.country)}</span>
          <span class="nm">${esc(e.name)}${e.en ? `<small>${esc(e.en)}</small>` : ""}</span><span class="vals">${v}</span></div>`;
      }).join("") : `<p class="empty-s">주요 일정 없음</p>`);
    }).join("");
    $("#calEarn").innerHTML = days.map((d) => {
      const er = c.earnings.filter((e) => e.date === d);
      const nd = new Date(d + "T00:00:00"); nd.setDate(nd.getDate() + 1);
      return dayHead(d) + (er.length ? er.map((e) => {
        const kst = e.when === "장전" ? "한국 당일 밤" : e.when === "장후" ? `한국 ${nd.getMonth() + 1}/${nd.getDate()} 새벽` : "";
        return `<div class="er"><span class="nm">${e.when ? `<span class="when">${e.when}</span>` : ""}${esc(e.name)}<small>${esc(e.ticker)}</small></span>
          <span class="rt">${e.eps_f ? `EPS 예상 ${esc(e.eps_f)}` : ""}${kst ? ` · ${kst}` : ""}</span></div>`;
      }).join("") : `<p class="empty-s">주요 실적 없음</p>`);
    }).join("");
  }

  /* ── 공매도 ───────────────────────────────────────── */
  const SH = { mkt: "KOSPI", view: "trade" };
  function renderShort() {
    const s = D.short;
    if (!s) return ($("#shortTable").innerHTML = `<p class="empty-s">공매도 데이터를 불러오지 못했습니다.</p>`);
    const m = s.markets[SH.mkt];
    if (!m) return ($("#shortTable").innerHTML = `<p class="empty-s">데이터 없음</p>`);
    $("#shortInfo").innerHTML = `· ${SH.mkt} 당일 공매도 거래대금 비중 <b>${isN(m.total_ratio) ? m.total_ratio.toFixed(2) + "%" : "–"}</b>` + staleBadge("short");
    const amt = (v) => (isN(v) ? Math.round(v).toLocaleString("en-US") : "–");
    let rows, head, hint;
    if (SH.view === "trade") {
      hint = `${s.date} 기준 · 전체 거래대금 중 공매도 비중 · 시총 3,000억 이상`;
      head = `<th>#</th><th style="text-align:left">종목</th><th>공매도 비중</th><th>공매도 금액(억)</th><th>등락률</th>`;
      rows = m.trade.map((r, i) => `<tr><td class="muted">${i + 1}</td><td class="nm">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
        <td class="v">${r.ratio.toFixed(2)}%</td><td>${amt(r.value)}</td><td>${span(pct(r.r1d), r.r1d)}</td></tr>`);
    } else {
      const b = m.balance;
      hint = `잔고는 2거래일 뒤 공시되어 ${b.date || "–"} 기준입니다 · 변화는 5거래일 전 대비(%p) · 시총 3,000억 이상`;
      head = `<th>#</th><th style="text-align:left">종목</th><th>잔고 비중</th><th>1주 변화</th><th>잔고 금액(억)</th><th>등락률</th>`;
      rows = (b[SH.view] || []).map((r, i) => `<tr><td class="muted">${i + 1}</td><td class="nm">${esc(r.name)}<span class="tk">${r.ticker}</span></td>
        <td class="v">${r.ratio.toFixed(2)}%</td><td>${isN(r.chg) ? span(sgn(r.chg) + r.chg.toFixed(2) + "%p", r.chg) : "–"}</td>
        <td>${amt(r.value)}</td><td>${span(pct(r.r1d), r.r1d)}</td></tr>`);
    }
    $("#shortTable").innerHTML = rows.length ? `<table class="t"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>` : `<p class="empty-s">데이터 없음</p>`;
    $("#shortHint").textContent = hint;
  }
  function initCalShort() {
    seg($("#calWeek"), [{ k: "0", l: "이번 주" }, { k: "1", l: "다음 주" }], "0", (k) => { CAL.week = +k; renderCal(); });
    seg($("#shMkt"), [{ k: "KOSPI", l: "코스피" }, { k: "KOSDAQ", l: "코스닥" }], SH.mkt, (k) => { SH.mkt = k; renderShort(); });
    seg($("#shView"), [{ k: "trade", l: "거래 비중" }, { k: "top", l: "잔고 비중" }, { k: "up", l: "잔고 증가" }, { k: "down", l: "잔고 감소" }], SH.view, (k) => { SH.view = k; renderShort(); });
  }

  /* ── 네비게이션 하이라이트 ─────────────────────────── */
  function initNav() {
    const links = [...document.querySelectorAll("#nav a")];
    // 화면 위쪽 기준선(헤더 아래)을 지난 마지막 섹션을 현재 위치로 본다. 맨 위에서는 첫 섹션.
    const secs = [...document.querySelectorAll("section.sec")];
    let raf = 0;
    const update = () => {
      raf = 0;
      let cur = secs[0];
      for (const s of secs) if (s.getBoundingClientRect().top <= 160) cur = s;
      links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + cur.id));
    };
    addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  }

  /* ── 부트 ─────────────────────────────────────────── */
  function renderAll() {
    renderTape(); renderIndices(); renderMacro(); renderSector(); renderStocks(); renderFlow(); renderNews(); renderCal(); renderShort();
    const m = D.meta;
    $("#updated").textContent = m ? `최종 갱신 ${m.updated} (KST) · 평일 자동 업데이트` : "갱신 정보 없음";
  }
  const get = (n) => fetch(`data/${n}.json${NC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  initTheme(); initNav(); initFlowControls(); initNewsControls(); initStockControls(); initCalShort();
  seg($("#secUni"), UNIS, SEC.uni, (k) => { SEC.uni = k; renderSector(); });
  Promise.all(["meta", "global", "rates", "korea", "news", "calendar", "short"].map(get)).then(([meta, g, r, k, n, cal, sh]) => {
    Object.assign(D, { meta, global: g, rates: r, korea: k, news: n, calendar: cal, short: sh });
    renderAll();
  });
  // 종목 카드 데이터는 용량이 커서 따로 받아 그린다
  Promise.all(["stocks_kr", "stocks_global"].map(get)).then(([kr, gl]) => {
    D.stocks_kr = kr; D.stocks_global = gl;
    renderStocks();
  });
  /* 만든 사람 */
  try {
    console.log("%cDaily Market View%c\n기획·개발 김용진 · 한화투자증권 WM지원팀 · 2026.11",
      "font:800 20px Pretendard,sans-serif;color:#f08a3c", "font:500 12px Pretendard,sans-serif;color:#868b96");
  } catch (e) {}
  (function () {
    const mark = document.querySelector(".brand-mark");
    if (!mark) return;
    let n = 0, t = 0;
    mark.addEventListener("click", () => {
      n = Date.now() - t < 600 ? n + 1 : 1; t = Date.now();
      if (n < 5) return;
      n = 0;
      const el = document.createElement("div");
      el.className = "maker";
      el.textContent = "만든 사람 · WM지원팀 김용진 대리 · 2026.11";
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("show"));
      setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 400); }, 2600);
    });
  })();
  window.MV = { D, $, esc, isN, cls, sgn, num, pct, spark, seg, showTip, hideTip, staleBadge, openModal, fmtPx, WD };
  document.dispatchEvent(new Event("mv:ready"));
  let rz;
  addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => D.korea && drawFlowChart(D.korea.flow[FL.mkt] || []), 150); });
})();
