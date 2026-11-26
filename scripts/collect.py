# Daily Market View · 2026.11
"""데일리 마켓뷰 데이터 수집기.

각 섹션을 독립적으로 수집해 JSON으로 저장한다. 한 섹션이 실패하면
--prev 로 받은 직전 배포본의 같은 섹션을 그대로 유지(stale 표시)한다.

사용:
    python scripts/collect.py --out web/data [--prev https://.../data] [--only news]
환경변수:
    KRX_ID / KRX_PW  : KRX 정보데이터시스템 로그인(국내 업종·수급)
"""
from __future__ import annotations

import argparse
import email.utils
import json
import os
import re
import sys
import time
import traceback
import warnings
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

warnings.filterwarnings("ignore")
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"}


def now_kst() -> datetime:
    return datetime.now(KST)


def log(*a):
    print(f"[{now_kst():%H:%M:%S}]", *a, flush=True)


def r2(x, n=2):
    try:
        if x is None or pd.isna(x):
            return None
        return round(float(x), n)
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────
# 공통: 종가 시계열 → 수익률 요약
# ──────────────────────────────────────────────────────────────────────
def series_stats(s: pd.Series, spark_n: int = 60, digits: int = 2) -> dict | None:
    s = s.dropna()
    s = s[s > 0]
    if len(s) < 2:
        return None
    last, prev = float(s.iloc[-1]), float(s.iloc[-2])

    def ret(k):
        return r2((last / float(s.iloc[-1 - k]) - 1) * 100) if len(s) > k else None

    ytd = None
    yr = s.index[-1].year
    before = s[s.index.year < yr]
    if len(before):
        ytd = r2((last / float(before.iloc[-1]) - 1) * 100)
    tail = s.iloc[-spark_n:]
    return {
        "last": r2(last, digits),
        "chg": r2(last - prev, digits),
        "pct": r2((last / prev - 1) * 100),
        "r1w": ret(5), "r1m": ret(21), "r3m": ret(63), "ytd": ytd,
        "hi52": r2(s.iloc[-252:].max(), digits),
        "from_hi": r2((last / float(s.iloc[-252:].max()) - 1) * 100),
        "date": s.index[-1].strftime("%Y-%m-%d"),
        "spark": [r2(v, digits) for v in tail.tolist()],
    }


def yf_closes(tickers: list[str]) -> dict[str, pd.Series]:
    import yfinance as yf
    df = yf.download(tickers, period="2y", interval="1d", group_by="ticker",
                     auto_adjust=True, progress=False, threads=True)
    out = {}
    for t in tickers:
        try:
            s = df[t]["Close"] if isinstance(df.columns, pd.MultiIndex) else df["Close"]
            s.index = pd.to_datetime(s.index).tz_localize(None)
            s = s.dropna().copy()
            if t in YF_PATCH_LAST:
                fix = yf_meta_close(t)
                if fix and (s.empty or fix[0] > s.index[-1]):
                    log(f"  {t}: 일봉 누락 → meta 종가 보완 {fix[0]:%Y-%m-%d} {fix[1]:,.2f}")
                    s.loc[fix[0]] = fix[1]
            out[t] = s
        except Exception:
            pass
    return out


# 야후가 한국 지수의 당일 일봉을 null로 늦게 채우는 경우가 잦아 meta 값으로 보완
YF_PATCH_LAST = {"^KS11", "^KQ11"}


