// ============================================================================
// import.js — CSV import screen (IMP-01..06, MAP-04, business flow step 1-2).
// ============================================================================

import { db } from "../db.js";
import { readFileSmart, parseCsv, buildPreview, importRows } from "../csv.js";
import { toast, escapeHtml } from "../components/ui.js";

let state = { file: null, text: null, encoding: null, parsed: null, preview: null };

export function mountImport(root) {
  state = { file: null, text: null, encoding: null, parsed: null, preview: null };
  root.innerHTML = `
    <div class="card">
      <div class="card-title"><h2>CSV取込</h2></div>
      <p class="muted">日次のアンケートCSVを取り込みます。取込前に件数・対象期間・拠点・列対応をプレビューできます（IMP-03）。</p>
      <div class="dropzone" id="dropzone">
        <div class="icon">📄</div>
        <div><strong>ここにCSVをドラッグ＆ドロップ</strong> または クリックして選択</div>
        <div class="hint">UTF-8 / Shift-JIS に対応</div>
        <input type="file" id="fileInput" accept=".csv" style="display:none">
      </div>
      <div class="field-row" style="margin-top:14px">
        <div class="field checkbox-row">
          <input type="checkbox" id="keepRaw" ${db.brand.keepRawCsv ? "checked" : ""}>
          <label style="margin:0">CSV原本を保存する（初期値：保存しない／IMP-06）</label>
        </div>
      </div>
    </div>
    <div id="previewArea"></div>
  `;

  const dropzone = root.querySelector("#dropzone");
  const fileInput = root.querySelector("#fileInput");
  dropzone.onclick = () => fileInput.click();
  ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); }));
  ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag-over"); }));
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f, root);
  });
  fileInput.onchange = () => { if (fileInput.files[0]) handleFile(fileInput.files[0], root); };

  root.querySelector("#keepRaw").onchange = (e) => {
    db.brand = { ...db.brand, keepRawCsv: e.target.checked };
  };
}

async function handleFile(file, root) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    toast("CSVファイルを選択してください", "bad");
    return;
  }
  const { text, encoding } = await readFileSmart(file);
  const parsed = parseCsv(text);
  const preview = buildPreview(parsed, db.itemMappings, db.stores);
  state = { file, text, encoding, parsed, preview };
  renderPreview(root);
}

function renderPreview(root) {
  const { preview, encoding, parsed, file } = state;
  const area = root.querySelector("#previewArea");
  const colRows = preview.columnStatus.map((c) => `
    <tr>
      <td>${escapeHtml(c.item)}</td>
      <td>${c.ratingCol} ${c.ratingFound ? "✅" : "<span style=\"color:var(--bad)\">未検出</span>"}</td>
      <td>${c.commentCol} ${c.commentFound ? "✅" : "<span style=\"color:var(--bad)\">未検出</span>"}</td>
    </tr>`).join("");

  area.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>プレビュー：${escapeHtml(file.name)}</h3><span class="badge role">${encoding}</span></div>
      <div class="grid cols-4">
        <div class="stat-tile"><div class="label">件数</div><div class="value">${preview.totalRows}<span class="unit">件</span></div></div>
        <div class="stat-tile"><div class="label">対象期間</div><div class="value" style="font-size:1rem">${preview.periodStart || "-"} ～ ${preview.periodEnd || "-"}</div></div>
        <div class="stat-tile"><div class="label">拠点数（ファイル内）</div><div class="value">${preview.storeNamesInFile.length}</div></div>
        <div class="stat-tile"><div class="label">回答ID未設定</div><div class="value">${preview.missingIdCount}<span class="unit">件</span></div></div>
      </div>
      ${!preview.hasIdColumn ? `<p class="hint" style="color:var(--warn);margin-top:10px">⚠ 回答ID列が見つかりません。重複排除ができないため、全件「要確認」として取り込まれます（IMP-04）。</p>` : ""}
      ${preview.unmatchedStores.length ? `<p class="hint" style="color:var(--bad)">⚠ 拠点名が一致しません: ${preview.unmatchedStores.map(escapeHtml).join(", ")}（Settingsで表記揺れを登録してください／MAP-04）</p>` : ""}
      ${preview.invalidDateCount ? `<p class="hint" style="color:var(--bad)">⚠ 日付が不正な行: ${preview.invalidDateCount}件</p>` : ""}

      <h4 style="margin-top:16px">列マッピング状況</h4>
      <div class="table-wrap"><table><thead><tr><th>項目</th><th>評価列</th><th>コメント列</th></tr></thead><tbody>${colRows}</tbody></table></div>

      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" id="cancelImport">キャンセル</button>
        <button class="btn primary" id="confirmImport">この内容で取り込む</button>
      </div>
    </div>
  `;
  area.querySelector("#cancelImport").onclick = () => { area.innerHTML = ""; };
  area.querySelector("#confirmImport").onclick = () => commitImport(root);
}

function commitImport(root) {
  const batchId = db.uid("batch");
  const existing = db.records;
  const result = importRows(state.parsed, db.itemMappings, db.stores, existing, batchId);

  db.records = existing.concat(result.newRecords);
  const batches = db.importBatches;
  batches.unshift({
    id: batchId,
    filename: state.file.name,
    importedAt: new Date().toISOString(),
    importer: db.currentUser()?.name,
    encoding: state.encoding,
    totalRows: state.preview.totalRows,
    success: result.success,
    duplicate: result.duplicate,
    error: result.error,
    excluded: result.excluded,
    warnedNoId: result.warnedNoId,
    errorRows: result.errorRows.slice(0, 50),
    periodStart: state.preview.periodStart,
    periodEnd: state.preview.periodEnd,
    keepRawCsv: db.brand.keepRawCsv,
    rawCsv: db.brand.keepRawCsv ? state.text : null,
  });
  db.importBatches = batches;
  db.audit("csv_import", batchId, `${state.file.name} 成功${result.success}件 重複${result.duplicate}件 エラー${result.error}件`);

  const area = root.querySelector("#previewArea");
  area.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>取込結果</h3></div>
      <div class="grid cols-5">
        <div class="stat-tile"><div class="label">成功</div><div class="value" style="color:var(--good)">${result.success}</div></div>
        <div class="stat-tile"><div class="label">重複（除外）</div><div class="value" style="color:var(--ink-soft)">${result.duplicate}</div></div>
        <div class="stat-tile"><div class="label">エラー</div><div class="value" style="color:var(--bad)">${result.error}</div></div>
        <div class="stat-tile"><div class="label">対象外（無効データ）</div><div class="value">${result.excluded}</div></div>
        <div class="stat-tile"><div class="label">ID未設定（要確認）</div><div class="value" style="color:var(--warn)">${result.warnedNoId}</div></div>
      </div>
      ${result.errorRows.length ? `<h4 style="margin-top:14px">エラー行（先頭50件）</h4>
        <div class="table-wrap"><table><thead><tr><th>行</th><th>理由</th></tr></thead><tbody>
          ${result.errorRows.map((e) => `<tr><td>${e.row}</td><td>${escapeHtml(e.reason)}</td></tr>`).join("")}
        </tbody></table></div>` : ""}
      <div class="row" style="justify-content:flex-end;margin-top:16px">
        <a class="btn primary" href="#guestvoice">Guest Voiceで分析する</a>
      </div>
    </div>
  `;
  toast(`取込完了：成功${result.success}件`, "good");
}
