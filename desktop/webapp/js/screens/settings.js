// ============================================================================
// settings.js — "Settings｜設定": store info, item mapping, excluded words,
// local roles, report recipients, brand/storage, encrypted backup
// (§4.2 MAP, §4.10 MAIL-01, §7 機密性/監査/保存先/バックアップ,
// §11 要確認事項 defaults).
// v2: single-store app — the old 35-store list is now one "拠点情報" card;
// role/recipient tables dropped their per-store multi-select (nothing to
// pick — there's only the local store).
// ============================================================================

import { db, DATA_RETENTION_DAYS } from "../db.js";
import { escapeHtml, toast, confirmDialog, openModal, closeModal } from "../components/ui.js";
import { isDesktop, nativeInfo, revealInExplorerToast, pickSaveFile, pickOpenFile, pickFolder, writeFileBytes, readFileBytes, textToBase64, downloadBlob, requestUninstall, requestRelocateData, joinPath, openPath, saveBlobToPath } from "../native.js";
import { encryptBackup, decryptBackup } from "../backup.js";

// 除外語タブは初期値では非表示（v2.6）：使う場面を想像しにくい、という
// フィードバックのため。ブランド・保存設定のトグルで表示・非表示を
// 切り替えられる（v2.7）。renderWords() 自体は常に残っており、非表示中も
// 機能自体は失われない。
const BASE_TABS = [
  { key: "store", label: "基本情報" },
  { key: "items", label: "項目マッピング" },
  { key: "backup", label: "バックアップ" },
  { key: "brand", label: "ブランド・保存設定" },
];
function visibleTabs() {
  if (!db.brand.showExcludedWordsTab) return BASE_TABS;
  return [BASE_TABS[0], BASE_TABS[1], { key: "words", label: "除外語" }, ...BASE_TABS.slice(2)];
}
let activeTab = "store";

export function mountSettings(root) {
  activeTab = "store";
  render(root);
}

function render(root) {
  const tabs = visibleTabs();
  if (!tabs.some((t) => t.key === activeTab)) activeTab = "store"; // タブがオフになった直後の保険
  root.innerHTML = `
    <div class="row" style="align-items:flex-start;gap:20px">
      <div class="card" style="width:200px;flex:0 0 200px">
        <div class="settings-nav">
          ${tabs.map((t) => `<button data-tab="${t.key}" class="${activeTab === t.key ? "active" : ""}">${t.label}</button>`).join("")}
        </div>
      </div>
      <div style="flex:1" id="panel"></div>
    </div>
  `;
  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { activeTab = b.dataset.tab; render(root); });
  const panel = root.querySelector("#panel");
  ({ store: renderStore, items: renderItems, words: renderWords, backup: renderBackup, brand: renderBrand })[activeTab](panel, root);
}

