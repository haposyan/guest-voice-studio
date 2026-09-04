// ============================================================================
// import.js — CSV import screen (IMP-01..06, MAP-04, business flow step 1-2).
// ============================================================================

import { db } from "../db.js";
import { readFileSmart, parseCsv, buildPreview, importRows } from "../csv.js";
import { toast, escapeHtml, confirmDialog } from "../components/ui.js";

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
    </div>
    <div id="previewArea"></div>
    <div id="historyArea"></div>
  `;

  const dropzone = root.querySelector("#dropzone");
  const fileInput = root.querySelector("#fileInput");
  dropzone.onclick = () => fileInput.click();
  // v2.27: dropEffect="copy" here is what actually draws the normal
  // (allowed) drag cursor over this dropzone, in contrast to app.js's
  // window-level dragover fallback, which sets "none" ("🚫") everywhere
  // else a file is dragged — see that handler's comment for how the two
  // cooperate via e.defaultPrevented.
  ["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; dropzone.classList.add("drag-over"); }));
  ["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag-over"); }));
  dropzone.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f, root);
  });
  fileInput.onchange = () => { if (fileInput.files[0]) handleFile(fileInput.files[0], root); };

  renderHistory(root);
}

// v2.18: 取込済み期間の一覧と、期間ごとの取消（クリア）機能。誤った
// CSVを取り込んでしまった場合に、その回の取込分だけを取り消せるように
// する（batchIdで紐付いたレコードだけを削除し、他の期間・他の取込には
// 影響しない）。
function renderHistory(root) {
  const area = root.querySelector("#historyArea");
  const batches = db.importBatches;
  if (!batches.length) { area.innerHTML = ""; return; }
  area.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>取込履歴</h3></div>
      <p class="hint">誤って取り込んだ回がある場合、その回の分だけを取り消せます（他の期間のデータには影響しません）。</p>
      <div class="table-wrap"><table><thead><tr><th>取込日時</th><th>ファイル名</th><th>対象期間</th><th>成功件数</th><th></th></tr></thead><tbody>
        ${batches.map((b) => `<tr>
          <td>${escapeHtml(new Date(b.importedAt).toLocaleString("ja-JP"))}</td>
          <td>${escapeHtml(b.filename)}</td>
          <td>${escapeHtml(b.periodStart || "-")} ～ ${escapeHtml(b.periodEnd || "-")}</td>
          <td>${b.success}件</td>
          <td><button class="btn small danger" data-clear-batch="${b.id}">この回を取り消す</button></td>
        </tr>`).join("")}
      </tbody></table></div>
    </div>
  `;
  area.querySelectorAll("[data-clear-batch]").forEach((btn) => {
    btn.onclick = () => {
      const batchId = btn.dataset.clearBatch;
      const batch = batches.find((b) => b.id === batchId);
      confirmDialog(
        `${batch.filename}（${batch.periodStart || "-"} ～ ${batch.periodEnd || "-"}）の取込分（${batch.success}件）を取り消します。この操作は取り消せません。よろしいですか？`,
        () => {
          db.records = db.records.filter((r) => r.batchId !== batchId);
          db.importBatches = db.importBatches.filter((b) => b.id !== batchId);
          db.audit("csv_import_undo", batchId, `${batch.filename} の取込を取り消し`);
          toast("取込を取り消しました", "good");
          renderHistory(root);
        },
        { danger: true, okLabel: "取り消す" }
      );
    };
  });
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

  // v2.18: 取込済み期間との重複検出。厳密な業務上の重複排除（回答ID単位）
  // はimportRows側で別途行われる — これはあくまで「同じ期間のCSVをもう
  // 一度取り込もうとしていないか」を、取り込む前にユーザーに気づかせる
  // ためのもの。
  const overlaps = preview.periodStart && preview.periodEnd
    ? db.importBatches.filter((b) => b.periodStart && b.periodEnd && b.periodStart <= preview.periodEnd && preview.periodStart <= b.periodEnd)
    : [];

  area.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>プレビュー：${escapeHtml(file.name)}</h3><span class="badge role">${encoding}</span></div>
      <div class="grid cols-4">
        <div class="stat-tile"><div class="label">件数</div><div class="value">${preview.totalRows}<span class="unit">件</span></div></div>
        <div class="stat-tile"><div class="label">対象期間</div><div class="value" style="font-size:1rem">${preview.periodStart || "-"} ～ ${preview.periodEnd || "-"}</div></div>
        <div class="stat-tile"><div class="label">拠点数（ファイル内）</div><div class="value">${preview.storeNamesInFile.length}</div></div>
        <div class="stat-tile"><div class="label">回答ID未設定</div><div class="value">${preview.missingIdCount}<span class="unit">件</span></div></div>
      </div>
      ${overlaps.length ? `<p class="hint" style="color:var(--warn);font-weight:600">⚠ 取込済みの期間と重なっています: ${overlaps.map((b) => `${escapeHtml(b.filename)}（${escapeHtml(b.periodStart)}～${escapeHtml(b.periodEnd)}）`).join("、")}。回答IDが一致する行は自動的に重複除外されますが、取り込む前にご確認ください。</p>` : ""}
      ${preview.personalDataColumns.length ? `<p class="hint" style="color:var(--info);font-weight:600">⚠ 名前とメールアドレスの情報を除外して取り込みます（検出した列: ${preview.personalDataColumns.map(escapeHtml).join(", ")}）。これらの列の値は一切保存されません。</p>` : ""}
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
  area.querySelector("#confirmImport").onclick = () => {
    if (overlaps.length) {
      confirmDialog(
        `取込済みの期間（${overlaps.map((b) => `${b.filename}：${b.periodStart}～${b.periodEnd}`).join("、")}）と重なっています。重複する回答は自動的に除外されますが、このまま取り込みますか？`,
        () => commitImport(root),
        { danger: true, okLabel: "取り込む" }
      );
    } else {
      commitImport(root);
    }
  };
}

