"""섹터별 종목 카드 데이터 (국내 WICS 중분류 / 글로벌 테마).

collect.py 에서 섹션 'stocks_kr', 'stocks_global' 로 호출된다.
"""
from __future__ import annotations

import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pandas as pd
import requests

from collect import UA, col, krx_login, log, now_kst, r2, series_stats, yf_closes

SPARK_N = 120          # 카드·확대 차트용 종가 개수
PER_SECTOR = 20        # 섹터당 최대 종목 수


def _stock_row(s: pd.Series | None) -> dict:
    st = series_stats(s, spark_n=SPARK_N) if s is not None and len(s) else None
    if not st:
        return {}
    return {k: st[k] for k in ("last", "pct", "r1w", "r1m", "r3m", "ytd", "from_hi", "spark", "date")}


def _sector_summary(name: str, stocks: list[dict]) -> dict:
    def med(k):
        v = [s[k] for s in stocks if isinstance(s.get(k), (int, float))]
        return r2(statistics.median(v)) if v else None
    return {
        "name": name, "count": len(stocks),
        "med": {"1D": med("pct"), "1W": med("r1w"), "1M": med("r1m"), "3M": med("r3m"), "YTD": med("ytd")},
        "up": sum(1 for s in stocks if (s.get("pct") or 0) > 0),
        "down": sum(1 for s in stocks if (s.get("pct") or 0) < 0),
        "stocks": stocks,
    }


# ──────────────────────────────────────────────────────────────────────
# 국내: WICS 중분류
# ──────────────────────────────────────────────────────────────────────
WICS = {
    "G1010": "에너지", "G1510": "소재", "G2010": "자본재", "G2020": "상업서비스", "G2030": "운송",
    "G2510": "자동차·부품", "G2520": "내구소비재·의류", "G2530": "호텔·레저", "G2550": "유통",
    "G2560": "교육", "G3010": "식품유통", "G3020": "음식료·담배", "G3030": "화장품·생활용품",
    "G3510": "의료기기·서비스", "G3520": "제약·바이오", "G4010": "은행", "G4020": "증권",
    "G4030": "지주·기타금융", "G4040": "보험", "G4050": "부동산", "G4510": "인터넷·소프트웨어",
    "G4520": "IT하드웨어", "G4530": "반도체", "G4535": "2차전지·전기제품", "G4540": "디스플레이",
    "G5010": "통신", "G5020": "미디어·엔터", "G5510": "유틸리티",
}
MIN_MCAP_KR = 3000e8   # 시총 3,000억 이상


def _wics_members(d0: str) -> dict[str, str]:
    """종목코드 → WICS 중분류명"""
    def one(code):
        try:
            r = requests.get("https://www.wiseindex.com/Index/GetIndexComponets",
                             params={"ceil_yn": 0, "dt": d0, "sec_cd": code}, headers=UA, timeout=15)
            return code, [x["CMP_CD"] for x in r.json().get("list", [])]
        except Exception:
            return code, []
    out = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for code, tickers in ex.map(one, WICS):
            for t in tickers:
                out.setdefault(str(t), WICS[code])
    return out