def yf_meta_close(t: str):
    """차트 API meta의 regularMarketPrice를 (날짜, 종가)로 반환. 장중이면 None."""
    try:
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(t)}",
                         params={"range": "5d", "interval": "1d"}, headers=UA, timeout=10)
        m = r.json()["chart"]["result"][0]["meta"]
        ts = int(m["regularMarketTime"])
        end = int(m["currentTradingPeriod"]["regular"]["end"])
        start = int(m["currentTradingPeriod"]["regular"]["start"])
        if start <= ts < end:        # 정규장 진행 중 → 종가 아님
            return None
        d = datetime.fromtimestamp(ts, KST).date()
        return pd.Timestamp(d), float(m["regularMarketPrice"])
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────────
# 1) 지수 · 원자재 · 해외 섹터 (yfinance)
# ──────────────────────────────────────────────────────────────────────
INDICES = [
    ("kr", "^KS11", "코스피"), ("kr", "^KQ11", "코스닥"),
    ("us", "^GSPC", "S&P 500"), ("us", "^IXIC", "나스닥"), ("us", "^DJI", "다우"),
    ("us", "^SOX", "필라델피아 반도체"), ("us", "^RUT", "러셀 2000"), ("us", "^VIX", "VIX"),
    ("world", "^N225", "닛케이 225"), ("world", "^TWII", "대만 가권"), ("world", "000001.SS", "상해종합"),
    ("world", "^HSI", "항셍"), ("world", "^STOXX50E", "유로스톡스 50"), ("world", "^GDAXI", "독일 DAX"),
]
COMMODITIES = [
    ("CL=F", "WTI", "$/bbl"), ("BZ=F", "브렌트", "$/bbl"), ("GC=F", "금", "$/oz"),
    ("SI=F", "은", "$/oz"), ("HG=F", "구리", "$/lb"), ("NG=F", "천연가스", "$/MMBtu"),
    ("BTC-USD", "비트코인", "$"), ("DX-Y.NYB", "달러인덱스", ""), ("JPY=X", "달러/엔", "¥"),
    ("EURUSD=X", "유로/달러", "$"),
]
US_SECTORS = [
    ("XLK", "정보기술"), ("XLC", "커뮤니케이션"), ("XLY", "경기소비재"), ("XLP", "필수소비재"),
    ("XLV", "헬스케어"), ("XLF", "금융"), ("XLI", "산업재"), ("XLE", "에너지"),
    ("XLB", "소재"), ("XLU", "유틸리티"), ("XLRE", "부동산"),
]
THEMES = [
    ("SMH", "반도체"), ("IGV", "소프트웨어"), ("SKYY", "클라우드"), ("ITA", "방산·항공"),
    ("URA", "우라늄·원전"), ("TAN", "태양광"), ("LIT", "2차전지·리튬"), ("IBB", "바이오"),
    ("KRE", "지역은행"), ("XHB", "주택건설"), ("JETS", "항공"), ("GDX", "금광"),
    ("BOTZ", "로봇·AI"), ("CIBR", "사이버보안"), ("XME", "금속·광산"), ("PAVE", "인프라"),
]


def collect_global() -> dict:
    tickers = ([t for _, t, _ in INDICES] + [t for t, _, _ in COMMODITIES]
               + [t for t, _ in US_SECTORS] + [t for t, _ in THEMES])
    closes = yf_closes(tickers)
    log(f"yfinance {len(closes)}/{len(tickers)} 종목 수신")

    def pack(t, name, **extra):
        st = series_stats(closes[t]) if t in closes else None
        return {"ticker": t, "name": name, **extra, **(st or {})} if st else None

    indices = {"kr": [], "us": [], "world": []}
    for grp, t, name in INDICES:
        if (row := pack(t, name)):
            indices[grp].append(row)
    commodities = [row for t, name, unit in COMMODITIES if (row := pack(t, name, unit=unit))]
    us_sectors = [row for t, name in US_SECTORS if (row := pack(t, name))]
    themes = [row for t, name in THEMES if (row := pack(t, name))]
    for rows in (us_sectors, themes):
        for r in rows:
            r.pop("spark", None)
    if not indices["us"]:
        raise RuntimeError("yfinance 지수 수신 실패")
    return {"indices": indices, "commodities": commodities,
            "us_sectors": us_sectors, "themes": themes}


# ──────────────────────────────────────────────────────────────────────
# 2) 금리 · 환율 (네이버 증권 마켓인덱스)
# ──────────────────────────────────────────────────────────────────────
BONDS = [
    ("KR3YT=RR", "국고채 3년", "kr"), ("KR10YT=RR", "국고채 10년", "kr"),
    ("US2YT=RR", "미국채 2년", "us"), ("US10YT=RR", "미국채 10년", "us"),
    ("US30YT=RR", "미국채 30년", "us"),
    ("JP10YT=RR", "일본 10년", "world"), ("DE10YT=RR", "독일 10년", "world"),
]
FX = [
    ("FX_USDKRW", "원/달러"), ("FX_JPYKRW", "원/100엔"),
    ("FX_EURKRW", "원/유로"), ("FX_CNYKRW", "원/위안"),
]


