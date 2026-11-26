# Daily Market View · 2026.11
"""텔레그램 봇으로 받은 추천 링크(유튜브·웹)를 사이트에 게시한다.

    python scripts/links.py poll     # 봇에 새로 온 메시지 처리 → store/links.json 갱신

- 요약하지 않는다. 제목·채널명·썸네일은 유튜브 oEmbed / 웹페이지 og 태그에서 가져온다.
- TELEGRAM_CHAT_ID(쉼표로 여러 명) 에 있는 사용자 메시지만 받는다. 그 외에는 무시.
- 저장소는 git 에 커밋되는 store/links.json (rev 가 클수록 최신).

봇 명령
  링크 [코멘트] [#태그 …]   게시
  /list                     최근 게시 10건 (번호 포함)
  /del [번호]               번호(없으면 가장 최근) 게시물 삭제
  일정 목록(11/18(수) + · 항목)  사이트 '국내외 이슈 일정'에 반영 (같은 날짜는 덮어씀)
  /cal                      등록된 일정 날짜 목록
  /caldel 11/18             그 날짜 일정 삭제
  /help                     사용법
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

KST = timezone(timedelta(hours=9))
ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / "store" / "links.json"
EVENTS = ROOT / "store" / "events.json"   # 사이트 '국내외 이슈 일정'
DATE_RE = re.compile(r"^\s*(\d{1,2})\s*/\s*(\d{1,2})\s*(?:\(\s*[월화수목금토일]\s*\))?\s*$")
BULLET_RE = re.compile(r"^\s*[·•\-\*▪◦ㆍ]\s*")
CAT_RULES = [   # 위에서부터 먼저 맞는 분류
    ("earn", ("실적발표", "실적 발표", "실적")),
    ("ipo", ("상장", "공모청약", "청약", "스팩")),
    ("macro", ("美)", "中)", "日)", "유럽)", "지수", "의사록", "베이지북", "GDP", "고용", "ISM", "ADP", "CPI", "PCE",
               "LPR", "연설", "옵션만기", "MSCI", "주택", "소매판매", "물가")),
    ("policy", ("정상회의", "정상회담", "법 ", "법안", "개정안", "시행", "금융통화위원회", "금통위", "총선", "선거",
                "관세", "세이프가드", "청문회", "선고", "규제", "제재")),
]
UPLOAD = ROOT / "web" / "uploads"      # 사진은 사이트 폴더에 커밋해 함께 배포한다
MAX_IMG = 8 * 1024 * 1024
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
URL_RE = re.compile(r"https?://[^\s<>\"']+")
TAG_RE = re.compile(r"#([0-9A-Za-z가-힣_·]+)")
YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})")
HELP = ("📌 링크 게시 봇\n\n"
        "• 링크를 보내면 사이트 '추천 영상·링크'에 올라갑니다.\n"
        "• 블로그·기사 등 일반 웹 링크와 사진(차트 캡처 등)도 올릴 수 있습니다.\n"
        "  사진은 설명(캡션)에 코멘트와 #태그를 적어주세요. 여러 장을 한 번에 보내면 한 게시물로 묶입니다.\n"
        "• 링크 뒤에 한 줄 코멘트와 #태그를 붙일 수 있습니다.\n"
        "  예) https://youtu.be/xxxx FOMC 전에 보기 좋음 #금리 #연준\n\n"
        "/list  최근 게시 10건\n/del 번호  삭제 (번호 없으면 가장 최근 것)\n\n"
        "📅 일정 올리기: 아래처럼 날짜 줄과 '·' 항목으로 보내면 '주요 일정 > 국내외 이슈 일정'에 반영됩니다.\n"
        "  11/18(수)\n  · 에이엘로봇 신규 상장\n  · 美) FOMC 의사록 공개\n"
        "  같은 날짜를 다시 보내면 그 날짜 일정은 새 내용으로 바뀝니다.\n"
        "/cal  등록된 일정 날짜\n/caldel 11/18  그 날짜 일정 삭제\n\n"
        "봇은 30분마다 확인하므로 반영까지 최대 30분 정도 걸립니다.")


def load_store() -> dict:
    if STORE.exists():
        return json.loads(STORE.read_text(encoding="utf-8"))
    return {"rev": 0, "offset": 0, "items": []}


def save_store(st: dict) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


def load_events() -> dict:
    if EVENTS.exists():
        return json.loads(EVENTS.read_text(encoding="utf-8"))
    return {"rev": 0, "items": []}


def save_events(ev: dict) -> None:
    ev["rev"] = ev.get("rev", 0) + 1
    EVENTS.parent.mkdir(parents=True, exist_ok=True)
    EVENTS.write_text(json.dumps(ev, ensure_ascii=False, indent=1), encoding="utf-8")


def _iso(m: int, d: int) -> str | None:
    """월/일 → 가장 가까운 연도의 날짜 (12월에 1월 일정을 보내면 다음 해)."""
    today = datetime.now(KST).date()
    best = None
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            c = today.replace(year=y, month=m, day=d)
        except ValueError:
            continue
        if best is None or abs((c - today).days) < abs((best - today).days):
            best = c
    return best.isoformat() if best else None


def cat_of(t: str) -> str:
    for c, kws in CAT_RULES:
        if any(k in t for k in kws):
            return c
    return "ind"


def parse_schedule(text: str) -> dict[str, list[dict]] | None:
    """'11/18(수)' 날짜 줄 + '· 항목' 줄 → {날짜: [{cat, text}]}. 일정 형식이 아니면 None."""
    out: dict[str, list[dict]] = {}
    cur = None
    for line in text.splitlines():
        m = DATE_RE.match(line)
        if m:
            cur = _iso(int(m.group(1)), int(m.group(2)))
            if cur:
                out.setdefault(cur, [])
            continue
        if cur is None or not line.strip() or set(line.strip()) <= set("─-=_━·•"):
            continue
        t = re.sub(r"\s+", " ", BULLET_RE.sub("", line)).strip()
        t = re.sub(r"^(美|中|日)\)\s*", r"\1 ", t)
        if t:
            out[cur].append({"date": cur, "cat": cat_of(line), "text": t})
    if not out or not any(out.values()):
        return None
    return out


def meta_of(url: str) -> dict:
    """제목·채널·썸네일. 실패해도 링크 자체는 게시한다."""
    m = YT_RE.search(url)
    if m:
        vid = m.group(1)
        d = {"kind": "youtube", "vid": vid, "url": f"https://www.youtube.com/watch?v={vid}",
             "thumb": f"https://i.ytimg.com/vi/{vid}/mqdefault.jpg", "site": "YouTube"}
        try:
            j = requests.get("https://www.youtube.com/oembed", params={"url": d["url"], "format": "json"},
                             headers=UA, timeout=15).json()
            d.update(title=j.get("title"), source=j.get("author_name"))
        except Exception:
            pass
        return d
    host = urlparse(url).netloc.removeprefix("www.")
    d = {"kind": "web", "url": url, "site": host}
    fetch = url
    if host == "blog.naver.com":        # PC 블로그는 프레임 페이지라 썸네일이 없다 → 모바일 페이지에서 읽는다
        fetch = url.replace("://blog.naver.com", "://m.blog.naver.com", 1)
        d["site"] = "네이버 블로그"
    elif host == "m.blog.naver.com":
        d["site"] = "네이버 블로그"
    try:
        r = requests.get(fetch, headers=UA, timeout=15)
        r.encoding = r.apparent_encoding if not r.encoding or r.encoding.lower() == "iso-8859-1" else r.encoding
        t = r.text[:300000]

        def og(p):
            mm = re.search(rf'<meta[^>]+(?:property|name)=["\']{p}["\'][^>]+content=["\']([^"\']+)', t, re.I) or \
                 re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{p}["\']', t, re.I)
            return html.unescape(mm.group(1)).strip() if mm else None
        title = og("og:title")
        if not title:
            mm = re.search(r"<title[^>]*>(.*?)</title>", t, re.I | re.S)
            title = html.unescape(mm.group(1)).strip() if mm else None
        d.update(title=title, source=og("og:site_name"), thumb=og("og:image"))
    except Exception:
        pass
    return d


class Bot:
    def __init__(self, token: str):
        self.base = f"https://api.telegram.org/bot{token}"

    def call(self, method: str, **params):
        for i in range(3):   # 일시적인 연결 끊김 대비
            try:
                r = requests.post(f"{self.base}/{method}", json=params, timeout=30)
                break
            except requests.RequestException:
                if i == 2:
                    raise
                time.sleep(2 * (i + 1))
        j = r.json()
        if not j.get("ok"):
            raise RuntimeError(f"telegram {method}: {j.get('description')}")
        return j["result"]

    def download(self, file_id: str) -> bytes:
        f = self.call("getFile", file_id=file_id)
        r = requests.get(f"{self.base.replace('/bot', '/file/bot', 1)}/{f['file_path']}", timeout=60)
        r.raise_for_status()
        return r.content

    def say(self, chat: int, text: str) -> None:
        try:
            self.call("sendMessage", chat_id=chat, text=text, disable_web_page_preview=True)
        except Exception as e:
            print("reply fail:", e)


def handle(bot: Bot, st: dict, msg: dict, allowed: set[int]) -> bool:
    """메시지 하나 처리. 저장소가 바뀌면 True."""
    chat, uid = msg["chat"]["id"], msg.get("from", {}).get("id")
    text = (msg.get("text") or msg.get("caption") or "").strip()
    # 텔레그램이 링크를 entity 로만 주는 경우(텍스트 링크)도 챙긴다
    ents = [e.get("url") for e in (msg.get("entities") or msg.get("caption_entities") or []) if e.get("url")]
    if uid not in allowed:
        bot.say(chat, f"게시 권한이 없는 계정입니다. (ID {uid})")
        return False
    if text.startswith("/start") or text.startswith("/help"):
        bot.say(chat, HELP)
        return False
    items = st["items"]
    if text.startswith("/list"):
        if not items:
            bot.say(chat, "게시된 링크가 없습니다.")
        else:
            bot.say(chat, "\n".join(f"{i}. {'🖼 ' if x.get('kind') == 'image' else ''}{x.get('title') or x.get('url')}"
                                    for i, x in enumerate(items[:10], 1)))
        return False
    if text.startswith("/del"):
        arg = text[4:].strip()
        n = int(arg) if arg.isdigit() else 1
        if 1 <= n <= len(items):
            x = items.pop(n - 1)
            for im in x.get("imgs", []):
                (ROOT / "web" / im).unlink(missing_ok=True)
            bot.say(chat, f"🗑 삭제했습니다: {x.get('title') or x.get('url')}\n(사이트 반영까지 몇 분 걸립니다)")
            return True
        bot.say(chat, f"{n}번 게시물이 없습니다. /list 로 번호를 확인해 주세요.")
        return False

    if text.startswith("/caldel"):
        m = re.search(r"(\d{1,2})\s*/\s*(\d{1,2})", text)
        day = _iso(int(m.group(1)), int(m.group(2))) if m else None
        ev = load_events()
        n0 = len(ev["items"])
        ev["items"] = [x for x in ev["items"] if x["date"] != day]
        if not day or len(ev["items"]) == n0:
            bot.say(chat, "삭제할 날짜를 찾지 못했습니다. 예) /caldel 11/18")
            return False
        save_events(ev)
        bot.say(chat, f"🗑 {day[5:].replace('-', '/')} 일정 {n0 - len(ev['items'])}건을 삭제했습니다.\n사이트 반영까지 몇 분 걸립니다.")
        return True
    if text.startswith("/cal"):
        ev = load_events()
        today = datetime.now(KST).date().isoformat()
        days = {}
        for x in ev["items"]:
            if x["date"] >= today:
                days[x["date"]] = days.get(x["date"], 0) + 1
        bot.say(chat, "\n".join(f"{k[5:].replace('-', '/')}  {v}건" for k, v in sorted(days.items())) or "등록된 앞으로의 일정이 없습니다.")
        return False

    # 일정 목록 (링크가 없고 날짜 줄이 있는 메시지)
    sched = None if (URL_RE.search(text) or ents or msg.get("photo")) else parse_schedule(text)
    if sched:
        ev = load_events()
        ev["items"] = [x for x in ev["items"] if x["date"] not in sched]
        ev["items"] += [it for v in sched.values() for it in v]
        ev["items"].sort(key=lambda x: x["date"])
        save_events(ev)
        n = sum(len(v) for v in sched.values())
        ks = sorted(sched)
        bot.say(chat, f"📅 일정 {len(ks)}일 · {n}건을 반영했습니다 ({ks[0][5:].replace('-', '/')} ~ {ks[-1][5:].replace('-', '/')}).\n"
                      "같은 날짜의 기존 일정은 새 내용으로 바꿨습니다. 사이트 반영까지 몇 분 걸립니다.")
        return True

    tags = list(dict.fromkeys(TAG_RE.findall(text)))
    comment = re.sub(r"\s+", " ", TAG_RE.sub("", URL_RE.sub("", text))).strip()
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")

    # 사진(압축 전송) 또는 이미지 파일(원본 전송)
    doc = msg.get("document") or {}
    photo = msg.get("photo")
    if photo or (doc.get("mime_type") or "").startswith("image/"):
        if photo:
            ph = [p for p in photo if max(p.get("width", 0), p.get("height", 0)) <= 1600] or photo[:1]
            fid, ext, size = ph[-1]["file_id"], "jpg", ph[-1].get("file_size", 0)
        else:
            fid, size = doc["file_id"], doc.get("file_size", 0)
            ext = {"image/png": "png", "image/gif": "gif", "image/webp": "webp"}.get(doc.get("mime_type"), "jpg")
        if size and size > MAX_IMG:
            bot.say(chat, "사진 용량이 8MB를 넘어 올리지 못했습니다. 일반 사진으로(압축해서) 보내주세요.")
            return False
        UPLOAD.mkdir(parents=True, exist_ok=True)
        name = f"{datetime.now(KST).strftime('%Y%m%d')}-{msg['message_id']}.{ext}"
        (UPLOAD / name).write_bytes(bot.download(fid))
        rel = f"uploads/{name}"
        grp = msg.get("media_group_id")
        same = next((x for x in items if grp and x.get("group") == grp), None)
        if same:   # 여러 장을 한 번에 보낸 경우 한 게시물로 묶는다
            same["imgs"].append(rel)
            if comment and same.get("title") == "사진":
                same["title"] = comment[:60]
                if len(comment) > 60:
                    same["comment"] = comment
            if tags:
                same["tags"] = list(dict.fromkeys(same.get("tags", []) + tags))
            bot.say(chat, f"🖼 사진 추가 ({len(same['imgs'])}장째)")
            return True
        link = (URL_RE.findall(text) + ents or [None])[0]
        d = {"kind": "image", "imgs": [rel], "url": link, "title": comment[:60] or "사진",
             "comment": comment if len(comment) > 60 else None, "tags": tags, "posted": now,
             "id": str(msg["message_id"]), "group": grp, "site": ""}
        items.insert(0, {k: v for k, v in d.items() if v not in (None, "", [])})
        bot.say(chat, "🖼 사진을 올렸습니다." + (f" ({comment[:30]})" if comment else "") + "\n사이트 반영까지 몇 분 걸립니다.")
        return True

    urls = list(dict.fromkeys(URL_RE.findall(text) + ents))
    if not urls:
        bot.say(chat, "링크나 사진을 찾지 못했습니다. 유튜브·블로그 링크나 사진을 보내주세요. (/help)")
        return False
    done = []
    for u in urls[:5]:
        d = meta_of(u)
        if any(x.get("url") == d["url"] for x in items):
            done.append(f"이미 있음: {d.get('title') or d['url']}")
            continue
        d.update(comment=comment, tags=tags, posted=now, id=f"{msg['message_id']}-{len(done)}")
        items.insert(0, {k: v for k, v in d.items() if v not in (None, "", [])})
        done.append(f"✅ {d.get('title') or d['url']}" + (f"  ({d['source']})" if d.get("source") else ""))
    bot.say(chat, "\n".join(done) + "\n\n사이트 반영까지 몇 분 걸립니다.")
    return any(s.startswith("✅") for s in done)


def poll() -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    allowed = {int(x) for x in os.environ.get("TELEGRAM_CHAT_ID", "").replace(" ", "").split(",") if x}
    if not allowed:
        # 허용 사용자 미등록: 메시지를 소비하지 않고 끝낸다(처음 등록할 때 ID 확인용으로 남겨둠)
        print("TELEGRAM_CHAT_ID 미설정 → 건너뜀")
        gh = os.environ.get("GITHUB_OUTPUT")
        if gh:
            with open(gh, "a") as f:
                f.write("changed=false\nupdates=false\n")
        return
    bot, st = Bot(token), load_store()
    ups = bot.call("getUpdates", offset=st.get("offset", 0) + 1, timeout=0,
                   allowed_updates=["message", "channel_post"])
    changed = False
    for u in ups:
        st["offset"] = max(st.get("offset", 0), u["update_id"])
        msg = u.get("message") or u.get("channel_post")
        if msg:
            try:
                changed |= handle(bot, st, msg, allowed)
            except Exception as e:
                print("handle fail:", e)
    if ups:
        if changed:
            st["rev"] = st.get("rev", 0) + 1
            st["items"] = st["items"][:300]
        save_store(st)   # offset 만 바뀐 경우도 저장(같은 메시지 재처리 방지)
    print(f"updates={len(ups)} changed={changed} items={len(st['items'])}")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\nupdates={'true' if ups else 'false'}\n")


def collect_links(ctx: dict | None = None) -> dict:
    """collect.py 섹션: 커밋된 저장소와 직전 배포본 중 최신(rev 큰 쪽)을 내보낸다."""
    st = load_store()
    prev = (ctx or {}).get("load_prev", lambda n: None)("links") or {}
    if prev.get("rev", -1) > st.get("rev", 0):
        return {"rev": prev["rev"], "items": prev.get("items", [])}
    return {"rev": st.get("rev", 0), "items": st.get("items", [])}


if __name__ == "__main__":
    if sys.argv[1:] == ["poll"]:
        poll()
    else:
        print(__doc__)
