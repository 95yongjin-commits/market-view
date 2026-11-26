# 데일리 마켓뷰 — 작업 안내 (Claude용)

PB용 사내 참고 시황 사이트. GitHub Pages(web/) + GitHub Actions 자동 갱신. 서버 없음.
사용자는 집 PC와 회사 PC 양쪽에서 작업한다. 코딩을 하지 않는 사용자이므로 설명은 쉬운 말로.

## 작업 규칙 (반드시)
- 작업 시작 전 `git pull`, 끝나면 `git push`. 다른 PC에서 올린 변경이 있을 수 있다.
- 코드 수정·push 전에는 항상 사용자에게 먼저 묻는다. 사이트 문구는 사용자 허락 후 기입.
- 큰 화면 변경은 로컬 미리보기(스크린샷)로 먼저 보여주고 확인받는다.
- git 작성자는 저장소 로컬 설정 `95yongjin-commits` / `293265930+95yongjin-commits@users.noreply.github.com` (개인 메일 금지). 새 PC면 `git config user.name/user.email`을 저장소에만 설정.
- 커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## 원칙 (공개 사이트·공개 저장소)
- 비밀값(KRX_ID/KRX_PW, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, DART_API_KEY)은 GitHub Secrets와 로컬 `.env`에만. 출력·커밋 금지.
- 블룸버그·데이터가이드 등 유료 데이터 사용 금지. 신규 기능에 KRX는 가급적 쓰지 않는다.
- 타사 리포트 원문·목표주가·추정치는 옮기지 않는다. 리포트 PDF는 다운로드 정보가 찍혀 있으므로 저장소에 절대 넣지 않는다.
- 화면·코드에 회사명·소속·개인 이름을 넣지 않는다(2026-11-27 사용자 요청으로 모두 제거). 회사명이 들어간 도메인 금지.

## 구조
- `scripts/collect.py`: 섹션별 수집(SECTIONS), `--only`, `--prev`(라이브 data URL 폴백) 지원. 결과는 `web/data/*.json`.
- `scripts/scan.py`: 밸류체인·테마·차트 포착기 가격(yfinance). `scripts/disclosures.py`: DART 공시. `scripts/links.py`: 텔레그램 KIM봇(추천 링크·이슈 일정).
- `web/index.html` + `web/assets/*.js` (공용 헬퍼 `window.MV`). 정적 파일을 바꾸면 index.html의 `?v=` 번호를 올린다.
- 워크플로: `update.yml`(시세), `disclosures.yml`(공시 10:00·14:00·18:10), `links.yml`(봇 30분마다). 모두 concurrency group `pages`.

## 갱신 시각
- GitHub 자체 예약 실행은 수 시간 지연·누락이 잦다 → 정시 실행은 cron-job.org가 workflow_dispatch로 호출, GitHub cron은 예비.
- 현재 cron-job.org: 평일 06:20·07:00 update.yml (목표: 07:30까지 데이터 준비, 08시 회의용).
- 추가 예정(사용자 설정 필요): update 9·11·13시 30분 / 16:10 / 18·23시, disclosures 10·14시 / 18:10, links 30분마다.
- cron-job.org에 넣은 GitHub 토큰 만료 2027-11-24 → 만료 전 갱신 안내.

## 데이터 주의
- 국내 종가: 야후(.KS/.KQ) 일봉 종가 = KRX 15:30 종가. **네이버 closePrice는 장 마감 후 NXT(~20:00) 체결가가 반영되어 KRX 종가가 아님** — 덮어쓰지 말 것.
- 장중 갱신분은 장중 가격(약 20분 지연).

## 신기술 테마 추가 방법
1. 사용자가 바탕화면 `데일리 마켓 신기술 카테고리 리포트\<테마명>` 폴더에 리포트를 넣는다.
2. PDF 텍스트를 뽑아 읽고, 일정·수치는 웹 검색으로 최신 사실을 확인한다. 확인되지 않는 주장은 빼거나 "회사 측 발표 기준"으로 표기.
3. `scripts/themes.json`에 항목 추가(기존 테마 형식 그대로). 종목 `rel`: direct/indirect/expect/alt(대체 관계, 테마 지수에서 제외). 티커는 실제 존재 확인.
4. 로컬 미리보기(`collect.py --only themes`) → 사용자 확인 → push.
- 현재 테마: cpo, sst(전고체), glass(유리기판).