def collect_stocks_kr(ctx: dict) -> dict:
    from pykrx import stock
    krx_login()
    today = now_kst()
    tv = stock.get_market_trading_value_by_date((today - timedelta(days=14)).strftime("%Y%m%d"),
                                                today.strftime("%Y%m%d"), "KOSPI")
    tv = tv[(tv.abs().sum(axis=1) > 0)]
    d0 = tv.index[-1].strftime("%Y%m%d")

    frames = []
    for mkt in ("KOSPI", "KOSDAQ"):
        cap = stock.get_market_cap(d0, market=mkt)
        cap = cap.rename(columns={col(cap, "종가"): "close", col(cap, "시가총액"): "mcap"})[["close", "mcap"]]
        oh = stock.get_market_ohlcv_by_ticker(d0, market=mkt)
        cap["r1d"] = oh[col(oh, "등락률")].reindex(cap.index)
        fu = stock.get_market_fundamental(d0, market=mkt)
        cap["per"] = fu[col(fu, "PER")].reindex(cap.index) if not fu.empty else None
        cap["pbr"] = fu[col(fu, "PBR")].reindex(cap.index) if not fu.empty else None
        cap["market"] = mkt
        frames.append(cap)
    base = pd.concat(frames)
    base.index = base.index.astype(str)
    base = base[base["mcap"] > 0].sort_values("mcap", ascending=False)
    base["rank"] = range(1, len(base) + 1)

    wics = _wics_members(d0)
    if len(wics) < 500:
        raise RuntimeError(f"WICS 분류 수신 부족({len(wics)})")
    base["sector"] = [wics.get(t) for t in base.index]
    pick = (base[base["sector"].notna() & (base["mcap"] >= MIN_MCAP_KR)]
            .groupby("sector", group_keys=False).head(PER_SECTOR))

    names = {}
    for t in pick.index:
        try:
            names[t] = stock.get_market_ticker_name(t)
        except Exception:
            names[t] = t
    yt = {t: f"{t}.{'KS' if m == 'KOSPI' else 'KQ'}" for t, m in pick["market"].items()}
    closes = yf_closes(list(yt.values()))
    log(f"국내 종목 {len(pick)}개, 차트 {len(closes)}개 수신")

    sectors = []
    for sec, g in pick.groupby("sector"):
        rows = []
        for t, x in g.iterrows():
            st = _stock_row(closes.get(yt[t]))
            # 종가·당일 등락률은 KRX 공식값 우선
            st.update({"last": r2(x["close"], 0), "pct": r2(x["r1d"])})
            if st.get("spark"):
                st["spark"][-1] = st["last"]
            per, pbr = x.get("per"), x.get("pbr")
            rows.append({"ticker": t, "name": names[t], "market": x["market"], "rank": int(x["rank"]),
                         "mcap": r2(x["mcap"] / 1e12, 1),  # 조원
                         "per": r2(per, 1) if per and per > 0 else None,
                         "pbr": r2(pbr, 2) if pbr and pbr > 0 else None, **st})
        if len(rows) >= 3:
            sectors.append(_sector_summary(sec, rows))
    return {"date": f"{d0[:4]}-{d0[4:6]}-{d0[6:]}", "ccy": "KRW", "sectors": sectors}


