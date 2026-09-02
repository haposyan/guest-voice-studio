// ============================================================================
// reportstudio.js — "Report Studio｜報告書": build an A4 Japanese PDF report
// (§4.9).
//
// PDF export uses WebView2's native headless PDF renderer (via js/native.js
// -> desktop/MainWindow.xaml.cs's printToPdfBlob) to get PDF bytes, then
// saves them via WebView2's own download manager rather than this app's own
// file I/O (see handlePrint()'s v2.14 comment below for why). When not
// running inside the desktop shell (e.g. this file opened in a plain
// browser for development), it falls back to window.print() exactly like
// the original web version did.
//
// Outlook integration (§4.10) was removed in v2.6: three different
// integration approaches (.eml file association, Outlook classic /m /a
// command-line switches, Outlook COM automation) were each tried across
// several rounds of real-machine testing and none reliably opened Outlook
// on the test machine — per explicit direction, this feature was dropped
// rather than continuing to chase it. The generated PDF (via 🖨 PDFとして保存
// below) is meant to be attached manually in whatever mail client the user
// already has open.
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds } from "../app.js";
import { filterRecords, computeMetrics, itemBreakdown, periodPreset, delta } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { renderWordCloud } from "../components/wordcloud.js";
import * as analysis from "../analysis.js";
import { escapeHtml, toast } from "../components/ui.js";
import { isDesktop, nativeInfo, printToPdfBlob, revealInExplorerToast, joinPath, saveBlobToPath, base64ToBytes } from "../native.js";

let cfg;
let currentReport = null;
// v2.17: caches the live #previewWrap DOM node (not just its HTML) so that
// navigating to another screen and back to Report Studio can reinsert the
// exact same node — same event listeners, same live input values (e.g. an
// edited summary, a selected 報告者) — instead of losing the generated
// preview and making the user regenerate it. See render()/generatePreview().
let cachedPreviewNode = null;

// v2.17: navigating away from Report Studio and back used to wipe out
// whatever preview had just been generated, forcing a re-generate every
// time — this only re-initializes cfg/currentReport the first time this
// screen is ever mounted in this app session (they're module-level
// variables, so they otherwise already survive navigation on their own).
// A fresh app launch naturally starts over anyway, since that's a new page
// load / new module instance — no explicit "reset on close" needed.
let everMounted = false;
export function mountReportStudio(root) {
  if (!everMounted) {
    everMounted = true;
    const thisM = periodPreset("thisMonth");
    const lastM = periodPreset("lastMonth");
    cfg = {
      storeIds: allowedStoreIds(),
      itemIds: [],
      periodStart: thisM.start, periodEnd: thisM.end,
      compareStart: lastM.start, compareEnd: lastM.end,
      type: "detail", // 要約版は廃止・詳細版のみ
      includedComments: [],
    };
    currentReport = null;
    cachedPreviewNode = null;
  }
  render(root);
  // Restore a previously generated preview when returning to this screen —
  // but only here (screen mount), not from render()'s other internal call
  // sites (filter-chip/date-field changes), which should still show the
  // empty state and require a fresh "プレビュー生成" click as before, since
  // cfg has changed and the cached preview no longer matches it.
  if (currentReport && cachedPreviewNode) {
    root.querySelector("#previewWrap")?.replaceWith(cachedPreviewNode);
  }
}

