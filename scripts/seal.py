"""사이트 데이터 잠금 (비밀번호 = GitHub Secret SITE_PASSWORD).

- web/data/*.json 을 비밀번호로 암호화해 web/data/enc/ 에 쓰고, 평문 파일은 지운다 (AES-GCM, 키는 PBKDF2-SHA256).
- 브라우저(assets/gate.js)가 비밀번호를 받아 같은 방식으로 풀어서 화면에 쓴다.
- 다음 갱신 때는 load_sealed() 로 직전 배포본을 풀어서 읽는다(부분 갱신·실패 대체용).
- GitHub Actions 에서 SITE_PASSWORD 가 없으면 오류로 멈춘다(평문이 배포되지 않게). 로컬에서는 건너뛴다.
"""
from __future__ import annotations

import base64
import json
import os
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


def _dec(aes: AESGCM, box: dict) -> bytes:
    return aes.decrypt(base64.b64decode(box["iv"]), base64.b64decode(box["ct"]), None)


def seal_data(data_dir: Path, password: str) -> int:
    enc_dir = data_dir / "enc"
    enc_dir.mkdir(parents=True, exist_ok=True)
    for old in enc_dir.glob("*.json"):
        old.unlink()
    salt = secrets.token_bytes(16)
    aes = AESGCM(_key(password, salt))
    n = 0
    for p in sorted(data_dir.glob("*.json")):
        (enc_dir / p.name).write_text(json.dumps(_enc(aes, p.read_bytes())), encoding="utf-8")
        p.unlink()   # 평문은 배포하지 않는다
        n += 1
    (enc_dir / "_key.json").write_text(json.dumps(
        {"v": 1, "iter": ITER, "salt": _b64(salt), "check": _enc(aes, CHECK.encode())}), encoding="utf-8")
    return n


def seal_site(data_dir: Path, log=print) -> None:
    pw = os.environ.get("SITE_PASSWORD", "")
    if not pw:
        if os.environ.get("GITHUB_ACTIONS"):
            raise RuntimeError("SITE_PASSWORD 없음 — 평문 데이터가 배포되지 않도록 중단")
        log("잠금: SITE_PASSWORD 없음 → 건너뜀(로컬)")
        return
    n = seal_data(data_dir, pw)
    log(f"잠금: 데이터 {n}개 암호화 → {data_dir / 'enc'} (평문 삭제)")


_AES: dict[str, AESGCM | None] = {}


def load_sealed(base: str, name: str, get):
    """직전 배포본 {base}/enc/{name}.json 을 지금 비밀번호로 풀어서 돌려준다. 못 풀면 None.
    get(url) 은 requests.Response 같은 객체(.ok, .json())를 돌려주는 함수."""
    pw = os.environ.get("SITE_PASSWORD", "")
    if not pw:
        return None
    if base not in _AES:
        _AES[base] = None
        r = get(f"{base}/enc/_key.json")
        if r.ok:
            k = r.json()
            aes = AESGCM(_key(pw, base64.b64decode(k["salt"])))
            try:
                _dec(aes, k["check"])   # 비밀번호가 바뀌었으면 여기서 실패
                _AES[base] = aes
            except Exception:
                pass
    aes = _AES[base]
    if aes is None:
        return None
    r = get(f"{base}/enc/{name}.json")
    if not r.ok:
        return None
    return json.loads(_dec(aes, r.json()).decode("utf-8"))
