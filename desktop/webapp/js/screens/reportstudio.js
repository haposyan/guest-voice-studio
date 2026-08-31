// ============================================================================
// reportstudio.js — "Report Studio｜報告書": build an A4 Japanese PDF report
// and create an Outlook draft (§4.9, §4.10).
//
// v2/desktop: PDF export now uses WebView2's native headless
// CoreWebView2.PrintToPdfAsync (via js/native.js -> desktop/MainWindow.xaml.cs)
// instead of the browser print dialog — a real file, no user dialog required
// beyond choosing where to save it. When not running inside the desktop
// shell (e.g. this file opened in a plain browser for development), it falls
// back to window.print() exactly like the original web version did.
//
// Outlook integration (§4.10): MAIL-05 fallback is the primary path — an
// .eml is generated with the PDF actually attached (js/eml.js) and, in the
// desktop shell, opened with the OS default handler (MAIL-04: if that's
// Outlook, this hands it a new message). Outside the desktop shell, the
// mailto: fallback from the original web version is kept (no attachment
// possible there — the user is told to attach the PDF manually).
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds, can } from "../app.js";
import { filterRecords, computeMetrics, itemBreakdown, periodPreset, delta } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { renderWordCloud } from "../components/wordcloud.js";
import * as analysis from "../analysis.js";
import { escapeHtml, toast } from "../components/ui.js";
import { isDesktop, nativeInfo, printToPdf, pickSaveFile, readFileBytes, writeFileBytes, openMailDraft, textToBase64 } from "../native.js";
import { buildEml } from "../eml.js";

let cfg;
let currentReport = null;

export function mountReportStudio(root) {
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
  render(root);
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
        <button class="btn gold" id="printBtn">🖨 PDFとして保存</button>
        ${can("createDraft") ? `<button class="btn primary" id="draftBtn">✉ Outlookで送る</button>` : ""}
      </div>
    </div>
    <div class="report-page" id="reportPage"></div>
  `;

  wireCommentPicker(wrap, root);
  wrap.querySelector("#applyEdit").onclick = () => { currentReport.summaryText = wrap.querySelector("#summaryEdit").value; renderReportPage(wrap); };
  wrap.querySelector("#brandAuthor").onchange = (e) => { currentReport.author = e.target.value; renderReportPage(wrap); };
  wrap.querySelector("#printBtn").onclick = () => handlePrint(wrap);
  const draftBtn = wrap.querySelector("#draftBtn");
  if (draftBtn) draftBtn.onclick = () => sendViaOutlook(wrap);

  currentReport.author = user.name;
  renderReportPage(wrap);
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

function reportFileBaseName() {
  const r = currentReport;
  return `お客様の声_${r.storeNames}_${r.cfg.periodStart}_${r.cfg.periodEnd}`.replace(/[\\/:*?"<>|]/g, "_");
}

async function handlePrint(wrap) {
  saveReportRecord();
  if (!isDesktop) {
    window.print();
    return;
  }
  const suggested = reportFileBaseName() + ".pdf";
  const picked = await pickSaveFile(suggested, "PDF ファイル (*.pdf)|*.pdf", nativeInfo.reportsDir);
  if (!picked.ok) return;
  toast("PDFを作成しています…", "");
  const result = await printToPdf(picked.path);
  if (result.ok) {
    currentReport.lastPdfPath = picked.path;
    toast(`PDFを保存しました: ${picked.path}`, "good");
  } else {
    toast("PDFの作成に失敗しました: " + (result.error || ""), "bad");
  }
}

async function ensurePdfForDraft() {
  if (currentReport.lastPdfPath) return currentReport.lastPdfPath;
  const path = `${nativeInfo.reportsDir}\\${reportFileBaseName()}_${Date.now()}.pdf`;
  const result = await printToPdf(path);
  if (!result.ok) throw new Error(result.error || "PDF生成に失敗しました");
  currentReport.lastPdfPath = path;
  return path;
}

// v2.2: 宛先の事前登録・テンプレート選択は廃止。件名・本文はその場で組み立て、
// 宛先(To)は空欄のままOutlook等の既定メールソフトを開く（そのまま送信先を
// 手入力してもらえば十分、という実機フィードバックを反映）。
function buildSubjectAndBody(rec) {
  const period = `${rec.periodStart}〜${rec.periodEnd}`;
  const subject = `【${currentReport.storeNames}】お客様の声 月次報告（${period}）`;
  const body = `いつもお世話になっております。\n${currentReport.storeNames}の${period}分レポートを添付いたします。\n\n${currentReport.author || ""}`;
  return { subject, body };
}

async function sendViaOutlook(wrap) {
  const rec = currentReport.savedId ? db.reports.find((x) => x.id === currentReport.savedId) : saveReportRecord();
  const { subject, body } = buildSubjectAndBody(rec);
  if (!isDesktop) {
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + "\n\n※PDFレポートを手動で添付してください。")}`;
    window.location.href = mailto;
    logDraft(rec, "mailto");
    toast("メール作成画面を開きました。PDFは手動で添付してください。", "good");
    return;
  }
  try {
    toast("PDFを生成し、Outlookで開く下書きを作成しています…", "");
    const pdfPath = await ensurePdfForDraft();

    // Outlook (classic) is launched directly with /m (subject/body) and /a
    // (attach pdfPath) when installed — this is tried first because it
    // doesn't depend on any file-type association being configured. The
    // .eml is still built as a fallback for when Outlook classic isn't
    // installed (e.g. "new Outlook"-only machines, Windows Mail).
    const pdfResult = await readFileBytes(pdfPath);
    if (!pdfResult.ok) throw new Error(pdfResult.error || "PDFの読み込みに失敗しました");
    const eml = buildEml({
      to: "", cc: "", subject, bodyText: body,
      attachmentBase64: pdfResult.base64, attachmentName: reportFileBaseName() + ".pdf",
    });
    const emlPath = `${nativeInfo.reportsDir}\\${reportFileBaseName()}_${Date.now()}.eml`;
    const writeResult = await writeFileBytes(emlPath, textToBase64(eml));
    if (!writeResult.ok) throw new Error(writeResult.error || "EMLの保存に失敗しました");

    const result = await openMailDraft({ subject, body, attachmentPath: pdfPath, emlPath });
    if (!result.ok) {
      toast(
        `メールソフトを起動できませんでした。PDFは保存済みです（${pdfPath}）。手動でメールに添付してください。`,
        "bad"
      );
      return;
    }
    logDraft(rec, result.method || "eml");
    toast("Outlook（既定のメールソフト）で下書きを開きました。宛先を入力してご確認のうえ送信してください。", "good");
  } catch (err) {
    toast("下書き作成に失敗しました: " + err.message, "bad");
  }
}

function logDraft(rec, method) {
  const dh = db.draftHistory;
  dh.unshift({ id: db.uid("draft"), reportId: rec.id, recipientNames: "（宛先は送信時に入力）", createdAt: new Date().toISOString(), user: db.currentUser().name, method });
  db.draftHistory = dh;
  db.audit("draft_create", rec.id, "Outlookで送る");
}
