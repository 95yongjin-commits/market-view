# Daily Market View · 기획·개발 김용진 (한화투자증권 WM지원팀) · 2026.11
"""주요 공시 (금감원 DART 오픈API, 인증키 DART_API_KEY).

- 대상: 사이트에 나오는 국내 종목(섹터별 종목·밸류체인·신기술 테마) + 시가총액 3,000억 이상
- 종류: 수주·실적·자본·주주환원·지배구조·투자·거래 관련 공시만 (제목 기준)
- 같은 날 같은 회사의 같은 공시(정정 포함)는 한 줄로 합친다
"""
from __future__ import annotations

import json
import os
import re
from datetime import timedelta

import requests

from collect import log, now_kst

MIN_CAP = 3000  # 억원
CATS = [
    ("수주", r"단일판매|공급계약"),
    ("실적", r"영업\(잠정\)실적|매출액또는손익구조|잠정실적"),
    ("자본", r"유상증자|무상증자|전환사채|신주인수권부사채|교환사채|감자"),
    ("주주환원", r"자기주식|배당"),
    ("지배구조", r"최대주주변경|합병|분할|타법인주식및출자증권|영업양수|영업양도|공개매수"),
    ("투자", r"신규시설투자|유형자산취득"),
    ("거래", r"매매거래정지|투자주의|투자경고|투자위험|관리종목|상장폐지|불성실공시법인지정"),
]
EXCL = (r"기업설명회|대규모기업집단|임원ㆍ주요주주|최대주주등소유주식|주식등의대량보유|증권발행실적|투자설명서|일괄신고"
        r"|주주명부폐쇄|미지정|결과보고서|발행결과|소송")


def _site_codes(ctx: dict) -> set[str]:
    acc: set[str] = set()

    def walk(o):
        if isinstance(o, dict):
            t = o.get("ticker")
            if isinstance(t, str) and len(t) == 6 and t.isdigit():
                acc.add(t)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    out = ctx.get("out")
    for n in ("stocks_kr", "valuechain", "themes"):
        try:
            walk(json.loads((out / f"{n}.json").read_text(encoding="utf-8")))
        except Exception:
            d = ctx["load_prev"](n) if ctx.get("load_prev") else None
            if d:
                walk(d)
    return acc


def _clean_title(t: str) -> tuple[str, list[str]]:
    flags = []
    t = re.sub(r"\s+", " ", t).strip()
    if "[기재정정]" in t or "[첨부정정]" in t:
        flags.append("정정")
    t = re.sub(r"\[[^\]]*정정\]", "", t)
    if "자율공시" in t:
        flags.append("자율")
    if "종속회사" in t or "자회사" in t:
        flags.append("자회사")
    t = re.sub(r"\((자율공시|종속회사의\s?주요경영사항|자회사의\s?주요경영사항|공정공시)\)", "", t)
    t = re.sub(r"^주요사항보고서\((.*)\)$", r"\1", t.strip())
    t = t.replace("ㆍ", "·").replace("결정", " 결정").replace("체결", " 체결").replace("  ", " ").strip()
    return t, flags


def collect_disclosures(ctx: dict) -> dict:
    key = os.environ.get("DART_API_KEY", "")
    if not key:
        raise RuntimeError("DART_API_KEY 없음")
    from scan import kr_listing
    listing = kr_listing()
    uni = _site_codes(ctx) | {c for c, v in listing.items() if v["cap"] >= MIN_CAP}
    today = now_kst().date()
    rows, p = [], 1
    while True:
        r = requests.get("https://opendart.fss.or.kr/api/list.json", timeout=20, params={
            "crtfc_key": key, "bgn_de": (today - timedelta(days=4)).strftime("%Y%m%d"), "end_de": today.strftime("%Y%m%d"),
            "page_no": p, "page_count": 100}).json()
        if r.get("status") not in ("000", "013"):
            raise RuntimeError(f"DART 오류 {r.get('status')} {r.get('message')}")
        rows += r.get("list", [])
        if p >= int(r.get("total_page", 1) or 1) or p >= 60:
            break
        p += 1
    items: dict[tuple, dict] = {}
    for x in rows:
        code = x.get("stock_code") or ""
        nm = x.get("report_nm", "")
        if code not in uni or re.search(EXCL, nm):
            continue
        cat = next((c for c, rx in CATS if re.search(rx, nm)), None)
        if not cat:
            continue
        title, flags = _clean_title(nm)
        d = f"{x['rcept_dt'][:4]}-{x['rcept_dt'][4:6]}-{x['rcept_dt'][6:]}"
        k = (d, code, title)
        it = {"date": d, "rno": x["rcept_no"], "code": code, "name": x["corp_name"], "cat": cat, "title": title,
              "flags": flags, "cap": round(listing.get(code, {}).get("cap", 0)),
              "url": f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={x['rcept_no']}"}
        old = items.get(k)
        if old:   # 같은 공시가 여러 번(정정) → 최신 것 하나, 횟수 표시
            it["n"] = old.get("n", 1) + 1
            it["flags"] = sorted(set(old["flags"]) | set(flags))
            if old["rno"] > it["rno"]:
                it.update({kk: old[kk] for kk in ("rno", "url")})
        items[k] = it
    out = sorted(items.values(), key=lambda v: v["rno"], reverse=True)
    dates = sorted({v["date"] for v in out}, reverse=True)[:3]
    out = [v for v in out if v["date"] in dates]
    log(f"공시: 원본 {len(rows)}건 → 대상 {len(out)}건 ({', '.join(dates)})")
    return {"dates": dates, "items": out, "universe": len(uni), "cats": [c for c, _ in CATS]}
