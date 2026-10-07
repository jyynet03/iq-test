// 게임랜드 공통: 닉네임 계정(비밀번호) + 랭킹
// 각 게임 페이지에서 <script type="module" src="gl.js"> 로 불러오고,
// 게임이 끝나면 window.GL.report(key, value, info) 를 호출합니다.
import { firebaseConfig } from "./firebase-config.js";

const GAMES = window.GL_GAMES || [];          // [{key,label,dir:'desc'|'asc',fmt:doc=>문자열}]
if (firebaseConfig && GAMES.length) init();

async function init() {
  const V = "10.12.2", B = `https://www.gstatic.com/firebasejs/${V}/`;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(B + "firebase-app.js"), import(B + "firebase-auth.js"), import(B + "firebase-firestore.js"),
  ]);
  const { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } = A;
  const { getFirestore, doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, serverTimestamp } = F;
  const app = initializeApp(firebaseConfig), auth = getAuth(app), db = getFirestore(app);

  let me = null, pending = null, tab = GAMES[0].key, msgText = "", msgOk = false, open = false;
  let resolveReady; const ready = new Promise(r => resolveReady = r);

  // ---------- 닉네임 → 내부용 로그인 ID (이메일은 받지 않음) ----------
  const NICK_RE = /^[0-9A-Za-z가-힣_\-]{2,12}$/;
  async function emailOf(nick) {
    const norm = nick.trim().normalize("NFC").toLowerCase();
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    return "h" + hex.slice(0, 40) + "@gameland.user";
  }
  const errText = e => ({
    "auth/email-already-in-use": "이미 사용 중인 닉네임이에요. 다른 닉네임을 써 주세요.",
    "auth/weak-password": "비밀번호는 6자 이상이어야 해요.",
    "auth/invalid-credential": "닉네임 또는 비밀번호가 틀렸어요.",
    "auth/wrong-password": "닉네임 또는 비밀번호가 틀렸어요.",
    "auth/user-not-found": "닉네임 또는 비밀번호가 틀렸어요.",
    "auth/too-many-requests": "시도가 너무 많아요. 잠시 후 다시 해 주세요.",
    "auth/operation-not-allowed": "아직 로그인 기능이 켜지지 않았어요. (관리자 설정 필요)",
    "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
  }[e && e.code] || "문제가 생겼어요. 잠시 후 다시 해 주세요.");

  async function loadNick(user) {
    try { const s = await getDoc(doc(db, "users", user.uid)); return s.exists() ? s.data().nick : null; } catch (e) { return null; }
  }
  onAuthStateChanged(auth, async u => {
    me = u ? { uid: u.uid, nick: await loadNick(u) } : null;
    resolveReady(); if (open) render();
  });

  async function register(nick, pw) {
    if (!NICK_RE.test(nick)) throw { code: "x", text: "닉네임은 2~12자, 한글·영문·숫자·_ - 만 쓸 수 있어요." };
    const c = await createUserWithEmailAndPassword(auth, await emailOf(nick), pw);
    await setDoc(doc(db, "users", c.user.uid), { nick: nick.trim(), ts: serverTimestamp() });
    me = { uid: c.user.uid, nick: nick.trim() };
  }
  async function login(nick, pw) {
    const c = await signInWithEmailAndPassword(auth, await emailOf(nick), pw);
    let n = await loadNick(c.user);
    if (!n) { n = nick.trim(); await setDoc(doc(db, "users", c.user.uid), { nick: n, ts: serverTimestamp() }); }
    me = { uid: c.user.uid, nick: n };
  }

  // ---------- 기록 저장 ----------
  async function submit(p) {
    const cfg = GAMES.find(g => g.key === p.key); if (!cfg || !me || !me.nick) return;
    const ref = doc(db, "rank_" + p.key, me.uid);
    try {
      const old = await getDoc(ref);
      if (old.exists()) {
        const ov = old.data().value;
        if (cfg.dir === "asc" ? p.value >= ov : p.value <= ov) return toast("이번 기록은 내 최고 기록이 아니에요.");
      }
      await setDoc(ref, { uid: me.uid, nick: me.nick, value: p.value, ...(p.info || {}), ts: serverTimestamp() });
      tab = p.key; toast("🏆 랭킹에 기록했어요!", true);
      if (open) render();
    } catch (e) { toast("기록 저장에 실패했어요."); }
  }

  // ---------- 화면 ----------
  const st = document.createElement("style");
  st.textContent = `
  #gl-btn{position:fixed;top:8px;right:10px;z-index:60;border:0;border-radius:20px;padding:6px 12px;font-size:14px;font-weight:800;background:#fde047;color:#3b2f00;cursor:pointer;box-shadow:0 3px 0 #a38f00}
  #gl-ov{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.65);display:none;align-items:flex-end;justify-content:center}
  #gl-ov.on{display:flex}
  #gl-p{background:#1e1e2b;color:#fff;width:100%;max-width:520px;max-height:88dvh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px 26px;font-family:-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif}
  #gl-p h2{margin:0 0 10px;font-size:20px;display:flex;justify-content:space-between;align-items:center}
  #gl-p h3{margin:16px 0 8px;font-size:15px}
  #gl-p .x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer}
  #gl-p input{width:100%;background:#12121a;color:#fff;border:2px solid #34344a;border-radius:10px;padding:11px;font-size:16px;margin-bottom:8px}
  #gl-p input:focus{outline:none;border-color:#38bdf8}
  #gl-p .row{display:flex;gap:8px} #gl-p .row button{flex:1}
  #gl-p .b{border:0;border-radius:10px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;background:#38bdf8;color:#06222e}
  #gl-p .b.alt{background:#34344a;color:#fff}
  #gl-p .hint{font-size:12px;opacity:.6;line-height:1.5;margin:6px 0}
  #gl-p .msg{font-size:14px;min-height:20px;margin:6px 0}
  #gl-p .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
  #gl-p .tab{border:2px solid #34344a;background:none;color:#fff;border-radius:16px;padding:4px 12px;font-size:13px;cursor:pointer}
  #gl-p .tab.on{border-color:#fde047;background:#3b2f00}
  #gl-p ol{list-style:none;margin:0;padding:0}
  #gl-p li{display:flex;gap:10px;align-items:center;padding:9px 10px;border-radius:10px;background:#12121a;margin-bottom:6px;font-size:14px}
  #gl-p li.me{outline:2px solid #38bdf8}
  #gl-p li .n{width:26px;text-align:center;font-weight:800}
  #gl-p li .nm{flex:1;font-weight:700;word-break:break-all}
  #gl-p li .v{opacity:.8;font-size:13px;text-align:right}
  #gl-t{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:80;background:#222;color:#fff;border-radius:20px;padding:10px 18px;font-size:14px;display:none;font-family:sans-serif;max-width:92%;text-align:center}`;
  document.head.appendChild(st);

  const btn = el("button", { id: "gl-btn" }, "🏆 랭킹");
  const ov = el("div", { id: "gl-ov" }), pn = el("div", { id: "gl-p" }), tt = el("div", { id: "gl-t" });
  ov.appendChild(pn); document.body.append(btn, ov, tt);
  btn.onclick = () => { open = true; msgText = ""; render(); };
  ov.onclick = e => { if (e.target === ov) close(); };
  const close = () => { open = false; ov.classList.remove("on"); };

  function el(tag, attrs, text) { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (text) e.textContent = text; return e; }
  let tto; function toast(t, ok) {
    tt.textContent = t; tt.style.display = "block"; tt.style.background = ok ? "#166534" : "#333";
    clearTimeout(tto); tto = setTimeout(() => tt.style.display = "none", 3200);
    if (!me) { tt.append(" "); const a = el("button", { onclick: () => { open = true; render(); } }, "로그인"); tt.append(a); }
  }

  async function render() {
    ov.classList.add("on"); pn.textContent = "";
    const h = el("h2"); h.append(el("span", {}, "🏆 랭킹 · 내 계정"), el("button", { className: "x", onclick: close }, "✕")); pn.appendChild(h);

    // 계정
    if (me && me.nick) {
      const row = el("div", { className: "row" });
      row.append(el("div", { style: "flex:2;align-self:center;font-weight:800" }, "👤 " + me.nick + " 님"),
        el("button", { className: "b alt", onclick: async () => { await signOut(auth); me = null; msgText = ""; render(); } }, "로그아웃"));
      pn.appendChild(row);
    } else {
      pn.appendChild(el("div", { className: "hint" }, "닉네임을 만들면 랭킹에 기록돼요."));
      const ni = el("input", { placeholder: "닉네임 (2~12자)", maxLength: 12, autocomplete: "username" });
      const pi = el("input", { placeholder: "비밀번호 (6자 이상)", type: "password", autocomplete: "current-password" });
      const go = async mode => {
        const nick = ni.value.trim(), pw = pi.value;
        if (!nick || !pw) { msgText = "닉네임과 비밀번호를 입력해 주세요."; msgOk = false; return render(); }
        try {
          if (mode === "reg") await register(nick, pw); else await login(nick, pw);
          msgText = mode === "reg" ? "가입 완료! 이제 기록이 랭킹에 올라가요." : "로그인했어요!"; msgOk = true;
          if (pending) { const p = pending; pending = null; await submit(p); }
        } catch (e) { msgText = e.text || errText(e); msgOk = false; }
        render();
      };
      const row = el("div", { className: "row" });
      row.append(el("button", { className: "b", onclick: () => go("login") }, "로그인"), el("button", { className: "b alt", onclick: () => go("reg") }, "새 닉네임 만들기"));
      pn.append(ni, pi, row,
        el("div", { className: "hint" }, "실명 금지 · 비밀번호 분실 시 복구 불가"));
    }
    pn.appendChild(el("div", { className: "msg", style: "color:" + (msgOk ? "#4ade80" : "#f87171") }, msgText));

    // 랭킹
    pn.appendChild(el("h3", {}, "랭킹 TOP 20"));
    if (GAMES.length > 1) {
      const tabs = el("div", { className: "tabs" });
      GAMES.forEach(g => tabs.appendChild(el("button", { className: "tab" + (g.key === tab ? " on" : ""), onclick: () => { tab = g.key; render(); } }, g.label)));
      pn.appendChild(tabs);
    }
    const cfg = GAMES.find(g => g.key === tab), list = el("ol"); list.textContent = "";
    pn.appendChild(list);
    list.appendChild(el("li", {}, "불러오는 중..."));
    try {
      const snap = await getDocs(query(collection(db, "rank_" + tab), orderBy("value", cfg.dir), limit(20)));
      list.textContent = "";
      if (snap.empty) list.appendChild(el("li", {}, "아직 기록이 없어요. 첫 번째 주인공이 되어보세요!"));
      let i = 0;
      snap.forEach(d => {
        const v = d.data(); i++;
        const li = el("li", { className: me && v.uid === me.uid ? "me" : "" });
        li.append(el("span", { className: "n" }, i <= 3 ? ["🥇", "🥈", "🥉"][i - 1] : String(i)),
          el("span", { className: "nm" }, v.nick), el("span", { className: "v" }, cfg.fmt(v)));
        list.appendChild(li);
      });
    } catch (e) { list.textContent = ""; list.appendChild(el("li", {}, "랭킹을 불러오지 못했어요.")); }
  }

  // ---------- 게임에서 호출 ----------
  window.GL = {
    async report(key, value, info) {
      await ready;
      const p = { key, value, info };
      if (me && me.nick) return submit(p);
      pending = p;
      toast("로그인하면 이 기록이 랭킹에 올라가요!");
    },
  };
}