# ──────────────────────────────────────────────────────────────────────
# 글로벌: 미국 상장 대형주(ADR 포함) 테마 분류
# ──────────────────────────────────────────────────────────────────────
GLOBAL_UNIVERSE = {
    "빅테크 플랫폼": "AAPL 애플|MSFT 마이크로소프트|GOOGL 알파벳|AMZN 아마존|META 메타|NFLX 넷플릭스",
    "반도체": "NVDA 엔비디아|AVGO 브로드컴|TSM TSMC|AMD AMD|ASML ASML|MU 마이크론|QCOM 퀄컴|TXN 텍사스인스트루먼트|"
             "INTC 인텔|ARM 암홀딩스|AMAT 어플라이드머티리얼즈|LRCX 램리서치|KLAC KLA|ADI 아날로그디바이스|"
             "MRVL 마벨|NXPI NXP|MCHP 마이크로칩|ON 온세미|SNPS 시놉시스|CDNS 케이던스",
    "소프트웨어·보안": "ORCL 오라클|CRM 세일즈포스|SAP SAP|ADBE 어도비|NOW 서비스나우|INTU 인튜이트|PLTR 팔란티어|"
                  "IBM IBM|PANW 팔로알토|CRWD 크라우드스트라이크|SNOW 스노우플레이크|DDOG 데이터독|FTNT 포티넷|"
                  "WDAY 워크데이|APP 앱러빈|ADSK 오토데스크|NET 클라우드플레어|SHOP 쇼피파이|UBER 우버|ZS 지스케일러",
    "AI 인프라·장비": "ANET 아리스타|DELL 델|SMCI 슈퍼마이크로|CSCO 시스코|HPE HPE|GLW 코닝|APH 암페놀|"
                   "CLS 셀레스티카|COHR 코히런트|WDC 웨스턴디지털|STX 시게이트|CIEN 시에나",
    "전력·유틸리티": "GEV GE버노바|ETN 이튼|VRT 버티브|NEE 넥스트에라|SO 서던|DUK 듀크에너지|CEG 컨스텔레이션|"
                  "VST 비스트라|AEP AEP|SRE 셈프라|D 도미니언|PWR 콴타서비스|EXC 엑셀론|XEL 엑셀에너지|NRG NRG",
    "금융": "BRK-B 버크셔해서웨이|JPM JP모건|V 비자|MA 마스터카드|BAC 뱅크오브아메리카|WFC 웰스파고|GS 골드만삭스|"
          "MS 모건스탠리|AXP 아메리칸익스프레스|C 씨티그룹|SCHW 찰스슈왑|BLK 블랙록|SPGI S&P글로벌|HSBC HSBC|"
          "RY 로열뱅크|MUFG 미쓰비시UFJ|COF 캐피탈원|PYPL 페이팔|KKR KKR|BX 블랙스톤",
    "헬스케어": "LLY 일라이릴리|UNH 유나이티드헬스|JNJ 존슨앤존슨|NVO 노보노디스크|ABBV 애브비|MRK 머크|"
              "AZN 아스트라제네카|ABT 애보트|TMO 써모피셔|ISRG 인튜이티브서지컬|AMGN 암젠|PFE 화이자|"
              "NVS 노바티스|DHR 다나허|GILD 길리어드|BSX 보스턴사이언티픽|SYK 스트라이커|VRTX 버텍스|REGN 리제네론|MDT 메드트로닉",
    "소비재·유통": "WMT 월마트|COST 코스트코|PG P&G|KO 코카콜라|PEP 펩시코|HD 홈디포|MCD 맥도날드|PM 필립모리스|"
               "NKE 나이키|SBUX 스타벅스|LOW 로우스|TJX TJX|BKNG 부킹홀딩스|CMG 치폴레|MDLZ 몬델리즈|"
               "CL 콜게이트|TGT 타깃|MAR 메리어트|ABNB 에어비앤비|ORLY 오라일리",
    "에너지": "XOM 엑슨모빌|CVX 셰브론|SHEL 쉘|TTE 토탈에너지|COP 코노코필립스|BP BP|EOG EOG|SLB SLB|"
            "OXY 옥시덴탈|PSX 필립스66|MPC 마라톤페트롤리엄|VLO 발레로|ENB 엔브리지|PBR 페트로브라스|"
            "EQNR 에퀴노르|KMI 킨더모건|WMB 윌리엄스|OKE 원오크",
    "산업재·방산": "GE GE에어로스페이스|CAT 캐터필러|RTX RTX|LMT 록히드마틴|HON 허니웰|BA 보잉|DE 디어|"
               "UNP 유니온퍼시픽|UPS UPS|NOC 노스롭그루먼|GD 제너럴다이내믹스|LHX L3해리스|MMM 3M|"
               "PH 파커하니핀|ITW 일리노이툴웍스|WM 웨이스트매니지먼트|FDX 페덱스|EMR 에머슨|TT 트레인|HWM 하우멧",
    "통신·미디어": "TMUS T모바일|VZ 버라이즌|T AT&T|DIS 디즈니|CMCSA 컴캐스트|SPOT 스포티파이|EA EA|"
               "TTWO 테이크투|RBLX 로블록스|CHTR 차터|WBD 워너브러더스",
    "자동차·모빌리티": "TSLA 테슬라|TM 토요타|RACE 페라리|GM GM|F 포드|HMC 혼다|STLA 스텔란티스|RIVN 리비안|LI 리오토|NIO 니오",
    "중국·신흥국 플랫폼": "BABA 알리바바|PDD 핀둬둬|JD 징둥|BIDU 바이두|NTES 넷이즈|TCEHY 텐센트|SE 씨리미티드|"
                     "MELI 메르카도리브레|SONY 소니|CPNG 쿠팡|GRAB 그랩|NU 누홀딩스|TCOM 트립닷컴",
    "소재": "LIN 린데|SHW 셔윈윌리엄스|FCX 프리포트맥모란|NEM 뉴몬트|APD 에어프로덕츠|ECL 에코랩|SCCO 서던코퍼|"
          "BHP BHP|RIO 리오틴토|VALE 발레|NUE 뉴코|DOW 다우|CTVA 코르테바|ALB 앨버말",
}


