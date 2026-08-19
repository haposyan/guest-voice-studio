// ============================================================================
// setup.js — first-run screen: name the one 拠点 this install serves.
// Runs once; after this, db.isConfigured is true and app.js routes past it.
// ============================================================================

import { db } from "../db.js";
import { isDesktop, nativeInfo } from "../native.js";
import { toast, escapeHtml } from "../components/ui.js";

export function mountSetup(root, onDone) {
  const wrap = document.createElement("div");
  wrap.className = "setup-screen";
  wrap.innerHTML = `
    <div class="setup-card">
      <div class="setup-steps"><div class="step done"></div><div class="step"></div></div>
      <h1 style="margin-bottom:4px">ようこそ</h1>
      <p class="muted" style="margin-bottom:20px">この端末専用の「お客様の声・改善管理」アプリです。まず、このインストールが担当する拠点名を設定してください。</p>
      <div class="field">
        <label>拠点名</label>
        <input type="text" id="storeName" placeholder="例：〇〇休暇村">
      </div>
      <div class="field">
        <label>別名（CSV内の表記ゆれ・任意、カンマ区切り）</label>
        <input type="text" id="storeAliases" placeholder="例：〇〇休暇村ホテル, 〇〇村">
      </div>
      ${isDesktop ? `<p class="hint">データの保存先: <code>${escapeHtml(nativeInfo.dataDir || "")}</code></p>` : `<p class="hint">ブラウザモードで実行中です（開発・確認用）。</p>`}
      <button class="btn primary" id="setupBtn" style="width:100%;justify-content:center;margin-top:10px">この拠点名で開始する</button>
    </div>
  `;
  root.appendChild(wrap);
  wrap.querySelector("#setupBtn").onclick = () => {
    const name = wrap.querySelector("#storeName").value.trim();
    if (!name) { toast("拠点名を入力してください", "bad"); return; }
    const aliases = wrap.querySelector("#storeAliases").value.split(",").map((a) => a.trim()).filter(Boolean);
    const stores = db.stores.map((s) => s.id === db.LOCAL_STORE_ID ? { ...s, name, aliases, configured: true } : s);
    db.stores = stores;
    db.audit("setup_complete", db.LOCAL_STORE_ID, name);
    toast(`「${name}」として設定しました`, "good");
    onDone();
  };
}
