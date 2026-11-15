/* 시황 가이드: ① 오늘의 시장 국면(자동 판정) + 볼 것·볼 곳  ② WM지원팀 추천 영상·링크(텔레그램 게시) */
(function () {
  "use strict";
  function start() {
    const { $, esc, isN, num, pct, seg } = window.MV;
    const NC = "?t=" + Date.now();
    const get = (n) => fetch(`data/${n}.json${NC}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const S = {
      vix: ["CBOE VIX", "https://www.cboe.com/tradable_products/vix/"],
      hy: ["FRED 하이일드 스프레드", "https://fred.stlouisfed.org/series/BAMLH0A0HYM2"],
      fw: ["CME FedWatch", "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html"],
      us2: ["FRED 美 2년물", "https://fred.stlouisfed.org/series/DGS2"],
      ecos: ["한국은행 ECOS", "https://ecos.bok.or.kr/"],
      dxy: ["TradingView 달러인덱스", "https://www.tradingview.com/symbols/TVC-DXY/"],
      krx: ["KRX 정보데이터시스템", "https://data.krx.co.kr/"],
      inv: ["Investing 경제캘린더", "https://kr.investing.com/economic-calendar/"],
      ern: ["Nasdaq 실적 일정", "https://www.nasdaq.com/market-activity/earnings"],
      fv: ["Finviz 섹터 맵", "https://finviz.com/map.ashx"],
    };
    const IN = { flow: ["사이트 '수급'", "#sec-flow"], macro: ["사이트 '환율·금리'", "#sec-macro"], cal: ["사이트 '일정'", "#sec-cal"],
      scan: ["사이트 '차트 포착기'", "#sec-scan"], vc: ["사이트 '밸류체인'", "#sec-vc"], idx: ["사이트 '지수'", "#sec-index"], sec: ["사이트 '섹터'", "#sec-sector"] };
    const lnk = (k) => { const [l, u] = S[k] || IN[k]; return `<a href="${u}" ${S[k] ? 'target="_blank" rel="noopener"' : ""}>${esc(l)}${S[k] ? " ↗" : ""}</a>`; };
    const md = (iso) => { const d = new Date(iso + "T00:00:00"); return `${d.getMonth() + 1}/${d.getDate()}`; };

    /* 판정 규칙: 숫자 기준을 화면에도 그대로 보여준다 */
    function regimes(g, r, k, cal) {
      const out = [];
      const vix = g && g.indices.us.find((x) => x.ticker === "^VIX");
      if (vix) {
        const lv = vix.last >= 25 ? ["hot", "변동성 높음"] : vix.last >= 20 ? ["warm", "변동성 경계"] : vix.r1m >= 20 ? ["warm", "변동성 확대 중"] : ["calm", "변동성 안정"];
        out.push({ t: "변동성", lv: lv[0], st: lv[1], v: `VIX ${num(vix.last, 1)} · 1개월 ${pct(vix.r1m, 1)}`,
          look: "VIX가 20을 넘으면 경계, 25 이상이면 위험회피 국면입니다. 신용 스프레드가 같이 벌어지는지와 외국인 선물 매도를 함께 봅니다.",
          src: ["idx", "vix", "hy", "flow"], rule: "VIX 25↑ 높음 · 20↑ 경계 · 1개월 +20%↑ 확대 중" });
      }
      const us10 = r && r.bonds.find((b) => b.code === "US10YT=RR"), us2 = r && r.bonds.find((b) => b.code === "US2YT=RR");
      if (us10 && isN(us10.bp1w)) {
        const b = us10.bp1w;
        const lv = b >= 15 ? ["hot", "美 금리 급등"] : b >= 5 ? ["warm", "美 금리 상승"] : b <= -15 ? ["warm", "美 금리 급락"] : b <= -5 ? ["calm", "美 금리 하락"] : ["calm", "美 금리 보합"];
        out.push({ t: "금리", lv: lv[0], st: lv[1], v: `10년 ${num(us10.last, 2)}% · 1주 ${b > 0 ? "+" : ""}${num(b, 0)}bp${us2 && isN(us2.bp1w) ? ` (2년 ${us2.bp1w > 0 ? "+" : ""}${num(us2.bp1w, 0)}bp)` : ""}`,
          look: "2년물은 연준 기대, 10년물은 성장·물가 기대를 반영합니다. 금리가 급등할 때는 성장주와 고PER주가 약하고, 금리 인하 확률 변화는 FedWatch에서 확인합니다.",
          src: ["macro", "fw", "us2"], rule: "美 10년 1주 변화 ±15bp 급등·급락 · ±5bp 상승·하락" });
      }
      const fx = r && r.fx.find((x) => x.code === "FX_USDKRW");
      if (fx && isN(fx.r1w)) {
        const lv = fx.r1w >= 1.5 ? ["hot", "원화 약세"] : fx.r1w <= -1.5 ? ["warm", "원화 강세"] : ["calm", "환율 안정"];
        out.push({ t: "환율", lv: lv[0], st: lv[1], v: `원/달러 ${num(fx.last, 1)} · 1주 ${pct(fx.r1w, 1)}`,
          look: "원화 약세가 빠르면 외국인 매도가 커지기 쉽습니다. 달러인덱스(글로벌 달러)와 원화만의 약세인지 구분해서 보고, 수출주와 내수주의 차이를 확인합니다.",
          src: ["macro", "dxy", "ecos"], rule: "원/달러 1주 +1.5%↑ 원화 약세 · -1.5%↓ 원화 강세" });
      }
      const fl = k && k.flow && k.flow.KOSPI;
      if (fl && fl.length >= 5) {
        const s5 = fl.slice(-5).reduce((a, x) => a + (x["외국인"] || 0), 0);
        const lv = s5 >= 10000 ? ["warm", "외국인 순매수"] : s5 <= -10000 ? ["hot", "외국인 순매도"] : ["calm", "외국인 중립"];
        out.push({ t: "수급", lv: lv[0], st: lv[1], v: `코스피 외국인 5일 ${s5 > 0 ? "+" : ""}${num(s5 / 10000, 2)}조`,
          look: "외국인이 연속으로 사거나 파는 업종과 종목을 확인합니다. 환율 흐름과 같이 보면 방향이 이어질지 가늠하기 쉽습니다.",
          src: ["flow", "krx"], rule: "코스피 외국인 최근 5일 합계 ±1조" });
      }
      if (cal) {
        const today = cal.today, end = new Date(new Date(today + "T00:00:00").getTime() + 7 * 864e5).toISOString().slice(0, 10);
        const big = (cal.events || []).filter((e) => e.w >= 2 && e.date >= today && e.date <= end);
        const names = [...new Map(big.map((e) => [e.name, e])).values()];
        out.push({ t: "이벤트", lv: names.length ? "warm" : "calm", st: names.length ? "주요 일정 대기" : "큰 일정 없음",
          v: names.length ? names.slice(0, 3).map((e) => `${esc(e.name)}(${md(e.date)})`).join(" · ") : "향후 7일 내 중요 일정 없음",
          look: "FOMC·CPI·고용·금통위 전후로는 변동성이 커집니다. 발표 시각(한국시간)과 예상치를 미리 확인합니다.",
          src: ["cal", "inv", "fw"], rule: "향후 7일 내 중요도 높은 일정(★★) 유무", raw: true });
        const ern = (cal.earnings || []).filter((e) => e.date >= today && e.date <= end);
        out.push({ t: "실적", lv: ern.length >= 15 ? "warm" : "calm", st: ern.length >= 15 ? "실적 시즌" : "실적 비수기",
          v: `향후 7일 美 주요 실적 ${ern.length}건${ern.length ? " · " + ern.slice(0, 3).map((e) => esc(e.name)).join(", ") : ""}`,
          look: "실적 시즌에는 지수보다 종목·섹터별 차이가 커집니다. 발표 직후 신고가·갭 상승 종목과 섹터 강도를 확인합니다.",
          src: ["cal", "ern", "scan", "fv"], rule: "향후 7일 美 주요(유니버스·시총 $30B↑) 실적 15건↑", raw: true });
      }
      return out;
    }
    function renderRegime(g, r, k, cal) {
      const rs = regimes(g, r, k, cal);
      if (!rs.length) return ($("#gdRegime").innerHTML = `<div class="err">시장 데이터를 불러오지 못했습니다.</div>`);
      const hot = rs.filter((x) => x.lv !== "calm");
      $("#gdSummary").innerHTML = hot.length ? `지금 눈여겨볼 것: ${hot.map((x) => `<b class="lv-${x.lv}">${esc(x.st)}</b>`).join(" · ")}` : "특별히 튀는 지표가 없는 <b>안정 국면</b>입니다.";
      $("#gdRegime").innerHTML = rs.map((x) => `<div class="gd lv-${x.lv}">
          <div class="gd-h"><span class="gd-t">${esc(x.t)}</span><b>${esc(x.st)}</b></div>
          <div class="gd-v">${x.raw ? x.v : esc(x.v)}</div>
          <div class="gd-l">${esc(x.look)}</div>
          <div class="gd-s">${x.src.map(lnk).join("")}</div>
          <div class="gd-r" title="판정 기준">기준: ${esc(x.rule)}</div></div>`).join("");
    }

    /* 추천 영상·링크 */
    const L = { tag: "", limit: 9 };
    let links = [];
    function renderLinks() {
      const tags = [...new Set(links.flatMap((x) => x.tags || []))];
      $("#lkTags").style.display = tags.length ? "" : "none";
      if (tags.length) seg($("#lkTags"), [{ k: "", l: "전체" }, ...tags.map((t) => ({ k: t, l: "#" + esc(t) }))], L.tag, (k) => { L.tag = k; L.limit = 9; renderLinks(); });
      const rows = links.filter((x) => !L.tag || (x.tags || []).includes(L.tag));
      if (!rows.length) {
        $("#lkGrid").innerHTML = `<div class="empty-s" style="padding:18px">아직 게시된 링크가 없습니다. WM지원팀이 추천 영상·자료를 올리면 여기에 표시됩니다.</div>`;
        $("#lkMore").style.display = "none";
        return;
      }
      $("#lkGrid").innerHTML = rows.slice(0, L.limit).map((x) => x.kind === "image" ? `<a class="lk" href="${esc(x.imgs[0])}" data-img="${esc(x.id)}">
          <span class="lk-img"><img loading="lazy" src="${esc(x.imgs[0])}" alt="">${x.imgs.length > 1 ? `<i class="lk-play">+${x.imgs.length - 1}장</i>` : ""}</span>
          <span class="lk-b"><span class="lk-t">${esc(x.title || "사진")}</span>
          <span class="lk-s">🖼 사진 · ${esc((x.posted || "").slice(5, 10).replace("-", "/"))}</span>
          ${x.comment ? `<span class="lk-c">${esc(x.comment)}</span>` : ""}
          ${(x.tags || []).length ? `<span class="lk-g">${x.tags.map((t) => `#${esc(t)}`).join(" ")}</span>` : ""}</span></a>`
        : `<a class="lk" href="${esc(x.url)}" target="_blank" rel="noopener">
          ${x.thumb ? `<span class="lk-img"><img loading="lazy" src="${esc(x.thumb)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()">${x.kind === "youtube" ? '<i class="lk-play">▶</i>' : ""}</span>` : ""}
          <span class="lk-b"><span class="lk-t">${esc(x.title || x.site || x.url)}</span>
          <span class="lk-s">${esc(x.source || x.site || "")} · ${esc((x.posted || "").slice(5, 10).replace("-", "/"))}</span>
          ${x.comment ? `<span class="lk-c">${esc(x.comment)}</span>` : ""}
          ${(x.tags || []).length ? `<span class="lk-g">${x.tags.map((t) => `#${esc(t)}`).join(" ")}</span>` : ""}</span></a>`).join("");
      $("#lkMore").style.display = rows.length > L.limit ? "block" : "none";
    }

    Promise.all(["global", "rates", "korea", "calendar"].map(get)).then(([g, r, k, cal]) => renderRegime(g, r, k, cal));
    get("links").then((d) => { links = (d && d.items) || []; renderLinks(); });
    $("#lkMore").onclick = () => { L.limit += 9; renderLinks(); };
    // 사진 게시물: 크게 보기 (여러 장이면 세로로)
    $("#lkGrid").addEventListener("click", (e) => {
      const a = e.target.closest("[data-img]");
      if (!a) return;
      e.preventDefault();
      const x = links.find((q) => q.id === a.dataset.img);
      if (!x) return;
      $("#modalBox").innerHTML = `<div class="m-h"><div><h3>${esc(x.title || "사진")}</h3><div class="s">WM지원팀 · ${esc(x.posted || "")}</div></div>
        <button type="button" class="m-x" id="mClose">✕</button></div>
        ${x.comment ? `<p class="lk-c" style="margin:8px 0">${esc(x.comment)}</p>` : ""}
        <div class="lk-view">${x.imgs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt=""></a>`).join("")}</div>
        ${x.url ? `<a class="m-link" href="${esc(x.url)}" target="_blank" rel="noopener">관련 링크 ↗</a>` : ""}`;
      $("#modal").classList.add("show");
      $("#mClose").onclick = () => $("#modal").classList.remove("show");
    });
  }
  if (window.MV) start(); else document.addEventListener("mv:ready", start, { once: true });
})();