def _fundamentals(t: str) -> tuple[str, dict]:
    """시가총액 + 올해/내년 예상 PER (StockFlow 메가캡 로직과 동일)."""
    import yfinance as yf
    out = {"mcap": None, "pe0": None, "pe1": None}
    try:
        tk = yf.Ticker(t)
        info = tk.info or {}
        out["mcap"] = info.get("marketCap")
        price = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
        # ADR(TSMC·텐센트 등)은 주가(USD)와 EPS 통화가 달라 직접 계산하면 틀린다 → forwardPE 만 사용
        same_ccy = (info.get("financialCurrency") or info.get("currency")) == info.get("currency")
        try:
            est = tk.earnings_estimate if same_ccy else None
            if price > 0 and est is not None and not est.empty and "avg" in est.columns:
                for key, k in (("0y", "pe0"), ("+1y", "pe1")):
                    if key in est.index:
                        eps = float(est.loc[key, "avg"])
                        if eps > 0 and 0 < price / eps < 1000:
                            out[k] = round(price / eps, 1)
        except Exception:
            pass
        if out["pe1"] is None:
            f = info.get("forwardPE")
            if isinstance(f, (int, float)) and 0 < f < 1000:
                out["pe1"] = round(f, 1)
    except Exception:
        pass
    return t, out


def collect_stocks_global(ctx: dict) -> dict:
    universe = []
    for sec, s in GLOBAL_UNIVERSE.items():
        for item in s.split("|"):
            t, name = item.strip().split(" ", 1)
            universe.append((t, name, sec))
    tickers = [t for t, _, _ in universe]

    # 시총·PER 은 하루 한 번만 새로 받는다 (야후 호출량 절약)
    today = now_kst().strftime("%Y-%m-%d")
    prev = ctx.get("load_prev", lambda n: None)("stocks_global") or {}
    fund = prev.get("fund") or {}
    if prev.get("fund_date") != today or len(fund) < len(tickers) * 0.7:
        log(f"글로벌 펀더멘털 {len(tickers)}종목 수신 중…")
        new = {}
        with ThreadPoolExecutor(max_workers=6) as ex:
            for t, f in ex.map(_fundamentals, tickers):
                new[t] = f
        ok = sum(1 for f in new.values() if f["mcap"])
        log(f"시총 수신 {ok}/{len(tickers)}")
        if ok >= len(tickers) * 0.5:
            fund = {t: ({**fund.get(t, {}), **{k: v for k, v in f.items() if v is not None}}) for t, f in new.items()}
            fund_date = today
        else:
            fund_date = prev.get("fund_date")
    else:
        fund_date = prev.get("fund_date")

    closes = yf_closes(tickers)
    log(f"글로벌 차트 {len(closes)}/{len(tickers)} 수신")

    caps = sorted(((fund.get(t, {}).get("mcap") or 0, t) for t in tickers), reverse=True)
    rank = {t: i + 1 for i, (m, t) in enumerate(caps) if m}

    by_sec: dict[str, list] = {}
    for t, name, sec in universe:
        st = _stock_row(closes.get(t))
        if not st:
            continue
        f = fund.get(t, {})
        by_sec.setdefault(sec, []).append({
            "ticker": t, "name": name, "rank": rank.get(t),
            "mcap": r2((f.get("mcap") or 0) / 1e9, 0) or None,  # $bn
            "pe0": f.get("pe0"), "pe1": f.get("pe1"), **st})
    sectors = []
    for sec, rows in by_sec.items():
        rows.sort(key=lambda r: -(r["mcap"] or 0))
        sectors.append(_sector_summary(sec, rows[:PER_SECTOR]))
    any_date = next((s["stocks"][0]["date"] for s in sectors if s["stocks"]), "")
    return {"date": any_date, "ccy": "USD", "sectors": sectors, "count": len(rank),
            "fund_date": fund_date, "fund": fund}
