// ============================================================================
// settings.js — "Settings｜設定": stores, item mapping, excluded words,
// users/permissions, report recipients, brand & retention (§4.2 MAP,
// §4.10 MAIL-01, §7 機密性/監査, §11 要確認事項 defaults).
// ============================================================================

import { db } from "../db.js";
import { escapeHtml, toast, confirmDialog, openModal, closeModal } from "../components/ui.js";

const TABS = [
  { key: "stores", label: "拠点" },
  { key: "items", label: "項目マッピング" },
  { key: "words", label: "除外語" },
  { key: "users", label: "ユーザー・権限" },
  { key: "recipients", label: "報告先" },
  { key: "brand", label: "ブランド・保存設定" },
];
let activeTab = "stores";

export function mountSettings(root) {
  activeTab = "stores";
  render(root);
}

function render(root) {
  root.innerHTML = `
    <div class="row" style="align-items:flex-start;gap:20px">
      <div class="card" style="width:200px;flex:0 0 200px">
        <div class="settings-nav">
          ${TABS.map((t) => `<button data-tab="${t.key}" class="${activeTab === t.key ? "active" : ""}">${t.label}</button>`).join("")}
        </div>
      </div>
      <div style="flex:1" id="panel"></div>
    </div>
  `;
  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { activeTab = b.dataset.tab; render(root); });
  const panel = root.querySelector("#panel");
  ({ stores: renderStores, items: renderItems, words: renderWords, users: renderUsers, recipients: renderRecipients, brand: renderBrand })[activeTab](panel, root);
}