def naver_prices(category: str, code: str, pages: int = 2) -> pd.Series:
    rows = []
    for p in range(1, pages + 1):
        r = requests.get("https://m.stock.naver.com/front-api/marketIndex/prices",
                         params={"category": category, "reutersCode": code,
                                 "page": p, "pageSize": 60}, headers=UA, timeout=10)
        res = r.json().get("result") or []
        rows += res
        if len(res) < 60:
            break
    data = {}
    for x in rows:
        d = str(x["localTradedAt"])[:10]
        data[pd.Timestamp(d)] = float(str(x["closePrice"]).replace(",", ""))
    return pd.Series(data).sort_index()


def collect_rates_fx() -> dict:
    bonds = []
    for code, name, grp in BONDS:
        try:
            s = naver_prices("bond", code)
            st = series_stats(s, digits=3)
            if not st:
                continue
            last = s.dropna()
            # 금리는 변화폭(bp)이 핵심
            def bp(k):
                return r2((last.iloc[-1] - last.iloc[-1 - k]) * 100, 1) if len(last) > k else None
            st.update({"bp1d": bp(1), "bp1w": bp(5), "bp1m": bp(21)})
            for k in ("pct", "r1w", "r1m", "r3m", "ytd", "from_hi", "hi52"):
                st.pop(k, None)
            bonds.append({"code": code, "name": name, "group": grp, **st})
        except Exception as e:
            log("금리 실패", code, e)
    fx = []
    for code, name in FX:
        try:
            st = series_stats(naver_prices("exchange", code))
            if st:
                fx.append({"code": code, "name": name, **st})
        except Exception as e:
            log("환율 실패", code, e)
    if not bonds and not fx:
        raise RuntimeError("금리·환율 수신 실패")
    # 장단기 스프레드
    by = {b["code"]: b["last"] for b in bonds}
    spreads = []
    if "US10YT=RR" in by and "US2YT=RR" in by:
        spreads.append({"name": "美 10년-2년", "bp": r2((by["US10YT=RR"] - by["US2YT=RR"]) * 100, 1)})
    if "KR10YT=RR" in by and "KR3YT=RR" in by:
        spreads.append({"name": "韓 10년-3년", "bp": r2((by["KR10YT=RR"] - by["KR3YT=RR"]) * 100, 1)})
    if "KR10YT=RR" in by and "US10YT=RR" in by:
        spreads.append({"name": "韓-美 10년", "bp": r2((by["KR10YT=RR"] - by["US10YT=RR"]) * 100, 1)})
    return {"bonds": bonds, "fx": fx, "spreads": spreads}


# ──────────────────────────────────────────────────────────────────────
# 3) 국내 업종 · 수급 (KRX via pykrx)
# ──────────────────────────────────────────────────────────────────────
def krx_login():
    from pykrx.website.comm.auth import build_krx_session, set_auth_session
    kid, kpw = os.getenv("KRX_ID"), os.getenv("KRX_PW")
    if not (kid and kpw):
        raise RuntimeError("KRX_ID/KRX_PW 미설정")
    set_auth_session(build_krx_session(kid, kpw))


KRX_FINAL_HHMM = "16:00"   # 이 시각 전에는 당일 KRX 데이터가 미확정(장중 빈 값) → 직전 거래일 기준


def krx_closed(tv: pd.DataFrame) -> pd.DataFrame:
    """거래일 표에서 아직 확정 안 된 '오늘' 행을 뺀다 (장중 실행 시 빈 데이터로 덮어쓰는 문제 방지)."""
    now = now_kst()
    if now.strftime("%H:%M") < KRX_FINAL_HHMM:
        tv = tv[pd.to_datetime(tv.index).date < now.date()]
    return tv


