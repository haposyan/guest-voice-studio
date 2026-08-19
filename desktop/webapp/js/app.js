// ============================================================================
// app.js — shell, router, navigation, permission gating.
//
// v2 pivot: single-store desktop app. Routing gained a first-run "setup"
// step (name the one store this install serves) ahead of the existing
// role-picker login, and every "which stores can this user see" question
// collapses to "the one local store" — allowedStoreIds() is kept as a
// function (rather than deleted) purely so screens ported from the web
// version didn't need their import lines touched.
// ============================================================================

import { db } from "./db.js";
import { mountSetup } from "./screens/setup.js";
import { mountLogin } from "./screens/login.js";
import { mountLobby } from "./screens/lobby.js";
import { mountGuestVoice } from "./screens/guestvoice.js";
import { mountCompare } from "./screens/compare.js";
import { mountActionBoard } from "./screens/actionboard.js";
import { mountImport } from "./screens/import.js";
import { mountHistory } from "./screens/history.js";
import { mountReportStudio } from "./screens/reportstudio.js";
import { mountSettings } from "./screens/settings.js";

const SCREENS = [
  { key: "lobby", en: "Lobby", ja: "ダッシュボード", mount: mountLobby, roles: ["拠点設定担当", "拠点利用者", "閲覧者"] },
  { key: "guestvoice", en: "Guest Voice", ja: "お客様の声", mount: mountGuestVoice, roles: ["拠点設定担当", "拠点利用者", "閲覧者"] },
  { key: "compare", en: "Compare", ja: "期間比較", mount: mountCompare, roles: ["拠点設定担当", "拠点利用者", "閲覧者"] },
  { key: "actionboard", en: "Action Board", ja: "改善課題", mount: mountActionBoard, roles: ["拠点設定担当", "拠点利用者", "閲覧者"] },
  { key: "import", en: "Import", ja: "CSV取込", mount: mountImport, roles: ["拠点設定担当"] },
  { key: "history", en: "History", ja: "履歴", mount: mountHistory, roles: ["拠点設定担当", "拠点利用者", "閲覧者"] },
  { key: "reportstudio", en: "Report Studio", ja: "報告書", mount: mountReportStudio, roles: ["拠点設定担当", "拠点利用者", "閲覧者"] },
  { key: "settings", en: "Settings", ja: "設定", mount: mountSettings, roles: ["拠点設定担当"] },
];

export function allowedStoreIds() {
  return [db.LOCAL_STORE_ID];
}

export function can(action) {
  const u = db.currentUser();
  if (!u) return false;
  const rules = {
    editTasks: ["拠点設定担当", "拠点利用者"],
    manageSettings: ["拠点設定担当"],
    importCsv: ["拠点設定担当"],
    createDraft: ["拠点設定担当", "拠点利用者"],
    deleteData: ["拠点設定担当"],
  };
  return (rules[action] || []).includes(u.role);
}

function currentScreenKey() {
  const hash = location.hash.replace("#", "");
  return hash || "lobby";
}

function renderShell() {
  const user = db.currentUser();
  const app = document.getElementById("app");
  const visibleScreens = SCREENS.filter((s) => s.roles.includes(user.role));
  const storeName = db.storeName(db.LOCAL_STORE_ID);
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">GV</div>
          <div>
            <div class="title">Guest Voice Studio</div>
            <div class="sub">${storeName ? storeName : "お客様の声・改善管理"}</div>
          </div>
        </div>
        <nav class="stack" style="gap:2px">
          ${visibleScreens.map((s) => `
            <button class="nav-item" data-nav="${s.key}">
              <span>
                <span class="en">${s.en}</span>
                <span class="ja">${s.ja}</span>
              </span>
            </button>
          `).join("")}
        </nav>
        <div class="sidebar-footer">
          <div class="user-chip">
            <span>👤</span>
            <span>${user.name}</span>
          </div>
          <div style="margin-top:4px"><span class="role-badge">${user.role}</span></div>
          <button class="logout-btn" id="logoutBtn">権限を切り替える</button>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div class="screen-title">
            <div class="en" id="screenEn">-</div>
            <div class="ja" id="screenJa">-</div>
          </div>
          <div class="kicker">${new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}</div>
        </div>
        <div class="content" id="content"></div>
      </div>
    </div>
  `;
  document.getElementById("logoutBtn").onclick = () => {
    db.session = null;
    render();
  };
  app.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = () => { location.hash = btn.dataset.nav; };
  });
  renderScreen();
}

function renderScreen() {
  const user = db.currentUser();
  if (!user) return;
  const key = currentScreenKey();
  const visibleScreens = SCREENS.filter((s) => s.roles.includes(user.role));
  const screen = visibleScreens.find((s) => s.key === key) || visibleScreens[0];
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === screen.key);
  });
  document.getElementById("screenEn").textContent = screen.en;
  document.getElementById("screenJa").textContent = screen.ja;
  const content = document.getElementById("content");
  content.innerHTML = "";
  screen.mount(content);
}

export function render() {
  const app = document.getElementById("app");
  if (!db.isConfigured) {
    app.innerHTML = "";
    mountSetup(app, () => render());
    return;
  }
  const session = db.session;
  if (!session) {
    app.innerHTML = "";
    mountLogin(app, () => render());
    return;
  }
  renderShell();
}

window.addEventListener("hashchange", () => {
  if (db.session) renderScreen();
});

render();