// v2.22: 1万件を超えるようなCSVでは、実際の取込処理（重複判定・保存）に
// 数秒かかることがある。処理自体は同期的なままだが（チャンク分割して
// 非同期化するほどの規模ではないと判断）、重い処理を始める前に「取込中…」
// の表示を確実に画面へ描画してから始めることで、「反応がない＝止まって
// いる」ように見える問題を解消する。二重rAFはChromiumで描画が確実に
// 1回はさまるのを待つ定番の書き方。
function paintNow() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function commitImport(root) {
  const area = root.querySelector("#previewArea");
  area.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>取込中…</h3></div>
      <p class="hint">${state.preview.totalRows}件を処理しています。件数が多い場合、数秒〜十数秒かかることがあります。このまま画面を閉じずにお待ちください。</p>
    </div>
  `;
  await paintNow();

  const batchId = db.uid("batch");
  const existing = db.records;
  const result = importRows(state.parsed, db.itemMappings, db.stores, existing, batchId);

  // v2.26: 「1万件を取り込むとフリーズする」報告 — 実際は取込処理自体は
  // 一瞬で終わっていたが、続く db.records への保存（JSON化してlocalStorage
  // へ書き込み）がブラウザ機能のlocalStorage容量上限（Chromiumは1オリジン
  // あたり約10MB）を超えて例外を投げ、それをここで一切catchしていなかった
  // ため、「取込中…」の表示のまま何も起きず、フリーズしたように見えていた
  // （エラーも出ない・件数も反映されない）。1万件のCSVは項目数によっては
  // 数十件×1万行でこの上限に達し得る規模。ここでtry/catchし、少なくとも
  // 「本当に失敗した」ことが分かるようにする（db.records自体はJSON文字列化
  // →setItemが丸ごと失敗するかどうかなので、失敗時は書き込み前の状態のまま
  // ＝データが壊れたり中途半端に保存されたりはしない）。
  let saveError = null;
  try {
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
    });
    db.importBatches = batches;
    db.audit("csv_import", batchId, `${state.file.name} 成功${result.success}件 重複${result.duplicate}件 エラー${result.error}件`);
  } catch (err) {
    saveError = err;
  }

  if (saveError) {
    console.error("commitImport failed:", saveError);
    const isQuota = saveError.name === "QuotaExceededError" || saveError.code === 22;
    area.innerHTML = `
      <div class="card">
        <div class="card-title"><h3 style="color:var(--bad)">取込に失敗しました</h3></div>
        <p class="hint">${isQuota
          ? "ブラウザの保存容量の上限に達したため、データを保存できませんでした。一度に取り込む件数を減らす（CSVファイルを分割する）か、不要な古いデータの整理についてご相談ください。"
          : `処理中にエラーが発生しました: ${escapeHtml(saveError.message || String(saveError))}`}</p>
        <p class="hint">今回の取込は反映されていません（データは取込前の状態のまま保持されています）。もう一度お試しいただくか、状況を開発側にお伝えください。</p>
      </div>
    `;
    toast("取込に失敗しました" + (isQuota ? "（保存容量の上限）" : ""), "bad");
    return;
  }

  area.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>取込を完了しました</h3></div>
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
  renderHistory(root);
}