def col(df, *cands):
    for c in cands:
        if c in df.columns:
            return c
    raise KeyError(f"{cands} not in {list(df.columns)}")


EOK = 1e8  # 억원


def collect_korea() -> dict:
    from pykrx import stock
    krx_login()
    today = now_kst()
    start = (today - timedelta(days=50)).strftime("%Y%m%d")
    end = today.strftime("%Y%m%d")

    # 시장 전체 투자자별 순매수 (최근 거래일 목록도 여기서 확보)
    flow = {}
    days: list[str] = []
    for mkt in ("KOSPI", "KOSDAQ"):
        tv = stock.get_market_trading_value_by_date(start, end, mkt)
        tv = krx_closed(tv[(tv.abs().sum(axis=1) > 0)])
        if tv.empty:
            continue
        if not days:
            days = [d.strftime("%Y%m%d") for d in tv.index]
        c_ind, c_for, c_ins = col(tv, "개인"), col(tv, "외국인합계", "외국인"), col(tv, "기관합계")
        flow[mkt] = [{"date": d.strftime("%Y-%m-%d"),
                      "개인": r2(row[c_ind] / EOK, 0), "외국인": r2(row[c_for] / EOK, 0),
                      "기관": r2(row[c_ins] / EOK, 0)} for d, row in tv.tail(20).iterrows()]
    if len(days) < 22:
        raise RuntimeError(f"KRX 거래일 데이터 부족({len(days)})")
    d0, d1w, d1m = days[-1], days[-6], days[-22]
    log("KRX 기준일", d0)

    # 종목 기본(업종·시총·등락률) + 기간 등락률
    base = []
    for mkt in ("KOSPI", "KOSDAQ"):
        sc = stock.get_market_sector_classifications(d0, market=mkt)
        sc = sc.rename(columns={col(sc, "종목명"): "name", col(sc, "업종명"): "sector",
                                col(sc, "종가"): "close", col(sc, "등락률"): "r1d",
                                col(sc, "시가총액"): "mcap"})[["name", "sector", "close", "r1d", "mcap"]]
        for tag, frm in (("r1w", d1w), ("r1m", d1m)):
            pc = stock.get_market_price_change(frm, d0, market=mkt)
            sc[tag] = pc[col(pc, "등락률")].reindex(sc.index)
        sc["market"] = mkt
        base.append(sc)
    base = pd.concat(base)
    base.index = base.index.astype(str)

    # 투자자별 종목 순매수 (최근 5거래일)
    inv_keys = {"foreign": "외국인", "inst": "기관합계"}
    net: dict[str, dict[str, pd.Series]] = {k: {} for k in inv_keys}
    for d in days[-5:]:
        for k, inv in inv_keys.items():
            parts = []
            for mkt in ("KOSPI", "KOSDAQ"):
                df = stock.get_market_net_purchases_of_equities_by_ticker(d, d, market=mkt, investor=inv)
                if not df.empty:
                    s = df[col(df, "순매수거래대금")]
                    s.index = s.index.astype(str)
                    parts.append(s)
                    names = df[col(df, "종목명")]
                    for t, n in names.items():
                        if str(t) not in base.index:
                            base.loc[str(t), ["name", "market"]] = [n, mkt]
            net[k][d] = pd.concat(parts) if parts else pd.Series(dtype=float)
    last5 = days[-5:]

    def top_list(k: str, direction: str, window: str) -> list[dict]:
        if window == "1d":
            s = net[k][d0]
        else:
            s = pd.concat([net[k][d] for d in last5], axis=1).fillna(0).sum(axis=1)
        s = s.sort_values(ascending=(direction == "sell")).head(15)
        out = []
        for t, v in s.items():
            if (direction == "buy" and v <= 0) or (direction == "sell" and v >= 0):
                continue
            streak = 0
            for d in reversed(last5):
                x = net[k][d].get(t, 0)
                if (x > 0 if direction == "buy" else x < 0):
                    streak += 1
                else:
                    break
            b = base.loc[t] if t in base.index else None
            out.append({
                "ticker": t,
                "name": str(b["name"]) if b is not None else t,
                "sector": (str(b["sector"]) if b is not None and pd.notna(b.get("sector")) else ""),
                "net": r2(v / EOK, 0),
                "close": r2(b["close"], 0) if b is not None else None,
                "r1d": r2(b["r1d"]) if b is not None else None,
                "streak": streak,
            })
        return out

    tops = {f"{k}_{dirn}_{w}": top_list(k, dirn, w)
            for k in inv_keys for dirn in ("buy", "sell") for w in ("1d", "5d")}

    # 업종 집계 (시총가중 수익률 + 외국인/기관 순매수)
    base["f_net"] = net["foreign"][d0].reindex(base.index).fillna(0)
    base["i_net"] = net["inst"][d0].reindex(base.index).fillna(0)
    sectors = {}
    for mkt in ("KOSPI", "KOSDAQ"):
        g = base[(base["market"] == mkt) & base["sector"].notna() & (base["mcap"] > 0)]
        rows = []
        for sec, grp in g.groupby("sector"):
            if len(grp) < 3:
                continue
            w = grp["mcap"] / grp["mcap"].sum()

            def wavg(c):
                v = grp[c]
                m = v.notna()
                return r2((v[m] * w[m]).sum() / w[m].sum()) if m.any() else None
            leaders = grp.sort_values("mcap", ascending=False).head(6)
            rows.append({
                "sector": str(sec), "count": int(len(grp)),
                "mcap_t": r2(grp["mcap"].sum() / 1e12, 1),
                "r1d": wavg("r1d"), "r1w": wavg("r1w"), "r1m": wavg("r1m"),
                "up": int((grp["r1d"] > 0).sum()), "down": int((grp["r1d"] < 0).sum()),
                "f_net": r2(grp["f_net"].sum() / EOK, 0), "i_net": r2(grp["i_net"].sum() / EOK, 0),
                "leaders": [{"ticker": t, "name": str(x["name"]), "r1d": r2(x["r1d"]),
                             "r1w": r2(x["r1w"]), "mcap_t": r2(x["mcap"] / 1e12, 1)}
                            for t, x in leaders.iterrows()],
            })
        sectors[mkt] = sorted(rows, key=lambda r: -(r["mcap_t"] or 0))

    # 시장 폭(상승/하락 종목 수)
    breadth = {}
    for mkt in ("KOSPI", "KOSDAQ"):
        g = base[base["market"] == mkt]["r1d"].dropna()
        breadth[mkt] = {"up": int((g > 0).sum()), "down": int((g < 0).sum()), "flat": int((g == 0).sum())}

    return {"date": f"{d0[:4]}-{d0[4:6]}-{d0[6:]}", "days5": [f"{d[4:6]}/{d[6:]}" for d in last5],
            "flow": flow, "tops": tops, "sectors": sectors, "breadth": breadth}


