"""주간 일정(미국 실적·경제지표·국내 만기일) / 국내 공매도.

collect.py 에서 섹션 'calendar', 'short' 로 호출된다.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd
import requests

from collect import EOK, KST, col, krx_login, log, now_kst, r2

ET = ZoneInfo("America/New_York")
NQ = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

# ──────────────────────────────────────────────────────────────────────
# 1) 주간 일정
# ──────────────────────────────────────────────────────────────────────
# (국가, 정규식, 한글명, 중요도 2=핵심 1=참고)
ECON_RULES = [
    ("United States", r"^Nonfarm Payrolls$", "비농업 고용", 2),
    ("United States", r"^Unemployment Rate$", "실업률", 2),
    ("United States", r"^CPI \((MoM|YoY)\)$", "소비자물가(CPI)", 2),
    ("United States", r"^Core CPI \((MoM|YoY)\)$", "근원 CPI", 2),
    ("United States", r"^PPI \(MoM\)$", "생산자물가(PPI)", 1),
    ("United States", r"^Core PCE Price Index \((MoM|YoY)\)$", "근원 PCE", 2),
    ("United States", r"^GDP \(QoQ\)$", "GDP 성장률", 2),
    ("United States", r"^Retail Sales \(MoM\)$", "소매판매", 2),
    ("United States", r"^Core Retail Sales \(MoM\)$", "근원 소매판매", 1),
    ("United States", r"^Initial Jobless Claims$", "신규 실업수당 청구", 1),
    ("United States", r"^ADP Nonfarm Employment Change$", "ADP 민간고용", 1),
    ("United States", r"^JOLTS Job Openings$", "JOLTS 구인", 1),
    ("United States", r"^ISM Manufacturing PMI$", "ISM 제조업", 2),
    ("United States", r"^ISM (Non-Manufacturing|Services) PMI$", "ISM 서비스업", 2),
    ("United States", r"^S&P Global (Manufacturing|Services) PMI$", "S&P 글로벌 PMI", 1),
    ("United States", r"^(CB )?Consumer Confidence$", "컨퍼런스보드 소비자신뢰", 1),
    ("United States", r"^Michigan Consumer Sentiment$", "미시간 소비자심리", 1),
    ("United States", r"^Durable Goods Orders \(MoM\)$", "내구재 주문", 1),
    ("United States", r"^Industrial Production \(MoM\)$", "산업생산", 1),
    ("United States", r"^Philadelphia Fed Manufacturing Index$", "필라델피아 연은 제조업", 1),
    ("United States", r"^NY Empire State Manufacturing Index$", "뉴욕 연은 제조업", 1),
    ("United States", r"^(Existing|New) Home Sales$", "주택판매", 1),
    ("United States", r"^Building Permits$", "건축허가", 1),
    ("United States", r"^Fed Interest Rate Decision$", "FOMC 금리 결정", 2),
    ("United States", r"^FOMC Meeting Minutes$", "FOMC 의사록", 2),
    ("United States", r"^FOMC (Statement|Economic Projections)$", "FOMC 성명·전망", 2),
    ("United States", r"^Fed Chair .* Speaks$", "연준 의장 발언", 2),
    ("United States", r"^Crude Oil Inventories$", "EIA 원유재고", 1),
    ("Euro Zone", r"^(Deposit Facility Rate|ECB Interest Rate Decision)$", "ECB 금리 결정", 2),
    ("Euro Zone", r"^CPI \(YoY\)$", "유로존 CPI", 1),
    ("Japan", r"^BoJ Interest Rate Decision$", "BOJ 금리 결정", 2),
    ("Japan", r"^National Core CPI \(YoY\)$", "일본 근원 CPI", 1),
    ("United Kingdom", r"^BoE Interest Rate Decision$", "BOE 금리 결정", 1),
    ("China", r"^GDP \(YoY\)$", "중국 GDP", 2),
    ("China", r"^CPI \(YoY\)$", "중국 CPI", 1),
    ("China", r"^(Manufacturing PMI|Caixin Manufacturing PMI)$", "중국 제조업 PMI", 1),
    ("China", r"^(Industrial Production|Retail Sales) \(YoY\)$", "중국 산업생산·소매판매", 1),
    ("China", r"^Loan Prime Rate 1Y$", "중국 LPR", 1),
    ("South Korea", r"^Interest Rate Decision$", "한국은행 금리 결정", 2),
    ("South Korea", r"^Exports \(YoY\)$", "한국 수출", 1),
]
FLAG = {"United States": "미국", "Euro Zone": "유로존", "Japan": "일본", "United Kingdom": "영국",
        "China": "중국", "South Korea": "한국"}
_RULES = [(c, re.compile(p, re.I), n, w) for c, p, n, w in ECON_RULES]
EARN_MIN_CAP = 30e9  # 시총 300억 달러 이상 or 글로벌 유니버스 종목


def _calendar_range() -> list[date]:
    """이번 주 월요일(주말이면 다음 주 월요일)부터 2주간 평일."""
    t = now_kst().date()
    mon = t - timedelta(days=t.weekday()) if t.weekday() < 5 else t + timedelta(days=7 - t.weekday())
    return [mon + timedelta(days=i) for i in range(12) if (mon + timedelta(days=i)).weekday() < 5]


def _clean(v):
    v = (v or "").replace("&nbsp;", "").strip()
    return v or None


def _option_expiries(days: list[date]) -> list[dict]:
    out = []
    for d in days:
        if d.weekday() == 3 and 8 <= d.day <= 14:  # 매월 둘째 목요일
            quad = d.month in (3, 6, 9, 12)
            out.append({"date": d.isoformat(), "kst": "15:20", "country": "한국",
                        "name": "선물·옵션 동시만기" if quad else "옵션 만기", "w": 2 if quad else 1})
    return out


def collect_calendar(ctx: dict) -> dict:
    from stocks import GLOBAL_UNIVERSE
    names = {}
    for s in GLOBAL_UNIVERSE.values():
        for item in s.split("|"):
            t, n = item.strip().split(" ", 1)
            names[t.replace("-", ".")] = n
    days = _calendar_range()
    events, earnings, fails = [], [], 0
    for d in days:
        try:
            j = requests.get("https://api.nasdaq.com/api/calendar/economicevents",
                             params={"date": d.isoformat()}, headers=NQ, timeout=15).json()
            for r in (j.get("data") or {}).get("rows") or []:
                for c, rx, ko, w in _RULES:
                    if r.get("country") == c and rx.search(r.get("eventName", "").strip()):
                        kst = None
                        try:
                            hh, mm = map(int, r["gmt"].split(":"))
                            et = datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET)
                            kst = et.astimezone(KST)
                        except Exception:
                            pass
                        events.append({
                            "date": d.isoformat(), "kst": kst.strftime("%m/%d %H:%M") if kst else "",
                            "country": FLAG.get(c, c), "name": ko, "en": r["eventName"].strip(), "w": w,
                            "actual": _clean(r.get("actual")), "consensus": _clean(r.get("consensus")),
                            "previous": _clean(r.get("previous"))})
                        break
        except Exception as e:
            fails += 1
            log("경제지표 실패", d, e)
        try:
            j = requests.get("https://api.nasdaq.com/api/calendar/earnings",
                             params={"date": d.isoformat()}, headers=NQ, timeout=15).json()
            for r in (j.get("data") or {}).get("rows") or []:
                sym = r.get("symbol", "")
                try:
                    cap = float(re.sub(r"[^\d.]", "", r.get("marketCap") or "") or 0)
                except Exception:
                    cap = 0
                if sym not in names and cap < EARN_MIN_CAP:
                    continue
                earnings.append({
                    "date": d.isoformat(), "ticker": sym, "name": names.get(sym) or r.get("name", sym),
                    "when": {"time-pre-market": "장전", "time-after-hours": "장후"}.get(r.get("time"), ""),
                    "cap_b": round(cap / 1e9), "eps_f": _clean(r.get("epsForecast")),
                    "eps_ly": _clean(r.get("lastYearEPS")), "quarter": r.get("fiscalQuarterEnding")})
        except Exception as e:
            fails += 1
            log("실적일정 실패", d, e)
    if fails >= len(days) * 2:
        raise RuntimeError("Nasdaq 일정 수신 실패")
    events += _option_expiries(days)
    events.sort(key=lambda x: (x["date"], x["kst"] or "99"))
    earnings.sort(key=lambda x: (x["date"], -x["cap_b"]))
    log(f"일정: 지표 {len(events)}건, 실적 {len(earnings)}건")
    return {"days": [d.isoformat() for d in days], "today": now_kst().date().isoformat(),
            "events": events, "earnings": earnings}


# ──────────────────────────────────────────────────────────────────────
# 2) 국내 공매도
# ──────────────────────────────────────────────────────────────────────
MIN_MCAP_SHORT = 3000e8


def collect_short(ctx: dict) -> dict:
    from pykrx import stock
    krx_login()
    today = now_kst()
    tv = stock.get_market_trading_value_by_date((today - timedelta(days=30)).strftime("%Y%m%d"),
                                                today.strftime("%Y%m%d"), "KOSPI")
    tv = tv[(tv.abs().sum(axis=1) > 0)]
    days = [d.strftime("%Y%m%d") for d in tv.index]
    d0 = days[-1]
    name_cache: dict[str, str] = {}

    def nm(t):
        if t not in name_cache:
            try:
                name_cache[t] = stock.get_market_ticker_name(t)
            except Exception:
                name_cache[t] = t
        return name_cache[t]

    out = {"date": f"{d0[:4]}-{d0[4:6]}-{d0[6:]}", "markets": {}}
    for mkt in ("KOSPI", "KOSDAQ"):
        cap = stock.get_market_cap(d0, market=mkt)
        mcap = cap[col(cap, "시가총액")]
        oh = stock.get_market_ohlcv_by_ticker(d0, market=mkt)
        chg = oh[col(oh, "등락률")]
        big = set(mcap[mcap >= MIN_MCAP_SHORT].index.astype(str))

        # (a) 당일 공매도 거래대금 비중
        sv = stock.get_shorting_value_by_ticker(d0, mkt)
        sv.index = sv.index.astype(str)
        c_s, c_t, c_r = col(sv, "공매도"), col(sv, "매수"), col(sv, "비중")
        total_ratio = r2(sv[c_s].sum() / sv[c_t].sum() * 100) if sv[c_t].sum() else None
        # 금액이 너무 작은 종목(5억 미만)은 비중이 튀어서 제외
        tr = sv[sv.index.isin(big) & (sv[c_s] >= 5 * EOK)].sort_values(c_r, ascending=False).head(15)
        trade = [{"ticker": t, "name": nm(t), "ratio": r2(x[c_r]), "value": r2(x[c_s] / EOK, 0),
                  "r1d": r2(chg.get(t))} for t, x in tr.iterrows()]

        # (b) 공매도 잔고 비중 및 1주 변화 (잔고는 T+2 공시)
        bal_now = bal_prev = None
        bdate = None
        for i in range(1, 6):
            if len(days) <= i:
                break
            b = stock.get_shorting_balance_by_ticker(days[-i], mkt)
            if not b.empty and b[col(b, "비중")].sum() > 0:
                bal_now, bdate = b, days[-i]
                idx = days.index(bdate)
                if idx >= 5:
                    bal_prev = stock.get_shorting_balance_by_ticker(days[idx - 5], mkt)
                break
        bal = {"date": None, "top": [], "up": [], "down": []}
        if bal_now is not None:
            bal_now.index = bal_now.index.astype(str)
            cr, cv = col(bal_now, "비중"), col(bal_now, "공매도금액")
            bn = bal_now[bal_now.index.isin(big)]
            if bal_prev is not None and not bal_prev.empty:
                bal_prev.index = bal_prev.index.astype(str)
                bn = bn.assign(d=bn[cr] - bal_prev[col(bal_prev, "비중")].reindex(bn.index))
            else:
                bn = bn.assign(d=None)

            def rows(df):
                return [{"ticker": t, "name": nm(t), "ratio": r2(x[cr]), "chg": r2(x["d"]),
                         "value": r2(x[cv] / EOK, 0), "r1d": r2(chg.get(t))} for t, x in df.iterrows()]
            bal = {"date": f"{bdate[:4]}-{bdate[4:6]}-{bdate[6:]}",
                   "top": rows(bn.sort_values(cr, ascending=False).head(15)),
                   "up": rows(bn.dropna(subset=["d"]).sort_values("d", ascending=False).head(15)),
                   "down": rows(bn.dropna(subset=["d"]).sort_values("d").head(15))}
        out["markets"][mkt] = {"total_ratio": total_ratio, "trade": trade, "balance": bal}
    return out
