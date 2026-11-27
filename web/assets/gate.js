/* 비밀번호 잠금 — window.MV_SEAL 이 있는 화면에서만 동작한다.
 * data/*.json 요청을 가로채 data/enc/*.json(암호화본)을 받아 비밀번호로 풀어서 돌려준다.
 * 비밀번호는 이 탭(sessionStorage)에만 기억 → 탭/창을 닫으면 다시 입력. */
(function () {
  var CFG = window.MV_SEAL;
  if (!CFG || !window.crypto || !crypto.subtle) return;
  var BASE = CFG.data || "data/";
  var SKEY = "mv-pw";
  var rawFetch = window.fetch.bind(window);
  var unlock, keyReady = new Promise(function (r) { unlock = r; });

  document.documentElement.classList.add("mv-locked");
  var css = document.createElement("style");
  css.textContent =
    "html.mv-locked body{visibility:hidden}" +
    "#mvGate{visibility:visible;position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
    "background:var(--bg,#0b0c0f);color:var(--ink,#e9eaee);font-family:inherit;padding:16px}" +
    "#mvGate form{width:100%;max-width:340px;background:var(--card,#14161b);border:1px solid var(--line,#24272e);" +
    "border-radius:14px;padding:26px 22px;text-align:center}" +
    "#mvGate h2{margin:0 0 4px;font-size:19px}" +
    "#mvGate p{margin:0 0 18px;color:var(--muted,#868b96);font-size:13px}" +
    "#mvGate input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;font-size:15px;" +
    "border:1px solid var(--line-2,#343843);background:var(--bg-2,#101217);color:inherit;outline:none}" +
    "#mvGate input:focus{border-color:var(--accent,#f08a3c)}" +
    "#mvGate button{width:100%;margin-top:10px;padding:11px;border:0;border-radius:9px;font-size:15px;font-weight:600;" +
    "background:var(--accent,#f08a3c);color:#fff;cursor:pointer}" +
    "#mvGate button:disabled{opacity:.6;cursor:wait}" +
    "#mvGate .mv-err{min-height:18px;margin-top:10px;color:var(--up,#ff5b61);font-size:13px}";
  document.head.appendChild(css);

  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function derive(pw, meta) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: b64(meta.salt), iterations: meta.iter, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    });
  }
  function dec(key, box) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(box.iv) }, key, b64(box.ct))
      .then(function (buf) { return new TextDecoder().decode(buf); });
  }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { return null; } }

  // 비밀번호 검사: 맞으면 키, 틀리면 null
  function tryPw(pw, meta) {
    return derive(pw, meta).then(function (key) {
      return dec(key, meta.check).then(function () { return key; });
    }).catch(function () { return null; });
  }

  function done(key, pw) {
    ss(SKEY, pw);
    var g = document.getElementById("mvGate"); if (g) g.remove();
    document.documentElement.classList.remove("mv-locked");
    unlock(key);
  }

  function showGate(meta, msg) {
    function build() {
      var g = document.createElement("div");
      g.id = "mvGate";
      g.innerHTML = '<form autocomplete="off"><h2>마켓 브레이크</h2><p>사내 한정 자료입니다. 비밀번호를 입력하세요.</p>' +
        '<input type="password" placeholder="비밀번호" aria-label="비밀번호" autofocus>' +
        '<button type="submit">들어가기</button><div class="mv-err"></div></form>';
      document.body.appendChild(g);
      var f = g.querySelector("form"), inp = g.querySelector("input"), btn = g.querySelector("button"), err = g.querySelector(".mv-err");
      if (msg) err.textContent = msg;
      inp.focus();
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var pw = inp.value; if (!pw) return;
        btn.disabled = true; err.textContent = "";
        tryPw(pw, meta).then(function (key) {
          btn.disabled = false;
          if (key) done(key, pw);
          else { err.textContent = "비밀번호가 맞지 않습니다."; inp.select(); }
        });
      });
    }
    if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
  }

  rawFetch(BASE + "enc/_key.json?t=" + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (meta) {
    if (!meta) { showGate({ salt: "", iter: 1, check: {} }, "잠금 데이터를 불러오지 못했습니다. 잠시 후 새로고침하세요."); return; }
    var saved = ss(SKEY);
    if (!saved) return showGate(meta);
    // 같은 탭에서 이미 입력했으면 다시 묻지 않는다 (월 단위로 비밀번호가 바뀌면 다시 묻는다)
    tryPw(saved, meta).then(function (key) {
      if (key) done(key, saved);
      else { ss(SKEY, null); showGate(meta, "비밀번호가 바뀌었습니다. 새 비밀번호를 입력하세요."); }
    });
  }).catch(function () { showGate({ salt: "", iter: 1, check: {} }, "잠금 데이터를 불러오지 못했습니다."); });

  // data/<이름>.json 요청 → 잠금 해제 후 enc/<이름>.json 을 풀어서 돌려준다
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var m = url.match(/(?:^|\/)data\/([A-Za-z0-9_-]+)\.json(\?[^#]*)?/);
    if (!m || url.indexOf("/enc/") >= 0) return rawFetch(input, init);
    return keyReady.then(function (key) {
      return rawFetch(BASE + "enc/" + m[1] + ".json" + (m[2] || ""), init).then(function (r) {
        if (!r.ok) return new Response("", { status: r.status });
        return r.json().then(function (box) { return dec(key, box); }).then(function (txt) {
          return new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } });
        });
      });
    });
  };
})();