// ---------------------------------------------------------------------------
function renderStore(panel, root) {
  const s = db.localStore;
  const authors = db.brand.reportAuthors || [];
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>基本情報</h3></div>
      <p class="hint">このインストールが担当する村は1つだけです（本部/他拠点機能はv2で廃止）。</p>
      <div class="field"><label>村名</label><input type="text" id="sName" value="${escapeHtml(s.name)}"></div>
      <button class="btn small primary" id="saveStore">保存</button>
    </div>
    <div class="card">
      <div class="card-title"><h3>報告者</h3></div>
      <p class="hint">Report Studioの「報告者」プルダウンに表示される候補です。複数名登録できます。</p>
      <div class="tag-list" id="authorList">
        ${authors.map((a) => `<span class="chip">${escapeHtml(a)} <button data-rm-author="${escapeHtml(a)}">&times;</button></span>`).join("") || `<span class="hint">未登録（現在の利用者名のみ選択できます）</span>`}
      </div>
      <div class="field-row" style="margin-top:10px">
        <div class="field"><input type="text" id="newAuthor" placeholder="報告者名を入力"></div>
        <button class="btn small" id="addAuthor">追加</button>
      </div>
    </div>
  `;
  panel.querySelector("#saveStore").onclick = () => {
    const name = panel.querySelector("#sName").value.trim();
    if (!name) { toast("村名を入力してください", "bad"); return; }
    db.stores = db.stores.map((st) => st.id === db.LOCAL_STORE_ID ? { ...st, name } : st);
    db.audit("settings_store_update", db.LOCAL_STORE_ID, name);
    toast("保存しました", "good");
    render(root);
  };
  panel.querySelectorAll("[data-rm-author]").forEach((b) => b.onclick = () => {
    db.brand = { ...db.brand, reportAuthors: (db.brand.reportAuthors || []).filter((a) => a !== b.dataset.rmAuthor) };
    render(root);
  });
  panel.querySelector("#addAuthor").onclick = () => {
    const v = panel.querySelector("#newAuthor").value.trim();
    if (!v) return;
    const list = db.brand.reportAuthors || [];
    if (!list.includes(v)) db.brand = { ...db.brand, reportAuthors: [...list, v] };
    render(root);
  };
}

// ---------------------------------------------------------------------------
function renderItems(panel, root) {
  const allItems = db.itemMappings;
  const items = allItems.filter((i) => i.enabled);
  const hiddenCount = allItems.length - items.length;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>項目マッピング（${items.length}項目）</h3><button class="btn small primary" id="addItem">＋ 項目を追加</button></div>
      <p class="hint">評価列・コメント列の組をここで定義します。CSVの列名を変更しても、ここを更新するだけで対応できます（アプリ改修不要／MAP-01,02）。</p>
      ${hiddenCount ? `<p class="hint">無効化した項目が${hiddenCount}件あります（このリストには表示されません）。</p>` : ""}
      <div class="table-wrap"><table><thead><tr><th>項目名</th><th>カテゴリー</th><th>評価列名</th><th>コメント列名</th><th>有効</th><th></th></tr></thead><tbody>
        ${items.map((i) => `<tr>
          <td><input type="text" data-f="name" data-id="${i.id}" value="${escapeHtml(i.name)}"></td>
          <td><input type="text" data-f="category" data-id="${i.id}" value="${escapeHtml(i.category)}"></td>
          <td><input type="text" data-f="ratingCol" data-id="${i.id}" value="${escapeHtml(i.ratingCol)}"></td>
          <td><input type="text" data-f="commentCol" data-id="${i.id}" value="${escapeHtml(i.commentCol)}"></td>
          <td><input type="checkbox" data-f="enabled" data-id="${i.id}" ${i.enabled ? "checked" : ""}></td>
          <td><button class="btn small" data-save="${i.id}">保存</button> <button class="btn small danger" data-del="${i.id}">削除</button></td>
        </tr>`).join("")}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-title"><h3>評価帯の定義</h3></div>
      <div class="field-row">
        <div class="field"><label>低評価</label><input type="text" id="bandLow" value="${db.ratingBands.low.join(",")}"></div>
        <div class="field"><label>中立</label><input type="text" id="bandMid" value="${db.ratingBands.mid.join(",")}"></div>
        <div class="field"><label>高評価</label><input type="text" id="bandHigh" value="${db.ratingBands.high.join(",")}"></div>
      </div>
      <button class="btn small primary" id="saveBands">保存</button>
    </div>
  `;
  panel.querySelectorAll("[data-save]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.save;
      const get = (f) => panel.querySelector(`[data-f="${f}"][data-id="${id}"]`);
      const list = db.itemMappings.map((i) => i.id === id ? {
        ...i,
        name: get("name").value.trim(),
        category: get("category").value.trim(),
        ratingCol: get("ratingCol").value.trim(),
        commentCol: get("commentCol").value.trim(),
        enabled: get("enabled").checked,
      } : i);
      db.itemMappings = list;
      db.audit("settings_item_update", id, "");
      toast("保存しました", "good");
      // 「有効」チェックを外した項目はこの一覧から消えるべきなので再描画する
      // （以前は再描画していなかったため、無効化しても一覧に残って見えた）。
      render(root);
    };
  });
  panel.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = () => confirmDialog("この項目マッピングを削除しますか？既存の集計済みデータには影響しません。", () => {
      db.itemMappings = db.itemMappings.filter((i) => i.id !== btn.dataset.del);
      db.audit("settings_item_delete", btn.dataset.del, "");
      render(root);
    }, { danger: true, okLabel: "削除する" });
  });
  panel.querySelector("#addItem").onclick = () => {
    const list = db.itemMappings;
    const id = db.uid("it");
    list.push({ id, name: "新規項目", category: "", ratingCol: "評価", commentCol: "コメント", enabled: true, favorite: false, sortOrder: list.length });
    db.itemMappings = list;
    db.audit("settings_item_create", id, "");
    render(root);
  };
  panel.querySelector("#saveBands").onclick = () => {
    const parseList = (v) => v.split(",").map((n) => Number(n.trim())).filter((n) => !isNaN(n));
    db.ratingBands = { low: parseList(panel.querySelector("#bandLow").value), mid: parseList(panel.querySelector("#bandMid").value), high: parseList(panel.querySelector("#bandHigh").value) };
    db.audit("settings_bands_update", "ratingBands", "");
    toast("評価帯を保存しました", "good");
  };
}