# ──────────────────────────────────────────────────────────────────────
# 4) 뉴스플로우 (RSS)
# ──────────────────────────────────────────────────────────────────────
FEEDS = [
    ("kr", "한국경제", "https://www.hankyung.com/feed/finance"),
    ("kr", "매일경제", "https://www.mk.co.kr/rss/50200011/"),
    ("kr", "연합뉴스", "https://www.yna.co.kr/rss/economy.xml"),
    ("kr", "구글뉴스", "https://news.google.com/rss/search?q=%EC%BD%94%EC%8A%A4%ED%94%BC+OR+%EC%A6%9D%EC%8B%9C+when:1d&hl=ko&gl=KR&ceid=KR:ko"),
    ("global", "CNBC", "https://www.cnbc.com/id/10000664/device/rss/rss.html"),
    ("global", "CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("global", "MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("global", "Google News", "https://news.google.com/rss/search?q=stock+market+when:1d&hl=en-US&gl=US&ceid=US:en"),
]
TAGS = {
    "반도체": ["반도체", "HBM", "삼성전자", "하이닉스", "엔비디아", "마이크론", "TSMC", "파운드리",
            "Nvidia", "chip", "chips", "semiconductor", "Micron", "Broadcom", "AMD"],
    "AI": ["AI", "인공지능", "데이터센터", "OpenAI", "GPU", "data center"],
    "금리": ["금리", "국채", "국고채", "FOMC", "연준", "기준금리", "한은", "Fed", "yield", "yields",
           "Treasury", "Treasuries", "rate cut", "rate hike", "Powell"],
    "환율": ["환율", "달러", "원화", "엔화", "위안", "dollar", "yen", "currency", "forex"],
    "실적": ["실적", "영업이익", "어닝", "매출", "가이던스", "earnings", "revenue", "guidance", "quarterly"],
    "2차전지": ["2차전지", "이차전지", "배터리", "전기차", "에코프로", "LG에너지", "battery", "EV", "Tesla"],
    "수급": ["외국인", "기관", "순매수", "순매도", "공매도", "개인투자자"],
    "원자재": ["유가", "원유", "WTI", "금값", "금 가격", "구리", "oil", "crude", "gold", "copper", "OPEC"],
    "정책": ["관세", "정부", "규제", "밸류업", "세제", "트럼프", "tariff", "tariffs", "Trump", "regulation", "White House"],
    "물가·경기": ["CPI", "물가", "인플레", "고용", "GDP", "PMI", "inflation", "jobs", "payrolls", "recession", "소비자"],
}
_TAG_RX = {
    tag: re.compile("|".join(
        (rf"\b{re.escape(w)}\b" if re.match(r"^[A-Za-z ]+$", w) else re.escape(w)) for w in words),
        re.IGNORECASE if tag != "AI" else 0)
    for tag, words in TAGS.items()
}


def _clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    s = (s.replace("&quot;", '"').replace("&#39;", "'").replace("&amp;", "&")
          .replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " "))
    return re.sub(r"\s+", " ", s).strip()


