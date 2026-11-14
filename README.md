# 데일리 마켓뷰

국내·글로벌 시황(지수, 환율·금리·원자재, 섹터 강세, 국내 수급, 뉴스플로우)을 한 페이지로 보는 정적 사이트.

- `scripts/collect.py` — 데이터 수집 → `web/data/*.json`
- `web/` — 화면 (index.html + assets)
- `.github/workflows/update.yml` — 평일 정해진 시간에 수집 후 GitHub Pages 배포

로컬 실행: `python scripts/collect.py --out web/data` 후 `python -m http.server -d web 8765`