// ---------------------------------------------------------------------------
function renderStores(panel, root) {
  const stores = db.stores;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>拠点一覧（${stores.length}拠点）</h3></div>
      <p class="hint">CSV内の拠点名表記ゆれは「別名」に登録すると自動的に正規の拠点へ対応付けられます（MAP-04）。</p>
      <div class="table-wrap"><table><thead><tr><th>拠点名</th><th>別名（表記ゆれ）</th><th>有効</th><th></th></tr></thead><tbody>
        ${stores.map((s) => `<tr>
          <td>${escapeHtml(s.name)}</td>
          <td><input type="text" data-alias="${s.id}" value="${escapeHtml((s.aliases||[]).join(", "))}" placeholder="カンマ区切り"></td>
          <td><input type="checkbox" data-active="${s.id}" ${s.active ? "checked" : ""}></td>
          <td><button class="btn small" data-save="${s.id}">保存</button></td>
        </tr>`).join("")}
      </tbody></table></div>
    </div>
  `;
  panel.querySelectorAll("[data-save]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.save;
      const aliasInput = panel.querySelector(`[data-alias="${id}"]`);
      const activeInput = panel.querySelector(`[data-active="${id}"]`);
      const list = db.stores.map((s) => s.id === id ? { ...s, aliases: aliasInput.value.split(",").map((a) => a.trim()).filter(Boolean), active: activeInput.checked } : s);
      db.stores = list;
      db.audit("settings_store_update", id, "");
      toast("保存しました", "good");
    };
  });
}

// ---------------------------------------------------------------------------
function renderItems(panel, root) {
  const items = db.itemMappings;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>項目マッピング（${items.length}項目）</h3><button class="btn small primary" id="addItem">＋ 項目を追加</button></div>
      <p class="hint">評価列・コメント列の組をここで定義します。CSVの列名を変更しても、ここを更新するだけで対応できます（アプリ改修不要／MAP-01,02）。</p>
      <div class="table-wrap"><table><thead><tr><th>項目名</th><th>カテゴリー</th><th>評価列名</th><th>コメント列名</th><th>有効</th><th>お気に入り</th><th></th></tr></thead><tbody>
        ${items.map((i) => `<tr>
          <td><input type="text" data-f="name" data-id="${i.id}" value="${escapeHtml(i.name)}"></td>
          <td><input type="text" data-f="category" data-id="${i.id}" value="${escapeHtml(i.category)}"></td>
          <td><input type="text" data-f="ratingCol" data-id="${i.id}" value="${escapeHtml(i.ratingCol)}"></td>
          <td><input type="text" data-f="commentCol" data-id="${i.id}" value="${escapeHtml(i.commentCol)}"></td>
          <td><input type="checkbox" data-f="enabled" data-id="${i.id}" ${i.enabled ? "checked" : ""}></td>
          <td><input type="checkbox" data-f="favorite" data-id="${i.id}" ${i.favorite ? "checked" : ""}></td>
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
        favorite: get("favorite").checked,
      } : i);
      db.itemMappings = list;
      db.audit("settings_item_update", id, "");
      toast("保存しました", "good");
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
  const stores = db.stores;
  const items = db.itemMappings;
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
      <div class="card-title"><h3>拠点別除外語</h3></div>
      <div class="field-row">
        <div class="field"><label>拠点</label><select id="storeSelForWords">${stores.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></div>
      </div>
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
    const sid = panel.querySelector("#storeSelForWords").value;
    const list = db.excludedWords.byStore?.[sid] || [];
    panel.querySelector("#storeWords").innerHTML = list.map((w) => `<span class="chip">${escapeHtml(w)} <button data-rm-store="${escapeHtml(w)}">&times;</button></span>`).join("") || `<span class="hint">なし</span>`;
    panel.querySelectorAll("[data-rm-store]").forEach((b) => b.onclick = () => {
      const ew2 = db.excludedWords; ew2.byStore[sid] = (ew2.byStore[sid]||[]).filter((w) => w !== b.dataset.rmStore); db.excludedWords = ew2; renderStoreWords();
    });
  }
  panel.querySelector("#storeSelForWords").onchange = renderStoreWords;
  panel.querySelector("#addStoreWord").onclick = () => {
    const sid = panel.querySelector("#storeSelForWords").value;
    const v = panel.querySelector("#newStoreWord").value.trim(); if (!v) return;
    const ew2 = db.excludedWords; ew2.byStore = ew2.byStore || {}; ew2.byStore[sid] = ew2.byStore[sid] || [];
    if (!ew2.byStore[sid].includes(v)) ew2.byStore[sid].push(v);
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
function renderUsers(panel, root) {
  const users = db.users;
  const stores = db.stores;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>ユーザー・権限（試作用の簡易管理）</h3></div>
      <p class="hint">本番ではMicrosoft 365／会社アカウント連携を前提とします（AUTH-04）。拠点責任者・閲覧者は割り当てた拠点のみ閲覧できます（AUTH-03）。</p>
      <div class="table-wrap"><table><thead><tr><th>氏名</th><th>メール</th><th>役割</th><th>担当拠点</th></tr></thead><tbody>
        ${users.map((u) => `<tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td><select data-role="${u.id}">
            ${["本部管理者","拠点責任者","閲覧者"].map((r) => `<option ${u.role===r?"selected":""}>${r}</option>`).join("")}
          </select></td>
          <td>
            <select data-stores="${u.id}" multiple size="3" ${u.role==="本部管理者"?"disabled":""}>
              ${stores.map((s) => `<option value="${s.id}" ${u.storeIds.includes(s.id)?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}
            </select>
          </td>
        </tr>`).join("")}
      </tbody></table></div>
      <button class="btn small primary" id="saveUsers" style="margin-top:10px">保存</button>
    </div>
  `;
  panel.querySelector("#saveUsers").onclick = () => {
    const list = db.users.map((u) => {
      const role = panel.querySelector(`[data-role="${u.id}"]`).value;
      const storeSelect = panel.querySelector(`[data-stores="${u.id}"]`);
      const storeIds = role === "本部管理者" ? stores.map((s) => s.id) : [...storeSelect.selectedOptions].map((o) => o.value);
      return { ...u, role, storeIds };
    });
    db.users = list;
    db.audit("settings_users_update", "users", "");
    toast("保存しました", "good");
  };
}

// ---------------------------------------------------------------------------
function renderRecipients(panel, root) {
  const recipients = db.recipients;
  const stores = db.stores;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>報告先（MAIL-01）</h3><button class="btn small primary" id="addRcp">＋ 報告先を追加</button></div>
      <div class="table-wrap"><table><thead><tr><th>氏名</th><th>宛先</th><th>CC</th><th>対象拠点</th><th></th></tr></thead><tbody>
        ${recipients.map((r) => `<tr>
          <td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.cc||"")}</td>
          <td>${r.storeIds.map((id) => escapeHtml(db.storeName(id))).join(", ") || "全拠点"}</td>
          <td><button class="btn small" data-edit="${r.id}">編集</button> <button class="btn small danger" data-del="${r.id}">削除</button></td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty-state">登録がありません</td></tr>`}
      </tbody></table></div>
    </div>
  `;
  panel.querySelector("#addRcp").onclick = () => openRecipientForm(root);
  panel.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => openRecipientForm(root, db.recipients.find((r) => r.id === b.dataset.edit)));
  panel.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => confirmDialog("この報告先を削除しますか？", () => {
    db.recipients = db.recipients.filter((r) => r.id !== b.dataset.del);
    db.audit("settings_recipient_delete", b.dataset.del, "");
    render(root);
  }, { danger: true, okLabel: "削除する" }));
}

function openRecipientForm(root, existing) {
  const stores = db.stores;
  openModal(`
    <div class="modal-header"><h3>${existing ? "報告先を編集" : "報告先を追加"}</h3><button data-close>&times;</button></div>
    <div class="field"><label>氏名</label><input type="text" id="rName" value="${escapeHtml(existing?.name||"")}"></div>
    <div class="field-row">
      <div class="field"><label>宛先メール</label><input type="text" id="rEmail" value="${escapeHtml(existing?.email||"")}"></div>
      <div class="field"><label>CC</label><input type="text" id="rCc" value="${escapeHtml(existing?.cc||"")}"></div>
    </div>
    <div class="field"><label>対象拠点（未選択＝全拠点）</label>
      <select id="rStores" multiple size="5">${stores.map((s) => `<option value="${s.id}" ${(existing?.storeIds||[]).includes(s.id)?"selected":""}>${escapeHtml(s.name)}</option>`).join("")}</select>
    </div>
    <div class="field"><label>件名テンプレート（{{store}} {{period}} 使用可）</label><input type="text" id="rSubject" value="${escapeHtml(existing?.subjectTemplate||"【{{store}}】お客様の声 月次報告（{{period}}）")}"></div>
    <div class="field"><label>本文テンプレート（{{store}} {{period}} {{author}} 使用可）</label><textarea id="rBody" rows="5">${escapeHtml(existing?.bodyTemplate||"いつもお世話になっております。\n{{store}}の{{period}}分レポートを添付いたします。\n\n{{author}}")}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-cancel>キャンセル</button><button class="btn primary" id="saveRcp">保存</button></div>
  `, { width: 560, onMount: (r) => {
    r.querySelector("[data-close]").onclick = closeModal;
    r.querySelector("[data-cancel]").onclick = closeModal;
    r.querySelector("#saveRcp").onclick = () => {
      const storeIds = [...r.querySelector("#rStores").selectedOptions].map((o) => o.value);
      const rec = {
        id: existing?.id || db.uid("rcp"),
        name: r.querySelector("#rName").value.trim(),
        email: r.querySelector("#rEmail").value.trim(),
        cc: r.querySelector("#rCc").value.trim(),
        storeIds,
        subjectTemplate: r.querySelector("#rSubject").value,
        bodyTemplate: r.querySelector("#rBody").value,
      };
      const list = db.recipients;
      const idx = list.findIndex((x) => x.id === rec.id);
      if (idx >= 0) list[idx] = rec; else list.push(rec);
      db.recipients = list;
      db.audit(existing ? "settings_recipient_update" : "settings_recipient_create", rec.id, rec.name);
      toast("保存しました", "good");
      closeModal();
      render(document.getElementById("content"));
    };
  }});
}

// ---------------------------------------------------------------------------
function renderBrand(panel) {
  const brand = db.brand;
  panel.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>ブランド情報（報告書に反映）</h3></div>
      <div class="field-row">
        <div class="field"><label>会社名</label><input type="text" id="bCompany" value="${escapeHtml(brand.company||"")}"></div>
        <div class="field"><label>社内ドメイン（社外アドレス警告に使用）</label><input type="text" id="bDomain" value="${escapeHtml(brand.companyDomain||"example.co.jp")}"></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title"><h3>データ保存・取込設定</h3></div>
      <div class="field-row">
        <div class="field"><label>データ保存期間（日）</label><input type="number" id="bRetention" value="${brand.retentionDays||1095}"></div>
        <div class="field checkbox-row" style="align-items:center;margin-top:22px"><input type="checkbox" id="bKeepCsv" ${brand.keepRawCsv?"checked":""}><label style="margin:0">CSV原本を保存する（初期値OFF／IMP-06）</label></div>
      </div>
      <p class="hint">未決の場合は会社の情報管理規程に従い、ここで設定してください（要確認事項 §11）。</p>
    </div>
    <div class="card">
      <div class="card-title"><h3>試作データのリセット</h3></div>
      <p class="hint">この端末に保存された試作データ（localStorage）をすべて初期状態に戻します。</p>
      <button class="btn danger" id="resetBtn">全データをリセット</button>
    </div>
    <button class="btn primary" id="saveBrand" style="margin-top:4px">保存</button>
  `;
  panel.querySelector("#saveBrand").onclick = () => {
    db.brand = {
      ...db.brand,
      company: panel.querySelector("#bCompany").value.trim(),
      companyDomain: panel.querySelector("#bDomain").value.trim(),
      retentionDays: Number(panel.querySelector("#bRetention").value) || 1095,
      keepRawCsv: panel.querySelector("#bKeepCsv").checked,
    };
    db.audit("settings_brand_update", "brand", "");
    toast("保存しました", "good");
  };
  panel.querySelector("#resetBtn").onclick = () => confirmDialog("すべての試作データを削除して初期状態に戻します。この操作は取り消せません。", () => {
    db.resetAll();
    toast("初期化しました", "good");
    location.hash = "lobby";
    location.reload();
  }, { danger: true, okLabel: "リセットする" });
}