def _rss_items(content: bytes) -> list[dict]:
    """RSS item 목록. XML이 깨진 피드(이스케이프 안 된 & 등)는 정규식으로 읽는다."""
    try:
        root = ET.fromstring(content)
        return [{"title": it.findtext("title"), "link": it.findtext("link"),
                 "pub": it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date")}
                for it in root.iter("item")]
    except ET.ParseError:
        text = content.decode("utf-8", "ignore")
        out = []
        for blk in re.findall(r"<item[\s>](.*?)</item>", text, re.S):
            def tag(name):
                m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", blk, re.S)
                return re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", m.group(1).strip(), flags=re.S) if m else None
            out.append({"title": tag("title"), "link": tag("link"), "pub": tag("pubDate") or tag("dc:date")})
        return out


def collect_news() -> dict:
    items, seen = [], set()
    cutoff = now_kst() - timedelta(hours=48)
    status = []
    for region, src, url in FEEDS:
        try:
            # 언론사마다 봇 차단 기준이 달라 짧은 UA → 브라우저 UA 순으로 시도
            raw = []
            for headers in ({"User-Agent": "Mozilla/5.0"}, UA):
                r = requests.get(url, headers=headers, timeout=12)
                raw = _rss_items(r.content) if r.ok else []
                if raw:
                    break
            n = 0
            for it in raw:
                title = _clean(it["title"])
                link = (it["link"] or "").strip()
                pub = it["pub"]
                try:
                    dt = email.utils.parsedate_to_datetime(pub) if pub and "," in pub else datetime.fromisoformat(pub)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=KST)
                    dt = dt.astimezone(KST)
                except Exception:
                    continue
                if dt < cutoff or not title:
                    continue
                source = src
                if src.startswith("구글") or src.startswith("Google"):
                    m = re.match(r"^(.*) - ([^-]+)$", title)
                    if m:
                        title, source = m.group(1).strip(), m.group(2).strip()
                key = re.sub(r"[\W_]+", "", title.lower())[:40]
                if key in seen:
                    continue
                seen.add(key)
                tags = [t for t, rx in _TAG_RX.items() if rx.search(title)]
                items.append({"t": dt.strftime("%Y-%m-%d %H:%M"), "region": region, "src": source,
                              "title": title, "url": link, "tags": tags})
                n += 1
            status.append(f"{src}:{n}")
        except Exception as e:
            status.append(f"{src}:ERR")
            log("뉴스 실패", src, e)
    if not items:
        raise RuntimeError("뉴스 수신 실패")
    items.sort(key=lambda x: x["t"], reverse=True)
    log("뉴스", ", ".join(status))
    return {"items": items[:300], "tags": list(TAGS.keys())}