// ---------------------------------------------------------------------------
function renderWords(panel, root) {
  const ew = db.excludedWords;
  const items = db.itemMappings;
  const storeId = db.LOCAL_STORE_ID;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>共通除外語</h3></div>
      <div class="tag-list" id="commonWords">
        ${ew.common.map((w) => `<span class="chip">${escapeHtml(w)} <button data-rm-common="${escapeHtml(w)}">&times;</button></span>`).join("")}
      </div>
      <div class="field-row" style="margin-top:10px">
        <div class="field"><input type="text" id="newCommon" placeholder="除外語を入力"></div>
        <button class="btn small" id="addCommon">追加</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><h3>拠点除外語</h3></div>
      <div class="tag-list" id="storeWords"></div>
      <div class="field-row" style="margin-top:10px"><div class="field"><input type="text" id="newStoreWord" placeholder="除外語を入力"></div><button class="btn small" id="addStoreWord">追加</button></div>
    </div>
    <div class="card">
      <div class="card-title"><h3>項目別除外語</h3></div>
      <div class="field-row">
        <div class="field"><label>項目</label><select id="itemSelForWords">${items.map((i) => `<option value="${i.id}">${escapeHtml(i.name)}</option>`).join("")}</select></div>
      </div>
      <div class="tag-list" id="itemWords"></div>
      <div class="field-row" style="margin-top:10px"><div class="field"><input type="text" id="newItemWord" placeholder="除外語を入力"></div><button class="btn small" id="addItemWord">追加</button></div>
    </div>
  `;
  panel.querySelectorAll("[data-rm-common]").forEach((b) => b.onclick = () => {
    const ew2 = db.excludedWords; ew2.common = ew2.common.filter((w) => w !== b.dataset.rmCommon); db.excludedWords = ew2; render(root);
  });
  panel.querySelector("#addCommon").onclick = () => {
    const v = panel.querySelector("#newCommon").value.trim(); if (!v) return;
    const ew2 = db.excludedWords; if (!ew2.common.includes(v)) ew2.common.push(v); db.excludedWords = ew2; render(root);
  };

  function renderStoreWords() {
    const list = db.excludedWords.byStore?.[storeId] || [];
    panel.querySelector("#storeWords").innerHTML = list.map((w) => `<span class="chip">${escapeHtml(w)} <button data-rm-store="${escapeHtml(w)}">&times;</button></span>`).join("") || `<span class="hint">なし</span>`;
    panel.querySelectorAll("[data-rm-store]").forEach((b) => b.onclick = () => {
      const ew2 = db.excludedWords; ew2.byStore[storeId] = (ew2.byStore[storeId]||[]).filter((w) => w !== b.dataset.rmStore); db.excludedWords = ew2; renderStoreWords();
    });
  }
  panel.querySelector("#addStoreWord").onclick = () => {
    const v = panel.querySelector("#newStoreWord").value.trim(); if (!v) return;
    const ew2 = db.excludedWords; ew2.byStore = ew2.byStore || {}; ew2.byStore[storeId] = ew2.byStore[storeId] || [];
    if (!ew2.byStore[storeId].includes(v)) ew2.byStore[storeId].push(v);
    db.excludedWords = ew2; panel.querySelector("#newStoreWord").value = ""; renderStoreWords();
  };
  renderStoreWords();

  function renderItemWords() {
    const iid = panel.querySelector("#itemSelForWords").value;
    const list = db.excludedWords.byItem?.[iid] || [];
    panel.querySelector("#itemWords").innerHTML = list.map((w) => `<span class="chip">${escapeHtml(w)} <button data-rm-item="${escapeHtml(w)}">&times;</button></span>`).join("") || `<span class="hint">なし</span>`;
    panel.querySelectorAll("[data-rm-item]").forEach((b) => b.onclick = () => {
      const ew2 = db.excludedWords; ew2.byItem[iid] = (ew2.byItem[iid]||[]).filter((w) => w !== b.dataset.rmItem); db.excludedWords = ew2; renderItemWords();
    });
  }
  panel.querySelector("#itemSelForWords").onchange = renderItemWords;
  panel.querySelector("#addItemWord").onclick = () => {
    const iid = panel.querySelector("#itemSelForWords").value;
    const v = panel.querySelector("#newItemWord").value.trim(); if (!v) return;
    const ew2 = db.excludedWords; ew2.byItem = ew2.byItem || {}; ew2.byItem[iid] = ew2.byItem[iid] || [];
    if (!ew2.byItem[iid].includes(v)) ew2.byItem[iid].push(v);
    db.excludedWords = ew2; panel.querySelector("#newItemWord").value = ""; renderItemWords();
  };
  renderItemWords();
}

// ---------------------------------------------------------------------------
// 報告先タブは廃止（v2.2）：Report StudioのOutlook送信は宛先を空欄のまま
// 既定メールソフトを開く方式に変更したため、宛先の事前登録・テンプレート
// 管理は不要になった。db.recipients のデータ自体は互換のため残してある。
// ---------------------------------------------------------------------------
function renderBackup(panel) {
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>バックアップを作成</h3></div>
      <p class="hint">全データ（回答・改善課題・設定など）をパスフレーズで暗号化した1ファイルに書き出します。別PCへ移す場合はこのファイルを使ってください（§7 バックアップ）。</p>
      ${isDesktop ? `<div class="path-box" style="margin-bottom:10px"><span>既定の保存候補フォルダ: ${escapeHtml(nativeInfo.backupsDir || "")}</span><span class="spacer"></span><button class="btn small" id="openBackupsDir">エクスプローラーで開く</button></div>` : ""}
      <div class="field">
        <label>パスフレーズ</label><input type="password" id="bkPass1" placeholder="8文字以上">
        <p class="hint" style="margin-top:4px">※<strong>8文字以上</strong>で設定してください（上限なし）。8文字未満は作成できません。</p>
      </div>
      <div class="field">
        <label>パスフレーズ（確認）</label><input type="password" id="bkPass2">
        <p class="hint" style="margin-top:4px">※上と同じパスフレーズをもう一度入力してください。</p>
      </div>
      <button class="btn primary" id="bkExport">バックアップを作成</button>
      <div id="bkExportResult"></div>
    </div>
    <div class="card">
      <div class="card-title"><h3>バックアップから復元</h3></div>
      <p class="hint">⚠ 復元すると、現在この端末にあるデータは上書きされます。</p>
      <div class="field"><label>バックアップファイル</label>
        <div class="row" style="gap:8px">
          <input type="text" id="bkFilePath" readonly placeholder="ファイルが選択されていません" style="flex:1">
          <button class="btn small" id="bkPickFile">${isDesktop ? "ファイルを選択" : "ファイルを開く"}</button>
        </div>
        ${!isDesktop ? `<input type="file" id="bkFileInput" accept=".gvsbackup,.json" style="margin-top:6px">` : ""}
      </div>
      <div class="field">
        <label>パスフレーズ</label><input type="password" id="bkRestorePass">
        <p class="hint" style="margin-top:4px">※作成時に設定した<strong>8文字以上</strong>のパスフレーズをそのまま入力してください。</p>
      </div>
      <button class="btn danger" id="bkImport">復元する</button>
    </div>
  `;
  const openBackupsDirBtn = panel.querySelector("#openBackupsDir");
  if (openBackupsDirBtn) openBackupsDirBtn.onclick = () => revealInExplorerToast(nativeInfo.backupsDir);

  let restoreFileText = null;

  panel.querySelector("#bkExport").onclick = async () => {
    const p1 = panel.querySelector("#bkPass1").value;
    const p2 = panel.querySelector("#bkPass2").value;
    if (p1.length < 8) { toast("パスフレーズは8文字以上にしてください", "bad"); return; }
    if (p1 !== p2) { toast("パスフレーズが一致しません", "bad"); return; }
    const state = db.exportState();
    const envelopeText = await encryptBackup(state, p1);
    const suggested = `guestvoicestudio_backup_${new Date().toISOString().slice(0,10)}.gvsbackup`;

    if (isDesktop) {
      const picked = await pickSaveFile(suggested, "Guest Voice Studio バックアップ (*.gvsbackup)|*.gvsbackup", nativeInfo.backupsDir);
      if (!picked.ok) return;
      const result = await writeFileBytes(picked.path, textToBase64(envelopeText));
      if (result.ok) toast(`バックアップを保存しました: ${picked.path}`, "good");
      else toast("保存に失敗しました: " + (result.error||""), "bad");
    } else {
      downloadBlob(suggested, new Blob([envelopeText], { type: "application/json" }));
      toast("バックアップをダウンロードしました", "good");
    }
    db.audit("backup_export", "all", "");
  };

  panel.querySelector("#bkPickFile").onclick = async () => {
    if (isDesktop) {
      const picked = await pickOpenFile("Guest Voice Studio バックアップ (*.gvsbackup;*.json)|*.gvsbackup;*.json");
      if (!picked.ok) return;
      const result = await readFileBytes(picked.path);
      if (!result.ok) { toast("読み込みに失敗しました", "bad"); return; }
      restoreFileText = new TextDecoder().decode(Uint8Array.from(atob(result.base64), (c) => c.charCodeAt(0)));
      panel.querySelector("#bkFilePath").value = picked.path;
    } else {
      panel.querySelector("#bkFileInput").click();
    }
  };
  const fileInput = panel.querySelector("#bkFileInput");
  if (fileInput) {
    fileInput.onchange = async () => {
      const f = fileInput.files[0];
      if (!f) return;
      restoreFileText = await f.text();
      panel.querySelector("#bkFilePath").value = f.name;
    };
  }

  panel.querySelector("#bkImport").onclick = () => {
    const pass = panel.querySelector("#bkRestorePass").value;
    if (!restoreFileText) { toast("バックアップファイルを選択してください", "bad"); return; }
    if (!pass) { toast("パスフレーズを入力してください", "bad"); return; }
    confirmDialog("現在のデータを上書きしてバックアップから復元します。よろしいですか？", async () => {
      try {
        const state = await decryptBackup(restoreFileText, pass);
        db.importState(state);
        db.audit("backup_restore", "all", "");
        toast("復元しました。再読み込みします…", "good");
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        toast(err.message || "復元に失敗しました", "bad");
      }
    }, { danger: true, okLabel: "復元する" });
  };
}

