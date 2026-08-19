// ============================================================================
// login.js — local role switch (AUTH-02). No company account, no password:
// this is a single-user desktop app; the picker exists so the same install
// can demo/preview what each local role sees (拠点設定担当 vs 拠点利用者 vs
// 閲覧者). AUTH-04: Windows/M365 sign-in is explicitly NOT required.
// ============================================================================

import { db } from "../db.js";
import { toast } from "../components/ui.js";

export function mountLogin(root, onLogin) {
  const users = db.users;
  const wrap = document.createElement("div");
  wrap.className = "login-screen";
  wrap.innerHTML = `
    <div class="login-card">
      <div class="brand-lockup">
        <div class="mark">GV</div>
        <h1 style="margin-bottom:2px">Guest Voice Studio</h1>
        <div class="muted" style="font-size:.85rem">${db.storeName(db.LOCAL_STORE_ID)}｜ローカル版</div>
      </div>
      <div class="field">
        <label>ローカル権限を選択</label>
        <select id="userSelect">
          ${users.map((u) => `<option value="${u.id}">${u.name}（${u.role}）</option>`).join("")}
        </select>
        <div class="hint">Windows／Microsoft 365のサインインは不要です。オフラインで利用できます（AUTH-04）。</div>
      </div>
      <button class="btn primary" id="loginBtn" style="width:100%;justify-content:center;margin-top:10px">この権限で開く</button>
    </div>
  `;
  root.appendChild(wrap);
  wrap.querySelector("#loginBtn").onclick = () => {
    const userId = wrap.querySelector("#userSelect").value;
    db.session = { userId, loginAt: new Date().toISOString() };
    db.audit("session_start", userId, "");
    toast(`${db.currentUser().name} として開きます`, "good");
    onLogin();
  };
}