function render(root) {
  const items = db.itemMappings.filter((i) => i.enabled);
  const brand = db.brand;

  root.innerHTML = `
    <div class="card no-print">
      <div class="card-title"><h2>報告書の条件</h2></div>
      <p class="muted" style="margin-top:-6px">対象拠点: <strong>${escapeHtml(db.storeName(db.LOCAL_STORE_ID))}</strong></p>
      <div class="field-row">
        <div class="field"><label>報告期間 開始</label><input type="date" id="pStart" value="${cfg.periodStart}"></div>
        <div class="field"><label>報告期間 終了</label><input type="date" id="pEnd" value="${cfg.periodEnd}"></div>
        <div class="field"><label>比較期間 開始</label><input type="date" id="cStart" value="${cfg.compareStart}"></div>
        <div class="field"><label>比較期間 終了</label><input type="date" id="cEnd" value="${cfg.compareEnd}"></div>
      </div>
      <div style="margin-top:10px">
        <label>掲載項目</label>
        <div class="tag-list">
          <span class="chip ${!cfg.itemIds.length ? "active" : ""}" data-item-all>すべて</span>
          ${items.map((i) => `<span class="chip ${cfg.itemIds.includes(i.id) ? "active" : ""}" data-item="${i.id}">${escapeHtml(i.name)}</span>`).join("")}
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        <button class="btn primary" id="genBtn">プレビュー生成</button>
      </div>
    </div>
    <div id="previewWrap"></div>
  `;

  root.querySelector("[data-item-all]").onclick = () => { cfg.itemIds = []; render(root); };
  root.querySelectorAll("[data-item]").forEach((el) => el.onclick = () => { const id = el.dataset.item; const i = cfg.itemIds.indexOf(id); if (i >= 0) cfg.itemIds.splice(i, 1); else cfg.itemIds.push(id); render(root); });
  root.querySelector("#pStart").onchange = (e) => { cfg.periodStart = e.target.value; };
  root.querySelector("#pEnd").onchange = (e) => { cfg.periodEnd = e.target.value; };
  root.querySelector("#cStart").onchange = (e) => { cfg.compareStart = e.target.value; };
  root.querySelector("#cEnd").onchange = (e) => { cfg.compareEnd = e.target.value; };
  root.querySelector("#genBtn").onclick = () => generatePreview(root);
}

function autoSummaryText(m, prevM, storeNames, period) {
  const parts = [];
  parts.push(`${storeNames} における ${period} の回答は ${m.responseCount}件でした（回答者${m.responseCount}名中、平均評価 ${m.avg ?? "-"}）。`);
  if (prevM.avg != null && m.avg != null) {
    const d = delta(m.avg, prevM.avg);
    parts.push(d > 0 ? `前期間比で平均評価は${d}ポイント改善しています。` : d < 0 ? `前期間比で平均評価は${Math.abs(d)}ポイント低下しています。` : `前期間から平均評価に大きな変化はありません。`);
  }
  if (m.lowRate != null) {
    parts.push(`低評価率は${m.lowRate}%でした（回答者${m.ratedCount}名中）。`);
  }
  parts.push(`コメント記入率は${m.fillRate}%です。自由記述は全利用者の総意ではなく改善の兆候として扱っています。`);
  return parts.join("\n");
}

