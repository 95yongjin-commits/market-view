"""사이트 데이터 잠금 (비밀번호 = GitHub Secret SITE_PASSWORD).

- web/data/*.json 을 비밀번호로 암호화해 web/data/enc/ 에 쓴다 (AES-GCM, 키는 PBKDF2-SHA256).
- 브라우저(assets/gate.js)가 비밀번호를 받아 같은 방식으로 풀어서 화면에 쓴다.
- 테스트 단계: 원본 data/*.json 은 그대로 두고, 잠금 버전 화면은 web/test/ 에만 만든다.
- SITE_PASSWORD 가 없으면 아무것도 하지 않는다 (기존 사이트 동작 그대로).
"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITER = 250_000
CHECK = "market-view-ok"


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _key(password: str, salt: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(password.encode("utf-8"))


def _enc(aes: AESGCM, data: bytes) -> dict:
    iv = secrets.token_bytes(12)
    return {"iv": _b64(iv), "ct": _b64(aes.encrypt(iv, data, None))}


def seal_data(data_dir: Path, password: str) -> int:
    enc_dir = data_dir / "enc"
    enc_dir.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_bytes(16)
    aes = AESGCM(_key(password, salt))
    n = 0
    for p in sorted(data_dir.glob("*.json")):
        (enc_dir / p.name).write_text(json.dumps(_enc(aes, p.read_bytes())), encoding="utf-8")
        n += 1
    (enc_dir / "_key.json").write_text(json.dumps(
        {"v": 1, "iter": ITER, "salt": _b64(salt), "check": _enc(aes, CHECK.encode())}), encoding="utf-8")
    return n


def make_test_page(web_dir: Path) -> None:
    """web/index.html → web/test/index.html (경로를 ../ 로 바꾸고 잠금 스크립트를 맨 앞에 넣는다)."""
    html = (web_dir / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'((?:src|href)=")assets/', r"\1../assets/", html)
    gate = ('<script>window.MV_SEAL = { data: "../data/" };</script>\n'
            '<script src="../assets/gate.js?v=1"></script>\n')
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n' + gate, 1)
    html = re.sub(r"<title>(.*?)</title>", r"<title>\1 (잠금 테스트)</title>", html, count=1)
    (web_dir / "test").mkdir(exist_ok=True)
    (web_dir / "test" / "index.html").write_text(html, encoding="utf-8")


def seal_site(data_dir: Path, log=print) -> None:
    pw = os.environ.get("SITE_PASSWORD", "")
    if not pw:
        log("잠금: SITE_PASSWORD 없음 → 건너뜀")
        return
    n = seal_data(data_dir, pw)
    make_test_page(data_dir.parent)
    log(f"잠금: 데이터 {n}개 암호화 → {data_dir / 'enc'}, 테스트 화면 생성")
