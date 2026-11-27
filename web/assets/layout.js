/* 새 화면 구성 (테스트) — 기존 섹션을 탭 4개(홈·시장 데이터·섹터·종목·뉴스·공시)로 옮기고,
 * 홈 전용 블록(대표 지수·섹터 강약·한 줄 요약)과 글씨 크기 버튼을 더한다.
 * 기존 화면 코드(app.js 등)는 그대로 쓰며, 이 파일은 그보다 먼저 실행된다(요소 id 유지). */
(function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  document.body.classList.add("v2");

  /* ── 탭 구성 ───────────────────────────────────────── */
  const TABS = [
    { k: "home", l: "홈", i: "🏠" },
    { k: "mkt", l: "시장 데이터", s: "시장", i: "📈" },
    { k: "sec", l: "섹터·종목", i: "🧩" },
    { k: "news", l: "뉴스·공시", i: "📰" },
  ];
  const main = $("main.wrap");
  const sec = (id) => document.getElementById(id);
  const panes = {};
  TABS.forEach((t) => { panes[t.k] = el("div", "pane"); panes[t.k].dataset.p = t.k; main.appendChild(panes[t.k]); });

  // 홈: (오늘의 시장 체크) · 대표 지수 6개 · 섹터 강세/약세 · 일정
  const home = el("section", "sec", `
    <div class="sec-h"><h2>주요 지수</h2><span class="asof" id="hmAsof">각 시장 최근 종가</span><a class="hm-go" data-go="mkt">전체 지수·환율·금리 →</a></div>
    <div class="hm-idx" id="hmIdx"></div>
    <div class="sec-h hm-h"><h2>업종 강세 · 약세</h2><span class="asof" id="hmSecAsof"></span><a class="hm-go" data-go="sec" data-sub="sec-sector">섹터 전체 →</a></div>
    <div class="hm-sec" id="hmSec"></div>`);
  home.id = "sec-home";
  panes.home.appendChild(home);
  panes.home.appendChild(sec("sec-cal"));

  panes.mkt.append(sec("sec-index"), sec("sec-macro"), sec("sec-flow"));

  // 섹터·종목 / 뉴스·공시: 위쪽 버튼으로 한 섹션씩
  const SUBS = {
    sec: [["sec-sector", "섹터 강세"], ["sec-stocks", "섹터별 종목"], ["sec-vc", "밸류체인"], ["sec-theme", "신기술 테마"], ["sec-scan", "차트 포착기"]],
    news: [["sec-news", "뉴스플로우"], ["sec-ds", "주요 공시"]],
  };
  Object.entries(SUBS).forEach(([p, list]) => {
    const bar = el("div", "subtabs", list.map(([id, l]) => `<button type="button" data-sub="${id}">${l}</button>`).join(""));
    panes[p].appendChild(bar);
    list.forEach(([id]) => { const s = sec(id); s.classList.add("sub"); panes[p].appendChild(s); });
    bar.onclick = (e) => { const b = e.target.closest("button"); if (b) showSub(p, b.dataset.sub, true); };
  });

  // 추천 영상·자료: '오늘의 시장 체크'에서 떼어 뉴스·공시 탭 맨 아래로
  const guide = sec("sec-guide");
  const lk = el("section", "sec", `<div class="sec-h"><h2>추천 영상·자료</h2><span class="cad" title="자동 업데이트 주기">⟳ 게시 후 자동 반영</span></div>`);
  lk.id = "sec-links";
  ["#lkTags", "#lkGrid", "#lkMore"].forEach((q) => { const n = $(q); lk.appendChild(q === "#lkTags" ? n.parentNode : n); });
  const lkHint = [...guide.querySelectorAll(".hint")].pop();
  if (lkHint) lk.appendChild(lkHint);
  panes.news.appendChild(lk);
  // '오늘의 시장 체크' 판정 카드는 홈 맨 위에 (추천 영상 제목줄은 빼고)
  guide.querySelectorAll(".sec-h").forEach((h, i) => { if (i > 0) h.remove(); });
  panes.home.insertBefore(guide, home);

  /* ── 헤더: 탭 · 글씨 크기 / 휴대폰: 아래 탭 ───────────── */
  const tabHtml = (mob) => TABS.map((t) => `<a data-go="${t.k}">${mob ? `<i>${t.i}</i>${t.s || t.l}` : t.l}</a>`).join("");
  const nav = el("nav", "v2nav", tabHtml(false));
  $(".top").appendChild(nav);
  const mob = el("nav", "v2tab", tabHtml(true));
  document.body.appendChild(mob);

  const FS = [["1", "가", "글씨 보통"], ["1.15", "가", "글씨 크게"], ["1.3", "가", "글씨 아주 크게"]];
  const fs = el("div", "fs", FS.map(([z, t, l], i) => `<button type="button" class="fs${i}" data-z="${z}" title="${l}" aria-label="${l}">${t}</button>`).join(""));
  const themeBtn = $("#themeBtn");
  themeBtn.parentNode.insertBefore(fs, themeBtn);
  const setFs = (z) => {
    document.documentElement.style.setProperty("--fz", z);
    FS.forEach(([zz], i) => document.documentElement.classList.toggle("fz" + i, zz === z));
    fs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.z === z));
    ls("mv-fs", z);
    dispatchEvent(new Event("resize"));
  };
  setFs(FS.some(([z]) => z === ls("mv-fs")) ? ls("mv-fs") : "1");
  fs.onclick = (e) => { const b = e.target.closest("button"); if (b) setFs(b.dataset.z); };

  /* ── 탭 전환 ───────────────────────────────────────── */
  const subOf = {};
  function showSub(p, id, user) {
    subOf[p] = id;
    SUBS[p].forEach(([sid]) => sec(sid).classList.toggle("on", sid === id));
    panes[p].querySelectorAll(".subtabs button").forEach((b) => b.classList.toggle("on", b.dataset.sub === id));
    ss("mv-sub-" + p, id);
    if (user) { window.scrollTo(0, 0); dispatchEvent(new Event("resize")); }
  }
  function go(p, sub, keepScroll) {
    if (!panes[p]) p = "home";
    Object.values(panes).forEach((x) => x.classList.toggle("on", x.dataset.p === p));
    document.querySelectorAll("[data-go]").forEach((a) => a.classList.toggle("on", a.dataset.go === p && !a.classList.contains("hm-go")));
    if (SUBS[p]) showSub(p, sub || subOf[p] || ss("mv-sub-" + p) || SUBS[p][0][0]);
    ss("mv-tab", p);
    if (!keepScroll) window.scrollTo(0, 0);
    dispatchEvent(new Event("resize")); // 숨겨져 있던 차트 다시 그리기
  }
  const paneOf = (id) => { const s = sec(id); const p = s && s.closest(".pane"); return p ? p.dataset.p : null; };
  // 다른 섹션으로 가는 링크(#sec-…)는 해당 탭으로 이동
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) { e.preventDefault(); go(g.dataset.go, g.dataset.sub); return; }
    const a = e.target.closest('a[href^="#sec-"]');
    if (!a) return;
    const id = a.getAttribute("href").slice(1), p = paneOf(id);
    if (!p) return;
    e.preventDefault();
    go(p, SUBS[p] && SUBS[p].some(([s]) => s === id) ? id : undefined, true);
    sec(id).scrollIntoView();
  });
  const h = location.hash;
  if (h.startsWith("#theme=")) go("sec", "sec-theme");
  else if (h.startsWith("#sec-") && paneOf(h.slice(1))) { const id = h.slice(1), p = paneOf(id); go(p, SUBS[p] && SUBS[p].some(([s]) => s === id) ? id : undefined); }
  else go(ss("mv-tab") || "home");

  /* ── 섹터별 종목: 섹터당 5개만, '더 보기'로 펼침 ─────── */
  const SHOW = 5;
  const board = $("#stBoard");
  new MutationObserver(() => {
    board.querySelectorAll(".sblk").forEach((b) => {
      const n = b.querySelectorAll(".sgrid .sc").length;
      if (n <= SHOW || b.querySelector(".v2more")) return;
      const btn = el("button", "more v2more", `더 보기 (${n - SHOW}개)`);
      btn.type = "button";
      btn.onclick = () => { const on = b.classList.toggle("all"); btn.textContent = on ? "접기" : `더 보기 (${n - SHOW}개)`; };
      b.appendChild(btn);
    });
  }).observe(board, { childList: true });

  /* ── 홈 블록 그리기 (app.js 의 공용 함수 사용) ────────── */
  const get = (n) => fetch(`data/${n}.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  function drawHome(g, r, k) {
    const M = window.MV;
    if (!M) return;
    const { esc, isN, cls, num, pct, spark } = M;
    const find = (arr, key, v) => (arr || []).find((x) => x[key] === v);
    const idx = g ? Object.values(g.indices).flat() : [];
    const pick = [
      ["코스피", find(idx, "ticker", "^KS11"), "p"], ["코스닥", find(idx, "ticker", "^KQ11"), "p"],
      ["S&P 500", find(idx, "ticker", "^GSPC"), "p"], ["나스닥", find(idx, "ticker", "^IXIC"), "p"],
      ["원/달러", r && find(r.fx, "code", "FX_USDKRW"), "p"], ["美 10년물", r && find(r.bonds, "code", "US10YT=RR"), "b"],
    ];
    const dg = (v) => (v >= 1000 ? 2 : v >= 10 ? 2 : 3);
    $("#hmIdx").innerHTML = pick.map(([n, x, t]) => {
      if (!x) return `<div class="idx"><div class="idx-top"><span class="nm">${n}</span></div><div class="muted">–</div></div>`;
      const ch = t === "b" ? x.bp1d : x.pct;
      const chs = t === "b" ? `${ch > 0 ? "+" : ""}${num(ch, 1)}bp` : pct(ch);
      const v = t === "b" ? `${x.last.toFixed(3)}%` : num(x.last, dg(x.last));
      return `<div class="idx"><div class="idx-top"><span class="nm">${n}</span><span class="${cls(ch)}"><span class="pct">${chs}</span></span></div>
        <div><span class="v">${v}</span></div>${spark(x.spark, 200, 38)}
        <div class="idx-foot"><span>${esc(x.date ? x.date.slice(5).replace("-", "/") : "")}</span><span>1개월 <b class="${cls(t === "b" ? x.bp1m : x.r1m)}">${t === "b" ? `${num(x.bp1m, 0)}bp` : pct(x.r1m, 1)}</b></span></div></div>`;
    }).join("");

    // 업종 강세·약세 (코스피 업종, 1일)
    const rows = ((k && k.sectors && k.sectors.KOSPI) || []).filter((x) => isN(x.r1d)).sort((a, b) => b.r1d - a.r1d);
    if (k) $("#hmSecAsof").textContent = `코스피 업종 · ${k.date ? k.date.slice(5).replace("-", "/") : ""} 1일`;
    const mx = Math.max(0.01, ...rows.map((x) => Math.abs(x.r1d)));
    const bar = (x) => `<div class="hb"><span class="lb">${esc(x.sector)}</span><span class="tr"><i class="${cls(x.r1d)}" style="width:${Math.max(2, Math.abs(x.r1d) / mx * 100)}%"></i></span><b class="${cls(x.r1d)}">${pct(x.r1d)}</b></div>`;
    $("#hmSec").innerHTML = rows.length
      ? `<div class="card"><h4>강세 TOP 5</h4>${rows.slice(0, 5).map(bar).join("")}</div><div class="card"><h4>약세 TOP 5</h4>${rows.slice(-5).reverse().map(bar).join("")}</div>`
      : `<div class="err">업종 데이터를 불러오지 못했습니다.</div>`;

    if (g && g.updated) $("#hmAsof").textContent = `각 시장 최근 종가 · 갱신 ${g.updated}`;
  }
  function homeLater() {
    Promise.all(["global", "rates", "korea"].map(get)).then(([g, r, k]) => {
      if (window.MV) drawHome(g, r, k);
      else document.addEventListener("DOMContentLoaded", () => drawHome(g, r, k));
    });
  }
  homeLater();
})();
