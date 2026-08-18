// ============================================================================
// login.js — mock authentication (AUTH-01/02/03). Production should replace
// this with Microsoft 365 / company-account SSO (AUTH-04, see README).
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
        <div class="muted" style="font-size:.85rem">お客様の声・改善管理Webアプリ（試作版）</div>
      </div>
      <div class="field">
        <label>ログインユーザーを選択（試作用の簡易認証）</label>
        <select id="userSelect">
          ${users.map((u) => `<option value="${u.id}">${u.name}（${u.role}）</option>`).join("")}
        </select>
        <div class="hint">本番運用ではMicrosoft 365／会社アカウント連携を想定（要確認事項 §11）。</div>
      </div>
      <button class="btn primary" id="loginBtn" style="width:100%;justify-content:center;margin-top:10px">ログイン</button>
    </div>
  `;
  root.appendChild(wrap);
  wrap.querySelector("#loginBtn").onclick = () => {
    const userId = wrap.querySelector("#userSelect").value;
    db.session = { userId, loginAt: new Date().toISOString() };
    db.audit("login", userId, "");
    toast(`${db.currentUser().name} としてログインしました`, "good");
    onLogin();
  };
}
