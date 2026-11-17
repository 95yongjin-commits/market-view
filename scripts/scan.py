# Daily Market View · 기획·개발 김용진 (한화투자증권 WM지원팀) · 2026.11
"""차트 포착기용 가격 데이터 + 섹터 밸류체인.

KRX를 쓰지 않는다: 종목 목록은 네이버(국내)·Nasdaq(미국), 가격은 야후 수정주가.
조건 계산(정배열·볼린저·골든크로스·신고가)은 브라우저에서 한다 → PB가 숫자를 바꿀 수 있게.
"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

from collect import UA, log, now_kst, r2, series_stats

N_DAYS = 260               # 브라우저로 보내는 거래일 수 (120일선 + 52주 신고가)
KR_MIN_CAP = 1000          # 억원
US_MIN_CAP = 10e9          # 달러
US_SECTOR = {
    "Technology": "기술", "Finance": "금융", "Health Care": "헬스케어", "Consumer Discretionary": "경기소비재",
    "Industrials": "산업재", "Energy": "에너지", "Utilities": "유틸리티", "Real Estate": "부동산",
    "Basic Materials": "소재", "Telecommunications": "통신", "Consumer Staples": "필수소비재",
    "Miscellaneous": "기타",
}


def kr_listing() -> dict[str, dict]:
    """네이버 시총 순위 → {코드: {name, market, cap(억)}} (보통주·우선주, ETF/스팩 제외)"""
    out = {}

    def page(args):
        mkt, p = args
        r = requests.get(f"https://m.stock.naver.com/api/stocks/marketValue/{mkt}",
                         params={"page": p, "pageSize": 100}, headers=UA, timeout=15)
        return mkt, r.json().get("stocks") or []
    jobs = [(m, p) for m in ("KOSPI", "KOSDAQ") for p in range(1, 26)]
    with ThreadPoolExecutor(max_workers=6) as ex:
        for mkt, rows in ex.map(page, jobs):
            for s in rows:
                if s.get("stockEndType") != "stock" or "스팩" in s.get("stockName", ""):
                    continue
                cap = float(str(s.get("marketValue") or "0").replace(",", "") or 0)
                out[s["itemCode"]] = {"name": s["stockName"], "market": mkt, "cap": cap}
    if len(out) < 1500:
        raise RuntimeError(f"네이버 종목 목록 부족({len(out)})")
    return out


def us_listing() -> dict[str, dict]:
    j = requests.get("https://api.nasdaq.com/api/screener/stocks",
                     params={"tableonly": "true", "limit": 10000, "download": "true"},
                     headers={**UA, "Accept": "application/json"}, timeout=30).json()
    out = {}
    for x in j["data"]["rows"]:
        sym = x.get("symbol", "").strip()
        try:
            cap = float(x.get("marketCap") or 0)
        except ValueError:
            continue
        if cap < US_MIN_CAP or "^" in sym or not sym:
            continue
        name = x.get("name", "")
        for cut in (" Common Stock", " Class A", " Ordinary Shares", " American Depositary"):
            name = name.split(cut)[0]
        out[sym.replace("/", "-").replace(".", "-")] = {
            "name": name.strip(), "sector": US_SECTOR.get(x.get("sector") or "", "기타"), "cap": cap}
    if len(out) < 300:
        raise RuntimeError(f"Nasdaq 종목 목록 부족({len(out)})")
    return out


def download(tickers: list[str], period: str, chunk: int = 250) -> dict[str, pd.Series]:
    import yfinance as yf
    out = {}
    for i in range(0, len(tickers), chunk):
        part = tickers[i:i + chunk]
        df = yf.download(part, period=period, interval="1d", group_by="ticker",
                         auto_adjust=True, progress=False, threads=True)
        for t in part:
            try:
                s = df[t]["Close"] if isinstance(df.columns, pd.MultiIndex) else df["Close"]
                s = s.dropna()
                s.index = pd.to_datetime(s.index).tz_localize(None)
                if len(s):
                    out[t] = s
            except Exception:
                pass
    return out


def sig(v: float) -> float:
    return float(f"{v:.5g}")


def _wics_map() -> dict[str, str]:
    from stocks import WICS
    m = {}

    def one(code):
        try:
            for back in range(0, 7):
                dt = (now_kst() - pd.Timedelta(days=back)).strftime("%Y%m%d")
                r = requests.get("https://www.wiseindex.com/Index/GetIndexComponets",
                                 params={"ceil_yn": 0, "dt": dt, "sec_cd": code}, headers=UA, timeout=15)
                lst = r.json().get("list") or []
                if lst:
                    return code, [x["CMP_CD"] for x in lst]
        except Exception:
            pass
        return code, []
    with ThreadPoolExecutor(max_workers=6) as ex:
        for code, cds in ex.map(one, WICS):
            for c in cds:
                m.setdefault(c, WICS[code])
    return m


def _pack(market: str, meta: dict[str, dict], ysym: dict[str, str], closes: dict, ath_prev: dict) -> tuple[dict, dict]:
    series = {t: closes[ysym[t]] for t in meta if ysym[t] in closes and len(closes[ysym[t]]) >= 130}
    idx = sorted(set().union(*[s.index[-N_DAYS - 5:] for s in series.values()]))[-N_DAYS:]
    idx = pd.DatetimeIndex(idx)
    items, ath_new = [], {}
    for t, s in series.items():
        full = s
        # 역사적 신고가: 오늘 이전까지의 최고 종가 (전체 이력 최고치 캐시와 최근 2년 중 큰 값)
        prior = full.iloc[:-1]
        hist_max = max([v for v in (ath_prev.get(t), float(prior.max()) if len(prior) else None) if v is not None], default=None)
        # 캐시에는 '오늘 이전'까지만 저장 (장중 실행분이 섞여 당일 신고가를 가리지 않도록)
        if hist_max is not None:
            ath_new[t] = hist_max
        v = s.reindex(idx)
        # 거래정지 등 빈 날은 직전 값으로
        v = v.ffill()
        m = meta[t]
        items.append([t, m["name"], m.get("sector") or "", round(m["cap"]), sig(hist_max) if hist_max else None,
                      [None if pd.isna(x) else sig(x) for x in v.tolist()]])
    items.sort(key=lambda x: -x[3])
    return {"dates": [d.strftime("%Y-%m-%d") for d in idx], "items": items}, ath_new


def collect_scan(ctx: dict) -> dict:
    load_prev = ctx.get("load_prev", lambda n: None)
    ath_prev = (load_prev("scan_ath") or {}).get("ath", {})

    kr = {k: v for k, v in kr_listing().items() if v["cap"] >= KR_MIN_CAP}
    wics = _wics_map()
    for c, v in kr.items():
        # 우선주(코드 끝자리 5·7·9·K·L)는 WICS에 없으므로 보통주 섹터를 따른다
        v["sector"] = wics.get(c) or wics.get(c[:5] + "0", "")
    us = us_listing()
    from stocks import GLOBAL_UNIVERSE
    ko = {}
    for txt in GLOBAL_UNIVERSE.values():
        for item in txt.split("|"):
            t, n = item.strip().split(" ", 1)
            ko[t] = n
    for t, v in us.items():
        if t in ko:
            v["name"] = ko[t]
    log(f"포착기 유니버스: 국내 {len(kr)} / 미국 {len(us)}")

    ysym = {c: f"{c}.{'KS' if v['market'] == 'KOSPI' else 'KQ'}" for c, v in kr.items()}
    ysym.update({t: t for t in us})
    closes = download(list(ysym.values()), "2y")
    log(f"가격 수신 {len(closes)}/{len(ysym)}")

    # 역사적 신고가 캐시가 없는 종목은 전체 이력(max)을 한 번 받는다
    need = [t for t in ysym if t not in ath_prev and ysym[t] in closes]
    if need:
        log(f"역사적 고가 최초 계산 {len(need)}종목…")
        full = download([ysym[t] for t in need], "max", chunk=150)
        for t in need:
            s = full.get(ysym[t])
            if s is not None and len(s) > 1:
                ath_prev[t] = float(s.iloc[:-1].max())

    out_kr, ath_kr = _pack("KR", kr, ysym, closes, ath_prev)
    out_us, ath_us = _pack("US", us, ysym, closes, ath_prev)
    ctx["scan_ath"] = {**ath_prev, **ath_kr, **ath_us}
    return {"kr": out_kr, "us": out_us}


def collect_scan_ath(ctx: dict) -> dict:
    """collect_scan 이 계산한 역사적 고가 캐시를 별도 파일로 남긴다 (화면에서는 안 씀)."""
    ath = ctx.get("scan_ath")
    if not ath:
        raise RuntimeError("scan 단계가 먼저 성공해야 함")
    return {"ath": {k: sig(v) for k, v in ath.items()}}


# ──────────────────────────────────────────────────────────────────────
# 밸류체인
# ──────────────────────────────────────────────────────────────────────
def collect_valuechain(ctx: dict) -> dict:
    vc = json.loads((Path(__file__).parent / "valuechain.json").read_text(encoding="utf-8"))
    listing = kr_listing()
    ysym = {}
    for sec in vc["sectors"]:
        for st in sec["stages"]:
            for s in st["stocks"]:
                if s["country"] == "KR":
                    info = listing.get(s["ticker"])
                    if info:
                        ysym[s["ticker"]] = f"{s['ticker']}.{'KS' if info['market'] == 'KOSPI' else 'KQ'}"
                        s["cap"] = round(info["cap"])
                else:
                    ysym[s["ticker"]] = s["ticker"]
    closes = download(sorted(set(ysym.values())), "2y")
    log(f"밸류체인 가격 {len(closes)}/{len(set(ysym.values()))}")
    for sec in vc["sectors"]:
        for st in sec["stages"]:
            for s in st["stocks"]:
                stt = series_stats(closes.get(ysym.get(s["ticker"], ""), pd.Series(dtype=float)), spark_n=120)
                if stt:
                    s.update({k: stt[k] for k in ("last", "pct", "r1w", "r1m", "r3m", "ytd", "from_hi", "spark", "date")})
            st["stocks"] = [s for s in st["stocks"] if "last" in s]
    return vc


# ──────────────────────────────────────────────────────────────────────
# 신기술 테마: 설명은 themes.json(수작업), 주가·테마 지수는 자동
# ──────────────────────────────────────────────────────────────────────
THEME_BENCH = {"kospi": "^KS11", "nasdaq": "^IXIC"}
THEME_SUFFIX_CCY = {".T": "JPY", ".TW": "TWD", ".TWO": "TWD", ".SZ": "CNY", ".SS": "CNY"}


def _ew_index(closes: dict[str, pd.Series], syms: list[str], dates: pd.DatetimeIndex) -> pd.Series | None:
    """동일가중 지수(일별 수익률 평균, 시작=100). 휴장일은 직전 종가로 채움."""
    cols = {s: closes[s] for s in syms if s in closes and len(closes[s]) >= 60}
    if not cols:
        return None
    px = pd.DataFrame(cols).reindex(dates).ffill()
    ret = px.pct_change().clip(-0.5, 0.5).mean(axis=1, skipna=True).fillna(0)
    return (1 + ret).cumprod() * 100


def collect_themes(ctx: dict) -> dict:
    th = json.loads((Path(__file__).parent / "themes.json").read_text(encoding="utf-8"))
    listing = kr_listing()
    ysym = {}
    for t in th["themes"]:
        for s in t["stocks"]:
            if s["country"] == "KR":
                info = listing.get(s["ticker"])
                if info:
                    ysym[s["ticker"]] = f"{s['ticker']}.{'KS' if info['market'] == 'KOSPI' else 'KQ'}"
                    s["cap"] = round(info["cap"])
                s["ccy"] = "KRW"
            else:
                ysym[s["ticker"]] = s["ticker"]
                s["ccy"] = next((c for suf, c in THEME_SUFFIX_CCY.items() if s["ticker"].endswith(suf)), "USD")
    closes = download(sorted(set(ysym.values()) | set(THEME_BENCH.values())), "2y")
    log(f"테마 가격 {len(closes)}/{len(set(ysym.values())) + len(THEME_BENCH)}")
    for t in th["themes"]:
        for s in t["stocks"]:
            stt = series_stats(closes.get(ysym.get(s["ticker"], ""), pd.Series(dtype=float)), spark_n=120)
            if stt:
                s.update({k: stt[k] for k in ("last", "pct", "r1w", "r1m", "r3m", "ytd", "from_hi", "spark", "date")})
        # 대체 관계(alt)는 지수에서 뺀다
        mem = [s for s in t["stocks"] if s.get("rel") != "alt" and s["ticker"] in ysym]
        all_dates = sorted(set().union(*[closes[ysym[s["ticker"]]].index for s in mem if ysym[s["ticker"]] in closes]))
        dates = pd.DatetimeIndex(all_dates)[-253:]
        lines = {
            "theme": _ew_index(closes, [ysym[s["ticker"]] for s in mem], dates),
            "kr": _ew_index(closes, [ysym[s["ticker"]] for s in mem if s["country"] == "KR"], dates),
            "gl": _ew_index(closes, [ysym[s["ticker"]] for s in mem if s["country"] != "KR"], dates),
            **{k: _ew_index(closes, [v], dates) for k, v in THEME_BENCH.items()},
        }
        t["index"] = {
            "dates": [d.strftime("%Y-%m-%d") for d in dates],
            **{k: [r2(v) for v in s.tolist()] for k, s in lines.items() if s is not None},
            "members": len(mem),
        }
        st = series_stats(lines["theme"], spark_n=120) if lines["theme"] is not None else None
        if st:
            t["stat"] = {k: st[k] for k in ("pct", "r1w", "r1m", "r3m", "ytd", "spark")}
        t["stocks"] = [s for s in t["stocks"] if "last" in s]
    return th