# ──────────────────────────────────────────────────────────────────────
CTX: dict = {}


def _stocks_kr():
    from stocks import collect_stocks_kr
    return collect_stocks_kr(CTX)


def _stocks_global():
    from stocks import collect_stocks_global
    return collect_stocks_global(CTX)


def _calendar():
    from extras import collect_calendar
    return collect_calendar(CTX)


def _short():
    from extras import collect_short
    return collect_short(CTX)


def _scan():
    from scan import collect_scan
    return collect_scan(CTX)


def _scan_ath():
    from scan import collect_scan_ath
    return collect_scan_ath(CTX)


def _valuechain():
    from scan import collect_valuechain
    return collect_valuechain(CTX)


def _themes():
    from scan import collect_themes
    return collect_themes(CTX)


def _disclosures():
    from disclosures import collect_disclosures
    return collect_disclosures(CTX)


def _links():
    from links import collect_links
    return collect_links(CTX)


SECTIONS = {
    "global": collect_global,
    "rates": collect_rates_fx,
    "calendar": _calendar,
    "korea": collect_korea,
    "short": _short,
    "stocks_kr": _stocks_kr,
    "stocks_global": _stocks_global,
    "valuechain": _valuechain,
    "themes": _themes,
    "scan": _scan,
    "scan_ath": _scan_ath,
    "news": collect_news,
    "links": _links,
    "disclosures": _disclosures,
}


def load_prev(prev: str | None, out: Path, name: str):
    """직전 배포본(URL) 또는 로컬 파일에서 같은 섹션을 읽는다."""
    if prev:
        try:
            r = requests.get(f"{prev.rstrip('/')}/{name}.json", headers=UA, timeout=10)
            if r.ok:
                return r.json()
        except Exception:
            pass
    p = out / f"{name}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/data")
    ap.add_argument("--prev", default=None, help="직전 배포 data URL (실패 시 대체용)")
    ap.add_argument("--only", nargs="*", default=None)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    try:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    except Exception:
        pass

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    CTX["load_prev"] = lambda name: load_prev(a.prev, out, name)
    CTX["out"] = out
    meta = load_prev(a.prev, out, "meta") or {}
    meta.setdefault("sections", {})
    failed = []
    for name, fn in SECTIONS.items():
        if a.only and name not in a.only:
            if a.prev and not (out / f"{name}.json").exists():
                prev = load_prev(a.prev, out, name)
                if prev:
                    (out / f"{name}.json").write_text(json.dumps(prev, ensure_ascii=False), encoding="utf-8")
            continue
        t0 = time.time()
        try:
            data = fn()
            data["updated"] = now_kst().strftime("%Y-%m-%d %H:%M")
            (out / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")),
                                              encoding="utf-8")
            meta["sections"][name] = {"ok": True, "updated": data["updated"]}
            log(f"✓ {name} ({time.time() - t0:.1f}s)")
        except Exception as e:
            failed.append(name)
            traceback.print_exc()
            prev = load_prev(a.prev, out, name)
            if prev and not (out / f"{name}.json").exists():
                (out / f"{name}.json").write_text(json.dumps(prev, ensure_ascii=False), encoding="utf-8")
            meta["sections"][name] = {**meta["sections"].get(name, {}), "ok": False,
                                      "error": str(e)[:200], "tried": now_kst().strftime("%Y-%m-%d %H:%M")}
            log(f"✗ {name}: {e}")
    meta["updated"] = now_kst().strftime("%Y-%m-%d %H:%M")
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    if len(failed) == len(SECTIONS):
        sys.exit(1)


if __name__ == "__main__":
    main()
