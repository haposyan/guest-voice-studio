// ============================================================================
// app.js — shell, router.
//
// v2 pivot: single-store desktop app. Routing has a first-run "setup" step
// (pick the 休暇村 this install serves) and then goes straight to the app —
// no login/role-picker screen (real-world feedback: on a single PC used by
// one small team, a role picker added confusion with no clear benefit —
// "そもそも違いが判りません"). can() and allowedStoreIds() are kept as
// functions (rather than deleted) purely so screens ported from the earlier
// multi-role/multi-store versions didn't need every call site rewritten.
// ============================================================================

import { db } from "./db.js";
import { mountSetup } from "./screens/setup.js";
import { mountLobby } from "./screens/lobby.js";
import { mountGuestVoice } from "./screens/guestvoice.js";
import { mountCompare } from "./screens/compare.js";
import { mountActionBoard } from "./screens/actionboard.js";
import { mountImport } from "./screens/import.js";
import { mountHistory } from "./screens/history.js";
import { mountReportStudio } from "./screens/reportstudio.js";
import { mountSettings } from "./screens/settings.js";

const SCREENS = [
  { key: "lobby", en: "Lobby", ja: "ダッシュボード", mount: mountLobby },
  { key: "guestvoice", en: "Guest Voice", ja: "お客様の声", mount: mountGuestVoice },
  { key: "compare", en: "Compare", ja: "期間比較", mount: mountCompare },
  { key: "actionboard", en: "Action Board", ja: "改善課題", mount: mountActionBoard },
  { key: "import", en: "Import", ja: "CSV取込", mount: mountImport },
  { key: "history", en: "History", ja: "履歴", mount: mountHistory },
  { key: "reportstudio", en: "Report Studio", ja: "報告書", mount: mountReportStudio },
  { key: "settings", en: "Settings", ja: "設定", mount: mountSettings },
];

export function allowedStoreIds() {
  return [db.LOCAL_STORE_ID];
}

// No roles anymore — every local action is allowed. Kept so screens that
// still call can("editTasks") etc. don't need touching.
export function can() {
  return true;
}

function currentScreenKey() {
  const hash = location.hash.replace("#", "");
  return hash || "lobby";
}

function renderShell() {
  const user = db.currentUser();
  const app = document.getElementById("app");
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
          ${SCREENS.map((s) => `
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
  app.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = () => { location.hash = btn.dataset.nav; };
  });
  renderScreen();
}

function renderScreen() {
  const key = currentScreenKey();
  const screen = SCREENS.find((s) => s.key === key) || SCREENS[0];
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
  renderShell();
}

window.addEventListener("hashchange", () => {
  if (db.isConfigured) renderScreen();
});

render();