// ---------------------------------------------------------------------------
const BRAND_COMPANY_DEFAULT = "一般財団法人休暇村協会";
let brandCompanyUnlocked = false;

function renderBrand(panel, root) {
  const brand = db.brand;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>ブランド情報（報告書に反映）</h3></div>
      <div class="field">
        <label>会社名</label>
        <div class="row" style="gap:8px">
          <input type="text" id="bCompany" value="${escapeHtml(brand.company || BRAND_COMPANY_DEFAULT)}" style="flex:1" ${brandCompanyUnlocked ? "" : "disabled"}>
          ${brandCompanyUnlocked ? "" : `<button class="btn small" id="unlockCompany">編集する</button>`}
        </div>
        <p class="hint">通常は編集不要です。変更すると報告書の見出しに反映されます。</p>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><h3>改善課題の効果確認機能</h3></div>
      <div class="field checkbox-row"><input type="checkbox" id="bShowEffect" ${brand.showEffectConfirm ? "checked" : ""}><label style="margin:0">Action Boardに「効果確認」タブ・「効果確認済み」ステータスを表示する</label></div>
      <p class="hint">初期値は非表示です。対応前後の効果測定を実際に使う場合のみオンにしてください。</p>
    </div>
    <div class="card">
      <div class="card-title"><h3>除外語タブの表示</h3></div>
      <div class="field checkbox-row"><input type="checkbox" id="bShowWordsTab" ${brand.showExcludedWordsTab ? "checked" : ""}><label style="margin:0">Settingsに「除外語」タブを表示する（ワードクラウードの集計から除く単語の管理）</label></div>
      <p class="hint">初期値は非表示です。機能自体は非表示中も残っており、オンにすればいつでも設定できます。</p>
    </div>
    <div class="card">
      <div class="card-title"><h3>データ保存・取込設定</h3></div>
      <div class="field"><label>データ保存期間</label><div>${DATA_RETENTION_DAYS}日（5年間・うるう年考慮／編集不可）</div></div>
      <p class="hint">CSV原本は取込後に破棄され、保存されません。</p>
    </div>
    <div class="card">
      <div class="card-title"><h3>保存先</h3></div>
      ${isDesktop ? `
        <p class="hint" style="margin-bottom:8px">初回起動時に選んだ場所に保存されています（管理者権限は不要／§7 保存先）。</p>
        <div class="path-box"><span>${escapeHtml(nativeInfo.dataDir || "")}</span><span class="spacer"></span>
          <button class="btn small" id="openDataDir">エクスプローラーで開く</button>
          <button class="btn small primary" id="relocateDataDir" style="margin-left:6px">保存先を変更…</button>
        </div>
        <p class="hint" style="margin-top:8px">「保存先を変更」でDドライブなど別のフォルダを選ぶと、データを新しい場所へ移動したうえでアプリが自動的に再起動します（PC入れ替え時にDドライブだけ持って行きたい、というご要望への対応です）。移動中はアプリを閉じたままにしてください。</p>
      ` : `<p class="hint">ブラウザモードで実行中のため、ブラウザのlocalStorageに保存されています（開発・確認用）。</p>`}
    </div>
    ${isDesktop ? `
    <div class="card">
      <div class="card-title"><h3>PDF・Wordの書き出し先フォルダ</h3></div>
      <p class="hint" style="margin-bottom:8px">Report Studioの「PDFとして保存」と、下の「このツールについて」からの仕様書ダウンロードは、保存の都度ダイアログで場所を尋ねず、ここで指定したフォルダへ直接保存されます（未指定の場合はReportsフォルダに保存されます）。保存後は自動でエクスプローラーが開き、ファイルが選択された状態で表示されます。</p>
      <div class="field">
        <label>書き出し先フォルダ</label>
        <div class="row" style="gap:8px">
          <input type="text" id="bExportDir" value="${escapeHtml(brand.exportDir || "")}" placeholder="${escapeHtml(nativeInfo.reportsDir || "")}（未指定時の既定値）" style="flex:1">
          <button class="btn small" id="openExportDir">エクスプローラーで開く</button>
          <button class="btn small primary" id="pickExportDir" style="margin-left:6px">フォルダを選択…</button>
        </div>
        <p class="hint">「フォルダを選択…」で選択ダイアログが開かない場合は、上の欄に直接パスを貼り付けて「保存」してください。</p>
      </div>
    </div>
    ` : ""}
    <div class="card">
      <div class="card-title"><h3>個人情報の保護</h3></div>
      <p class="hint">CSVに含まれるメールアドレス・氏名・電話番号などの列は自動検出し、取り込みません（値を保存しません／§7 個人情報）。</p>
    </div>
    <div class="card">
      <div class="card-title" id="aboutCardTitle" style="cursor:pointer" title="クリックで詳細（バージョン・製作情報・仕様書）を表示">
        <h3>このツールについて <span class="muted" style="font-size:.7rem;font-weight:400">▸ クリックで詳細を表示</span></h3>
        <span class="badge role">v${escapeHtml(nativeInfo.appVersion || "-")}（${escapeHtml(nativeInfo.appVersionDate || "-")}）</span>
      </div>
      <p class="hint">動作確認の際は、ここに表示されるバージョン番号が最新かご確認ください。古い番号のままの場合は、デスクトップショートカットが古いバージョンを指している可能性があります（ショートカットを削除し、最新版のexeを直接実行し直すと直ります）。</p>
      ${isDesktop ? `<button class="btn small" id="openBridgeLog" style="margin-top:6px">診断ログを開く</button>
      <p class="hint">PDF保存やWordダウンロードがうまくいかない場合、原因調査のため開発側にこのログの内容をお伝えいただくことがあります。</p>` : ""}
    </div>
    <div class="card">
      <div class="card-title"><h3>試作データのリセット</h3></div>
      <p class="hint">この端末に保存されたデータをすべて初期状態に戻します（初回設定からやり直します）。</p>
      <button class="btn danger" id="resetBtn">全データをリセット</button>
    </div>
    <div class="card">
      <div class="card-title"><h3>アンインストール</h3></div>
      <p class="hint">アプリ本体・データフォルダ・デスクトップショートカットを削除します。作成済みのPDFレポート（Reportsフォルダ内）は削除されません。</p>
      <button class="btn danger" id="uninstallBtn" ${isDesktop ? "" : "disabled"}>${isDesktop ? "このアプリをアンインストール" : "デスクトップアプリでのみ利用できます"}</button>
    </div>
    <button class="btn primary" id="saveBrand" style="margin-top:4px">保存</button>
  `;
  panel.querySelector("#saveBrand").onclick = () => {
    const exportDirEl = panel.querySelector("#bExportDir");
    db.brand = {
      ...db.brand,
      company: panel.querySelector("#bCompany").value.trim() || BRAND_COMPANY_DEFAULT,
      showEffectConfirm: panel.querySelector("#bShowEffect").checked,
      showExcludedWordsTab: panel.querySelector("#bShowWordsTab").checked,
      exportDir: exportDirEl ? exportDirEl.value.trim() : (db.brand.exportDir || ""),
    };
    db.audit("settings_brand_update", "brand", "");
    toast("保存しました", "good");
    // 除外語タブの表示・効果確認機能の表示切替はナビゲーション自体に
    // 影響するため、このパネルだけでなく親のタブ一覧も再描画する。
    render(root);
  };
  const unlockBtn = panel.querySelector("#unlockCompany");
  if (unlockBtn) unlockBtn.onclick = () => confirmDialog(
    "会社名は通常、休暇村協会の正式名称のまま使用します。本当に変更しますか？",
    () => { brandCompanyUnlocked = true; renderBrand(panel); },
    { danger: true, okLabel: "編集する" }
  );
  const openDirBtn = panel.querySelector("#openDataDir");
  if (openDirBtn) openDirBtn.onclick = () => revealInExplorerToast(nativeInfo.dataDir);
  const openLogBtn = panel.querySelector("#openBridgeLog");
  if (openLogBtn) openLogBtn.onclick = async () => {
    toast("開いています…", "");
    const result = await openPath(nativeInfo.bridgeLogPath);
    if (result.ok) return;
    if (result.error === "file-not-found") {
      toast("ログはまだありません（PDF保存やWordダウンロードなどを一度試した後に生成されます）", "");
    } else if (result.timedOut) {
      toast("応答がありませんでした（セキュリティソフトがブロックしている可能性があります）", "bad");
    } else {
      toast("開けませんでした: " + (result.error || "不明なエラー"), "bad");
    }
  };
  // v2.13: pickFolder() returning {ok:false} is ambiguous by itself — it's
  // the normal, expected shape both when the user clicks Cancel in the
  // dialog AND when the dialog never opened at all (timeout / blocked).
  // Only the latter is worth a toast; a plain cancel has no `error` field
  // at all (see MainWindow.xaml.cs's pickFolder case) so we can tell them
  // apart.
  function toastIfPickFailed(picked) {
    if (picked.timedOut) toast("応答がありませんでした（セキュリティソフトがブロックしている可能性があります）", "bad");
    else if (picked.error) toast("開けませんでした: " + picked.error, "bad");
    // else: user just clicked Cancel — nothing to say.
  }
  const pickExportDirBtn = panel.querySelector("#pickExportDir");
  if (pickExportDirBtn) pickExportDirBtn.onclick = async () => {
    const picked = await pickFolder("PDF・Wordの書き出し先フォルダを選択してください");
    if (!picked.ok) { toastIfPickFailed(picked); return; }
    panel.querySelector("#bExportDir").value = picked.path;
  };
  const openExportDirBtn = panel.querySelector("#openExportDir");
  if (openExportDirBtn) openExportDirBtn.onclick = () => {
    const dir = panel.querySelector("#bExportDir").value.trim() || nativeInfo.reportsDir;
    revealInExplorerToast(dir);
  };
  const relocateBtn = panel.querySelector("#relocateDataDir");
  if (relocateBtn) relocateBtn.onclick = async () => {
    const picked = await pickFolder("新しい保存先フォルダを選択してください");
    if (!picked.ok) { toastIfPickFailed(picked); return; }
    confirmDialog(
      `保存先を\n${picked.path}\nに変更します。アプリはデータ移動後に自動的に再起動します。よろしいですか？`,
      async () => {
        toast("データを移動しています。アプリが再起動するまでお待ちください…", "");
        const result = await requestRelocateData(picked.path);
        if (!result.ok) {
          const msg = result.error === "same-location" ? "既に同じ場所が選択されています。" : "移動を開始できませんでした: " + (result.error || "");
          toast(msg, "bad");
        }
      },
      { danger: true, okLabel: "移動して再起動する" }
    );
  };
  panel.querySelector("#resetBtn").onclick = () => confirmDialog("すべてのデータを削除して初期状態（初回設定）に戻します。この操作は取り消せません。", () => {
    db.resetAll();
    toast("初期化しました", "good");
    location.reload();
  }, { danger: true, okLabel: "リセットする" });
  const uninstallBtn = panel.querySelector("#uninstallBtn");
  if (uninstallBtn && isDesktop) uninstallBtn.onclick = () => confirmDialog(
    "Guest Voice Studioをアンインストールします。アプリ本体・データ・デスクトップショートカットが削除され、アプリは終了します（保存済みのPDFレポートは残ります）。よろしいですか？",
    async () => {
      db.audit("app_uninstall_requested", "app", "");
      toast("アンインストールを開始します…", "");
      const result = await requestUninstall();
      if (!result.ok) toast("アンインストールを開始できませんでした: " + (result.error || ""), "bad");
    },
    { danger: true, okLabel: "アンインストールする" }
  );
  const aboutCardTitle = panel.querySelector("#aboutCardTitle");
  if (aboutCardTitle) aboutCardTitle.onclick = () => openAboutModal();
}

// ---------------------------------------------------------------------------
// 「このツールについて」ポップアップ：バージョン・製作情報に加えて、仕様書の
// 要点をアプリ内に埋め込んで表示する（別ファイルを探さなくても、その場で
// 概要を確認できるように）。詳細な正式仕様書は別途Wordファイルでお渡しして
// いるものを参照。
function openAboutModal() {
  openModal(`
    <div class="modal-header"><h3>このツールについて</h3><button data-close>&times;</button></div>
    <div class="field-row">
      <div class="field"><label>バージョン</label><div><strong>${escapeHtml(nativeInfo.appVersion || "-")}</strong>（更新日: ${escapeHtml(nativeInfo.appVersionDate || "-")}）</div></div>
      <div class="field"><label>初回製作日</label><div>2026年8月20日</div></div>
    </div>
    <p class="hint">アップデート・修正のたびにバージョン番号と更新日が変わります。動作確認の際は、この番号が最新かをご確認ください。</p>
    ${isDesktop ? `
    <div class="card" style="margin:6px 0">
      <div class="card-title"><h3 style="font-size:.9rem">📄 使い方概要（Word）</h3></div>
      <p class="hint">ダウンロードせずとも、インストールフォルダ内に最初から入っています。下のボタンでパスをコピーし、エクスプローラーのアドレス欄に貼り付けて開いてください。</p>
      <div class="path-box"><span style="user-select:text">${escapeHtml(nativeInfo.usageGuidePath || "")}</span></div>
      <div class="row" style="gap:8px;margin-top:8px">
        <button class="btn small" id="copyUsageGuidePath">パスをコピー</button>
        <button class="btn small" id="downloadUsageGuide">ダウンロードで保存し直す</button>
      </div>
    </div>
    ` : `
    <div class="row" style="justify-content:flex-end">
      <button class="btn small" id="downloadUsageGuide">📄 使い方概要をWordでダウンロード</button>
    </div>
    `}
    <hr class="divider">
    <div class="stack" style="max-height:50vh;overflow-y:auto;padding-right:6px">
      <h4>概要</h4>
      <p>お客様アンケート（5段階評価＋自由記述）のCSVを取り込み、分析・改善課題管理・期間比較・PDF報告書までを行う、休暇村1拠点専用のローカルWindowsデスクトップアプリです。データはこのPC内にのみ保存され、外部（サーバー・AI・API等）へは一切送信されません。</p>
      <h4>主な機能</h4>
      <ul>
        <li>CSV取込（UTF-8/Shift-JIS自動判定、個人情報列の自動除外）</li>
        <li>期間・項目・評価帯での絞り込み集計、ワードクラウードによるコメント分析</li>
        <li>改善課題の登録・進捗管理（Action Board）</li>
        <li>期間比較（今月対先月など）</li>
        <li>PDF報告書の作成</li>
        <li>パスフレーズ暗号化によるバックアップ／復元、保存先の変更（Dドライブ等への移動）</li>
      </ul>
      <h4>使い方の流れ</h4>
      <ol>
        <li>Import画面で日次のアンケートCSVを取り込む</li>
        <li>Guest Voice画面で期間・項目を絞り込み、評価やコメントを確認する</li>
        <li>気になるコメントがあれば、Action Boardで改善課題として登録する</li>
        <li>対応後、効果を確認する（Settingsでオンにした場合）</li>
        <li>Report StudioでPDF報告書を作成し、メールで送る（PDFは手動添付）</li>
      </ol>
      <h4>データの保存・セキュリティ</h4>
      <p>全データはこのPCの指定フォルダにのみ保存されます。CSV内のメールアドレス・氏名・電話番号等は自動検出し、取り込み・保存の両方から除外されます。バックアップはパスフレーズ（8文字以上）でAES-256-GCM暗号化されます。</p>
      <h4>製作情報</h4>
      <p>製作者：大籠義記<br>本ツールはClaude Codeによる開発作業として作成されました。上の「使い方概要」から、この内容をWord文書として確認できます。ご不明点があればお気軽にお尋ねください。</p>
    </div>
  `, { width: 620, onMount: (r) => {
    r.querySelector("[data-close]").onclick = closeModal;
    r.querySelector("#downloadUsageGuide").onclick = () => downloadUsageGuide();
    const copyPathBtn = r.querySelector("#copyUsageGuidePath");
    if (copyPathBtn) copyPathBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(nativeInfo.usageGuidePath || "");
        toast("パスをコピーしました", "good");
      } catch (err) {
        toast("コピーに失敗しました。上の欄を選択してCtrl+Cでコピーしてください。", "bad");
      }
    };
  } });
}

// v2.10: PDF保存（reportstudio.js handlePrint）と同じ理由で、都度の
// 「名前を付けて保存」ダイアログをやめ、設定＞保存先の書き出し先フォルダ
// （未設定ならReportsフォルダ）へ直接保存する方式に変更。
// v2.14: それでもタイムアウトする報告が続いたため、PDF保存と同じくディスク
// への実際の書き込みをWebView2自身のダウンロード機構に肩代わりさせる方式に
// 変更（reportstudio.js handlePrintのv2.14コメント参照）。
async function downloadUsageGuide() {
  try {
    const resp = await fetch("assets/usage_guide.docx");
    if (!resp.ok) throw new Error("ファイルの読み込みに失敗しました");
    const buf = await resp.arrayBuffer();
    const filename = "使い方概要_GuestVoiceStudio.docx";
    if (isDesktop) {
      const exportDir = (db.brand.exportDir || nativeInfo.reportsDir || "").trim();
      if (!exportDir) { toast("保存先フォルダが確認できません。設定画面をご確認ください。", "bad"); return; }
      const path = joinPath(exportDir, filename);
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      await saveBlobToPath(path, blob);
      toast(`保存しました: ${path}`, "good");
      setTimeout(() => revealInExplorerToast(path), 800);
    } else {
      downloadBlob(filename, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      toast("ダウンロードしました", "good");
    }
  } catch (err) {
    toast("ダウンロードに失敗しました: " + err.message, "bad");
  }
}
