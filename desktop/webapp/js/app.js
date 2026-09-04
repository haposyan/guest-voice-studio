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
import { isDesktop, getZoom, setZoom, stepZoom } from "./native.js";
import { applyTheme } from "./theme.js";
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

// v2.19: moved to permissions.js to break a circular import (see that
// file's header comment) — re-exported here so nothing outside this file
// needs to know it moved.
export { allowedStoreIds, can } from "./permissions.js";

function currentScreenKey() {
  const hash = location.hash.replace("#", "");
  return hash || "lobby";
}

function renderShell() {
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
    ${isDesktop ? `
    <!--
      Always-visible zoom control (－/％/＋), fixed to the viewport so it
      shows on every screen, not just the startup splash. Deliberately part
      of the web content itself (not a native WPF overlay): WebView2 is a
      windowed control and always paints on top of ordinary WPF siblings
      regardless of z-order (the "airspace" problem), so a native overlay
      only ever showed on the splash and disappeared the moment real page
      content took over. Living in the DOM here sidesteps that entirely.
    -->
    <div class="zoom-control" id="zoomControl">
      <button type="button" id="zoomOut" title="縮小">－</button>
      <button type="button" id="zoomReset" title="クリックで100%に戻す"><span id="zoomLabel">100%</span></button>
      <button type="button" id="zoomIn" title="拡大">＋</button>
    </div>
    ` : ""}
  `;
  app.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.onclick = () => { location.hash = btn.dataset.nav; };
  });
  if (isDesktop) wireZoomControl();
  renderScreen();
}

let zoomPollHandle = null;
function wireZoomControl() {
  const label = document.getElementById("zoomLabel");
  const setLabel = (factor) => { if (label) label.textContent = `${Math.round(factor * 100)}%`; };
  getZoom().then((r) => { if (r.ok) setLabel(r.factor); });
  document.getElementById("zoomOut").onclick = async () => { const r = await stepZoom(-1); if (r.ok) setLabel(r.factor); };
  document.getElementById("zoomIn").onclick = async () => { const r = await stepZoom(1); if (r.ok) setLabel(r.factor); };
  document.getElementById("zoomReset").onclick = async () => { const r = await setZoom(1.0); if (r.ok) setLabel(r.factor); };
  // Keeps the label in sync when zoom changes via Ctrl+wheel/Ctrl+ +/-
  // instead of these buttons. Cheap (one native round-trip) and only runs
  // once — renderShell() only re-runs when the whole app shell remounts.
  if (!zoomPollHandle) {
    zoomPollHandle = setInterval(async () => {
      const el = document.getElementById("zoomLabel");
      if (!el) return; // shell was replaced (e.g. reset-all) — stop touching stale DOM
      const r = await getZoom();
      if (r.ok) setLabel(r.factor);
    }, 800);
  }
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
  applyTheme(db.brand.themeColor);
  const app = document.getElementById("app");
  if (!db.isConfigured) {
    app.innerHTML = "";
    mountSetup(app, () => render());
    return;
  }
  renderShell();
}

window.addEventListener("hashchange", () => {
  // Guards a rare race where a hashchange fires before renderShell() has
  // mounted #screenEn/#screenJa yet (e.g. right after first-run setup
  // completes) — without this, renderScreen() throws on the null lookup.
  if (db.isConfigured && document.getElementById("screenEn")) renderScreen();
});

// v2.23: "CSVをドラッグ＆ドロップするとブラウザ画面に遷移する" — Import's
// own #dropzone (and Action Board's kanban columns) already call
// preventDefault() in their own dragover/drop handlers, but that only
// covers a drop that lands exactly on them. Missing by even a few pixels —
// easy to do — falls through to Chromium's *default* drag-and-drop
// handling, which navigates the whole WebView2 view to the dropped file
// (the app itself is replaced by a raw view of the file's contents). This
// window-level fallback swallows any drop that isn't already claimed by a
// more specific handler, instead of letting the browser navigate away.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

render();