function generatePreview(root) {
  const bands = db.ratingBands;
  const user = db.currentUser();
  const items = cfg.itemIds.length ? db.itemMappings.filter((i) => cfg.itemIds.includes(i.id)) : db.itemMappings.filter((i) => i.enabled);
  const storeNames = db.storeName(db.LOCAL_STORE_ID);

  const cur = filterRecords(db.records, { storeIds: cfg.storeIds, itemIds: items.map((i) => i.id), start: cfg.periodStart, end: cfg.periodEnd }, bands);
  const prev = filterRecords(db.records, { storeIds: cfg.storeIds, itemIds: items.map((i) => i.id), start: cfg.compareStart, end: cfg.compareEnd }, bands);
  const m = computeMetrics(cur, bands);
  const pm = computeMetrics(prev, bands);
  const breakdown = itemBreakdown(cur, items, bands);
  const overrides = db.sentimentOverrides;
  const { words, commentCount } = computeWordFrequencies(cur, db.excludedWords, bands, overrides);
  const { words: prevWords } = computeWordFrequencies(prev, db.excludedWords, bands, overrides);
  const themeDiff = analysis.compareThemes(words, prevWords).filter((t) => t.status === "increasing" || t.status === "new").slice(0, 8);

  const tasks = db.tasks.filter((t) => cfg.storeIds.includes(t.storeId));
  const statusCounts = { "未対応": 0, "対応中": 0, "対応済み": 0, "効果確認済み": 0 };
  tasks.forEach((t) => statusCounts[t.status] = (statusCounts[t.status] || 0) + 1);
  const verified = tasks.filter((t) => t.status === "効果確認済み");

  const summaryText = autoSummaryText(m, pm, storeNames, `${cfg.periodStart}〜${cfg.periodEnd}`);
  currentReport = { cfg: { ...cfg }, m, pm, breakdown, words, themeDiff, statusCounts, verified, summaryText, storeNames, commentCount, lastPdfPath: null };

  const brand = db.brand;
  const villageName = db.storeName(db.LOCAL_STORE_ID);
  const hasRegisteredAuthors = !!(brand.reportAuthors && brand.reportAuthors.length);
  const authorOptions = hasRegisteredAuthors ? brand.reportAuthors : [user.name];
  const wrap = root.querySelector("#previewWrap");
  wrap.innerHTML = `
    <div class="card no-print">
      <div class="card-title"><h3>体裁設定</h3></div>
      <div class="field-row">
        <div class="field"><label>村名</label><input type="text" id="brandCompany" value="${escapeHtml(villageName)}" disabled title="Settings＞基本情報の村名から反映されます"></div>
        <div class="field"><label>報告者</label>
          <select id="brandAuthor">
            ${authorOptions.map((a) => `<option value="${escapeHtml(a)}" ${a === user.name ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
          </select>
        </div>
      </div>
      ${!hasRegisteredAuthors ? `<p class="hint" style="color:var(--info)">報告者が未登録のため、現在はこのPCの利用者名（${escapeHtml(user.name)}）を表示しています。
        <a href="#settings">Settings＞基本情報</a> で報告者を登録すると、ここでプルダウンから選べるようになります。</p>` : ""}
      <div class="field"><label>概要（自動生成・編集可）</label><textarea id="summaryEdit" rows="5">${escapeHtml(summaryText)}</textarea></div>
      <button class="btn small" id="applyEdit">プレビューに反映</button>
      <hr class="divider">
      <input type="text" id="commentSearch" placeholder="コメントを検索して掲載候補に追加">
      <div id="commentSearchResults" class="stack" style="max-height:140px;overflow-y:auto;margin-top:6px"></div>
      <div style="margin-top:8px"><label>掲載予定コメント（${cfg.includedComments.length}件）</label>
        <div id="includedList" class="stack" style="max-height:140px;overflow-y:auto"></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px;gap:8px">
        <button class="btn gold" id="printBtn">🖨 PDFデータを印刷・保存</button>
      </div>
      <p class="hint" style="text-align:right;margin-top:6px">保存したPDFは、お使いのメールソフトで手動で添付してお送りください。<br>印刷ダイアログが開いたら、プリンターの選択欄から「PDFとして保存」（または「Microsoft Print to PDF」）を選ぶと、PDFファイルとして保存できます。</p>
    </div>
    <div class="report-page" id="reportPage"></div>
  `;

  wireCommentPicker(wrap, root);
  wrap.querySelector("#applyEdit").onclick = () => { currentReport.summaryText = wrap.querySelector("#summaryEdit").value; renderReportPage(wrap); };
  wrap.querySelector("#brandAuthor").onchange = (e) => { currentReport.author = e.target.value; renderReportPage(wrap); };
  wrap.querySelector("#printBtn").onclick = () => handlePrint(wrap);

  currentReport.author = user.name;
  renderReportPage(wrap);
  cachedPreviewNode = wrap; // see mountReportStudio() — restores this exact node on remount
}

function wireCommentPicker(wrap, root) {
  const search = wrap.querySelector("#commentSearch");
  const results = wrap.querySelector("#commentSearchResults");
  const list = wrap.querySelector("#includedList");
  function renderList() {
    const recs = db.records.filter((r) => cfg.includedComments.includes(r.id));
    list.innerHTML = recs.map((r) => `<div class="comment-item"><div class="meta">${r.date} / ★${r.rating??"-"} <button class="btn small ghost" data-remove="${r.id}">削除</button></div><div>${escapeHtml(r.comment)}</div></div>`).join("") || `<div class="hint">未選択</div>`;
    list.querySelectorAll("[data-remove]").forEach((b) => b.onclick = () => { const i = cfg.includedComments.indexOf(b.dataset.remove); if (i>=0) cfg.includedComments.splice(i,1); renderList(); renderReportPage(wrap); });
  }
  search.oninput = () => {
    const q = search.value.trim();
    if (!q) { results.innerHTML = ""; return; }
    const hits = db.records.filter((r) => r.comment && r.comment.includes(q) && !cfg.includedComments.includes(r.id)).slice(0, 15);
    results.innerHTML = hits.map((r) => `<div class="comment-item"><div class="meta">${r.date} / ★${r.rating??"-"} <button class="btn small" data-add="${r.id}">掲載に追加</button></div><div>${escapeHtml(r.comment)}</div></div>`).join("");
    results.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => { cfg.includedComments.push(b.dataset.add); search.value=""; results.innerHTML=""; renderList(); renderReportPage(wrap); });
  };
  renderList();
}

function renderReportPage(wrap) {
  const r = currentReport;
  const brand = db.brand;
  const page = wrap.querySelector("#reportPage");
  const includedRecs = db.records.filter((rec) => r.cfg.includedComments.includes(rec.id));
  page.innerHTML = `
    <div class="report-header">
      <div>
        <div class="company">${escapeHtml(brand.company || "一般財団法人休暇村協会")}</div>
        <h1 style="margin:4px 0">お客様の声 月次報告</h1>
        <div class="muted">${escapeHtml(r.storeNames)} ／ ${r.cfg.periodStart} ～ ${r.cfg.periodEnd}</div>
      </div>
      <div class="muted" style="text-align:right">
        <div>報告者: ${escapeHtml(r.author||"")}</div>
        <div>作成日: ${new Date().toLocaleDateString("ja-JP")}</div>
      </div>
    </div>

    <h3>概要</h3>
    <p style="white-space:pre-wrap">${escapeHtml(r.summaryText)}</p>

    <div class="grid cols-4" style="margin:14px 0">
      <div class="stat-tile"><div class="label">回答数</div><div class="value">${r.m.responseCount}</div></div>
      <div class="stat-tile"><div class="label">平均評価</div><div class="value">${r.m.avg ?? "-"}</div></div>
      <div class="stat-tile"><div class="label">低評価率</div><div class="value">${r.m.lowRate ?? "-"}%</div></div>
      <div class="stat-tile"><div class="label">コメント記入率</div><div class="value">${r.m.fillRate}%</div></div>
    </div>

    <h3>項目別結果</h3>
    <table><thead><tr><th>項目</th><th>回答数</th><th>平均</th><th>低評価率</th></tr></thead><tbody>
      ${r.breakdown.map((b) => `<tr><td>${escapeHtml(b.item.name)}</td><td>${b.metrics.responseCount}</td><td>${b.metrics.avg??"-"}</td><td>${b.metrics.lowRate??"-"}%</td></tr>`).join("")}
    </tbody></table>

    <h3 style="margin-top:16px">コメント分析</h3>
    <p class="muted">コメント${r.commentCount}件を分析（簡易語抽出）</p>
    ${renderWordCloud(r.words, { limit: 25 })}
    ${r.themeDiff.length ? `<p style="margin-top:8px"><strong>増加している/新規のテーマ:</strong> ${r.themeDiff.map((t) => escapeHtml(t.word)).join("、")}</p>` : ""}

    ${r.cfg.type === "detail" ? `
    <h3 style="margin-top:16px">改善対応状況</h3>
    <table><thead><tr><th>状態</th><th>件数</th></tr></thead><tbody>
      ${Object.entries(r.statusCounts).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
    </tbody></table>
    ${r.verified.length ? `<h4>効果確認済みの改善課題</h4><ul>${r.verified.map((t) => `<li>${escapeHtml(t.title)}（平均評価差: ${t.effect?.avgDiff ?? "-"}）</li>`).join("")}</ul>` : ""}
    ` : ""}

    ${includedRecs.length ? `
    <h3 style="margin-top:16px">元コメント（選択分のみ掲載）</h3>
    <div class="stack">${includedRecs.map((rec) => `<div class="comment-item"><div class="meta">${rec.date} / ★${rec.rating??"-"}</div><div>${escapeHtml(rec.comment)}</div></div>`).join("")}</div>
    ` : ""}
  `;
}

function saveReportRecord() {
  const r = currentReport;
  const rec = {
    id: db.uid("rpt"),
    storeIds: r.cfg.storeIds,
    periodStart: r.cfg.periodStart,
    periodEnd: r.cfg.periodEnd,
    compareStart: r.cfg.compareStart,
    compareEnd: r.cfg.compareEnd,
    items: r.cfg.itemIds,
    type: r.cfg.type,
    summaryText: r.summaryText,
    includedComments: r.cfg.includedComments,
    author: r.author,
    createdAt: new Date().toISOString(),
  };
  const reports = db.reports; reports.unshift(rec); db.reports = reports;
  db.audit("report_generate", rec.id, `${r.storeNames} ${r.cfg.periodStart}〜${r.cfg.periodEnd}`);
  currentReport.savedId = rec.id;
  return rec;
}

// v2.16: 例：20260901-20260902GuestVoiceReport（報告期間の開始日〜終了日、
// 西暦8桁ずつ）。以前は「保存を押した今の時刻」だったが、報告期間の方が
// ファイルを見分ける手がかりとして分かりやすいとのフィードバックで変更。
// さらにその前の「お客様の声_村名_期間」は、同じ条件で複数回保存すると
// 同名になり上書きされがちだったため一度廃止した経緯がある — 期間ベースの
// 名前でも同じ問題はあり得るが（同じ期間で２回保存すると同名になる）、
// 見分けやすさを優先するとの判断。
function reportFileBaseName() {
  const compact = (d) => (d || "").replace(/-/g, "");
  return `${compact(currentReport?.cfg?.periodStart)}-${compact(currentReport?.cfg?.periodEnd)}GuestVoiceReport`;
}

// v2.10: 保存の都度「名前を付けて保存」ダイアログを出す方式は、複数ラウンドの
// 実機テストで「押しても反応しない／選択する方法がない」という報告が続いた
// （WebView2にホストされたWPFのSaveFileDialogが、アプリのウィンドウの背面に
// 非アクティブな状態で開いてしまい、事実上操作不能になっていたとみられる）。
// 致命的な不具合だったため、ダイアログに依存しない方式に変更：設定＞保存先の
// 「書き出し先フォルダ」（未設定ならReportsフォルダ既定値）へ確認なしで直接
// 保存し、保存後に自動でエクスプローラーを開いてファイルを選択表示する。
//
// v2.14: それでも「保存しています」の後タイムアウトになる、という報告が
// 続いた。実機で「保存先を変更」「フォルダを選択」（いずれもダイアログを
// 開くだけの機能）まで同様にタイムアウトすることが判明し、この自作
// exe（未署名）自体のファイル書き込み・ダイアログ表示がセキュリティソフト
// 等に広くブロックされている可能性が高いと判断。ディスクへの実際の書き込み
// を、この自作exeのFile.WriteAllBytesではなく、WebView2自身（署名済みの
// msedgewebview2.exe）のダウンロード機構に完全に肩代わりさせる方式に変更
// した。PDFのバイト列だけをWebView2から受け取り、Blobダウンロードとして
// 発火させ、保存先パスの指定はCoreWebView2.DownloadStartingで横取りする
// （native.js の saveBlobToPath 参照）。
// v2.16: Chromium's print-to-PDF flow suggests document.title as the
// default filename in the resulting Save As dialog — a well-known trick for
// controlling that suggestion without any native involvement. Restores the
// real title on "afterprint", which fires whether the user actually saved
// or cancelled.
function printViaDialog(suggestedBaseName) {
  const originalTitle = document.title;
  document.title = suggestedBaseName;
  const restore = () => { document.title = originalTitle; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  setTimeout(restore, 20000); // safety net in case afterprint never fires
  window.print();
}

async function handlePrint(wrap) {
  saveReportRecord();
  const suggested = reportFileBaseName();
  if (!isDesktop) {
    printViaDialog(suggested);
    return;
  }
  const exportDir = (db.brand.exportDir || nativeInfo.reportsDir || "").trim();
  if (!exportDir) {
    toast("保存先フォルダが確認できません。設定画面をご確認ください。", "bad");
    return;
  }
  const path = joinPath(exportDir, suggested + ".pdf");
  toast("印刷用PDFの作成中…", "");
  const result = await printToPdfBlob();
  if (!result.ok) {
    // v2.15: the headless PDF path (printToPdfBlob, backed by WebView2's
    // PrintToPdfStreamAsync) kept failing/timing out across every round of
    // real-machine testing, unlike window.print() — which opens Chromium's
    // own interactive print UI, a completely different, far more battle-
    // tested code path (used by every website's print button) that isn't
    // driven through this app's own C# host at all. Falling back to it
    // automatically means the user still gets a working way to make a PDF
    // (pick "PDFとして保存" as the printer) even though it now needs one
    // extra manual step instead of being fully automatic.
    // v2.17: kept this toast free of internal detail ("timeout" etc.) —
    // it reads the same either way, since the user doesn't need to know
    // which failure mode happened, just what to do next.
    toast("印刷用PDFの作成中…", "");
    setTimeout(() => printViaDialog(suggested), 1200);
    return;
  }
  try {
    const blob = new Blob([base64ToBytes(result.base64)], { type: "application/pdf" });
    await saveBlobToPath(path, blob);
    currentReport.lastPdfPath = path;
    toast(`PDFを保存しました: ${path}`, "good");
    setTimeout(() => revealInExplorerToast(path), 800);
  } catch (err) {
    toast("PDFの保存に失敗しました: " + err.message, "bad");
  }
}

