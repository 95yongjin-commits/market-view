"""텔레그램 봇으로 받은 추천 링크(유튜브·웹)를 사이트에 게시한다.

    python scripts/links.py poll     # 봇에 새로 온 메시지 처리 → store/links.json 갱신

- 요약하지 않는다. 제목·채널명·썸네일은 유튜브 oEmbed / 웹페이지 og 태그에서 가져온다.
- TELEGRAM_CHAT_ID(쉼표로 여러 명) 에 있는 사용자 메시지만 받는다. 그 외에는 무시.
- 저장소는 git 에 커밋되는 store/links.json (rev 가 클수록 최신).

봇 명령
  링크 [코멘트] [#태그 …]   게시
  /list                     최근 게시 10건 (번호 포함)
  /del [번호]               번호(없으면 가장 최근) 게시물 삭제
  /help                     사용법
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

KST = timezone(timedelta(hours=9))
STORE = Path(__file__).resolve().parent.parent / "store" / "links.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
URL_RE = re.compile(r"https?://[^\s<>\"']+")
TAG_RE = re.compile(r"#([0-9A-Za-z가-힣_·]+)")
YT_RE = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([\w-]{11})")
HELP = ("📌 링크 게시 봇\n\n"
        "• 링크를 보내면 사이트 '추천 영상·링크'에 올라갑니다.\n"
        "• 링크 뒤에 한 줄 코멘트와 #태그를 붙일 수 있습니다.\n"
        "  예) https://youtu.be/xxxx FOMC 전에 보기 좋음 #금리 #연준\n\n"
        "/list  최근 게시 10건\n/del 번호  삭제 (번호 없으면 가장 최근 것)\n\n"
        "봇은 30분마다 확인하므로 반영까지 최대 30분 정도 걸립니다.")


def load_store() -> dict:
    if STORE.exists():
        return json.loads(STORE.read_text(encoding="utf-8"))
    return {"rev": 0, "offset": 0, "items": []}


def save_store(st: dict) -> None:
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


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
    d = {"kind": "web", "url": url, "site": urlparse(url).netloc.removeprefix("www.")}
    try:
        r = requests.get(url, headers=UA, timeout=15)
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
        r = requests.post(f"{self.base}/{method}", json=params, timeout=30)
        j = r.json()
        if not j.get("ok"):
            raise RuntimeError(f"telegram {method}: {j.get('description')}")
        return j["result"]

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
            bot.say(chat, "\n".join(f"{i}. {x.get('title') or x['url']}" for i, x in enumerate(items[:10], 1)))
        return False
    if text.startswith("/del"):
        arg = text[4:].strip()
        n = int(arg) if arg.isdigit() else 1
        if 1 <= n <= len(items):
            x = items.pop(n - 1)
            bot.say(chat, f"🗑 삭제했습니다: {x.get('title') or x['url']}\n(사이트 반영까지 몇 분 걸립니다)")
            return True
        bot.say(chat, f"{n}번 게시물이 없습니다. /list 로 번호를 확인해 주세요.")
        return False

    urls = list(dict.fromkeys(URL_RE.findall(text) + ents))
    if not urls:
        bot.say(chat, "링크를 찾지 못했습니다. 유튜브나 웹 링크를 보내주세요. (/help)")
        return False
    tags = list(dict.fromkeys(TAG_RE.findall(text)))
    comment = TAG_RE.sub("", URL_RE.sub("", text))
    comment = re.sub(r"\s+", " ", comment).strip()
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
    done = []
    for u in urls[:5]:
        d = meta_of(u)
        if any(x["url"] == d["url"] for x in items):
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
