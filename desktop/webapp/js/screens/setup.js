// ============================================================================
// setup.js — first-run screen: pick the 休暇村 this install serves, from the
// official facility list (KYUKAMURA_REGIONS in db.js). Runs once; after this,
// db.isConfigured is true and app.js routes past it.
// ============================================================================

import { db, KYUKAMURA_REGIONS } from "../db.js";
import { isDesktop, nativeInfo } from "../native.js";
import { toast, escapeHtml } from "../components/ui.js";

const OTHER_VALUE = "__other__";

export function mountSetup(root, onDone) {
  const wrap = document.createElement("div");
  wrap.className = "setup-screen";
  wrap.innerHTML = `
    <div class="setup-card">
      <div class="setup-steps"><div class="step done"></div><div class="step"></div></div>
      <h1 style="margin-bottom:4px">ようこそ</h1>
      <p class="muted" style="margin-bottom:20px">この端末専用の「お客様の声・改善管理」アプリです。まず、このインストールが担当する休暇村を選んでください。</p>
      <div class="field">
        <label>休暇村を検索</label>
        <input type="text" id="hotelSearch" placeholder="施設名で絞り込み（例：那須、南紀勝浦）">
      </div>
      <div class="field">
        <label>休暇村を選択</label>
        <select id="hotelSelect" size="8" style="height:auto">
          ${KYUKAMURA_REGIONS.map((g) => `<optgroup label="${escapeHtml(g.region)}">
            ${g.hotels.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("")}
          </optgroup>`).join("")}
          <option value="${OTHER_VALUE}">その他（一覧にない・手入力する）</option>
        </select>
      </div>
      <div class="field" id="otherNameField" style="display:none">
        <label>施設名（手入力）</label>
        <input type="text" id="otherName" placeholder="例：休暇村 〇〇">
      </div>
      <div class="field">
        <label>別名（CSV内の表記ゆれ・任意、カンマ区切り）</label>
        <input type="text" id="storeAliases" placeholder="例：休暇村〇〇ホテル, 〇〇休暇村">
      </div>
      ${isDesktop ? `<p class="hint">データの保存先: <code>${escapeHtml(nativeInfo.dataDir || "")}</code>（起動時に選択済み。変更はSettings画面から）</p>` : `<p class="hint">ブラウザモードで実行中です（開発・確認用）。</p>`}
      <button class="btn primary" id="setupBtn" style="width:100%;justify-content:center;margin-top:10px">この休暇村で開始する</button>
    </div>
  `;
  root.appendChild(wrap);

  const searchInput = wrap.querySelector("#hotelSearch");
  const select = wrap.querySelector("#hotelSelect");
  const otherField = wrap.querySelector("#otherNameField");

  searchInput.oninput = () => {
    const q = searchInput.value.trim();
    select.querySelectorAll("option").forEach((opt) => {
      if (opt.value === OTHER_VALUE) return;
      opt.hidden = q.length > 0 && !opt.textContent.includes(q);
    });
    select.querySelectorAll("optgroup").forEach((g) => {
      const anyVisible = [...g.querySelectorAll("option")].some((o) => !o.hidden);
      g.hidden = !anyVisible;
    });
  };
  select.onchange = () => {
    otherField.style.display = select.value === OTHER_VALUE ? "" : "none";
  };

  wrap.querySelector("#setupBtn").onclick = () => {
    let name = select.value;
    if (!name) { toast("休暇村を選択してください", "bad"); return; }
    if (name === OTHER_VALUE) {
      name = wrap.querySelector("#otherName").value.trim();
      if (!name) { toast("施設名を入力してください", "bad"); return; }
    }
    const aliases = wrap.querySelector("#storeAliases").value.split(",").map((a) => a.trim()).filter(Boolean);
    const stores = db.stores.map((s) => s.id === db.LOCAL_STORE_ID ? { ...s, name, aliases, configured: true } : s);
    db.stores = stores;
    db.audit("setup_complete", db.LOCAL_STORE_ID, name);
    toast(`「${name}」として設定しました`, "good");
    onDone();
  };
}
