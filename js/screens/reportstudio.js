// ============================================================================
// reportstudio.js — "Report Studio｜報告書": build an A4 Japanese PDF report
// (via print) and create an Outlook draft (§4.9, §4.10).
//
// PDF generation note: no PDF library is bundled (no npm/build tooling in
// this environment — see README). Instead the report renders as a styled
// A4-proportioned page with a dedicated @media print stylesheet; "PDFとして
//保存" calls window.print(), and Edge/Chrome's built-in "Microsoft Print to
// PDF" / "Save as PDF" destination produces the actual file. This satisfies
// MAIL-05's fallback path directly.
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds, can } from "../app.js";
import { filterRecords, computeMetrics, itemBreakdown, periodPreset, delta } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { renderWordCloud } from "../components/wordcloud.js";
import * as analysis from "../analysis.js";
import { openModal, closeModal, escapeHtml, toast } from "../components/ui.js";

let cfg;
let currentReport = null;

export function mountReportStudio(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  const thisM = periodPreset("thisMonth");
  const lastM = periodPreset("lastMonth");
  cfg = {
    storeIds: [myStores[0]].filter(Boolean),
    itemIds: [],
    periodStart: thisM.start, periodEnd: thisM.end,
    compareStart: lastM.start, compareEnd: lastM.end,
    type: "summary",
    includedComments: [],
  };
  currentReport = null;
  render(root);
}

function render(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  const stores = db.stores.filter((s) => myStores.includes(s.id));
  const items = db.itemMappings.filter((i) => i.enabled);
  const brand = db.brand;

  root.innerHTML = `
    <div class="card no-print">
      <div class="card-title"><h2>報告書の条件</h2></div>
      <div>
        <label>対象拠点</label>
        <div class="tag-list">${stores.map((s) => `<span class="chip ${cfg.storeIds.includes(s.id) ? "active" : ""}" data-store="${s.id}">${escapeHtml(s.name)}</span>`).join("")}</div>
      </div>
      <div class="field-row" style="margin-top:10px">
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
      <div class="field-row" style="margin-top:10px">
        <div class="field">
          <label>種別</label>
          <div class="pill-toggle">
            <button data-type="summary" class="${cfg.type === "summary" ? "active" : ""}">要約版（1〜2ページ）</button>
            <button data-type="detail" class="${cfg.type === "detail" ? "active" : ""}">詳細版</button>
          </div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        <button class="btn primary" id="genBtn">プレビュー生成</button>
      </div>
    </div>
    <div id="previewWrap"></div>
  `;

  root.querySelectorAll("[data-store]").forEach((el) => el.onclick = () => { const id = el.dataset.store; const i = cfg.storeIds.indexOf(id); if (i >= 0) cfg.storeIds.splice(i, 1); else cfg.storeIds.push(id); render(root); });
  root.querySelector("[data-item-all]").onclick = () => { cfg.itemIds = []; render(root); };
  root.querySelectorAll("[data-item]").forEach((el) => el.onclick = () => { const id = el.dataset.item; const i = cfg.itemIds.indexOf(id); if (i >= 0) cfg.itemIds.splice(i, 1); else cfg.itemIds.push(id); render(root); });
  root.querySelectorAll("[data-type]").forEach((el) => el.onclick = () => { cfg.type = el.dataset.type; render(root); });
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
  const storeNames = cfg.storeIds.map((id) => db.storeName(id)).join("、") || "（拠点未選択）";

  const cur = filterRecords(db.records, { storeIds: cfg.storeIds, itemIds: items.map((i) => i.id), start: cfg.periodStart, end: cfg.periodEnd }, bands);
  const prev = filterRecords(db.records, { storeIds: cfg.storeIds, itemIds: items.map((i) => i.id), start: cfg.compareStart, end: cfg.compareEnd }, bands);
  const m = computeMetrics(cur, bands);
  const pm = computeMetrics(prev, bands);
  const breakdown = itemBreakdown(cur, items, bands);
  const { words, commentCount } = computeWordFrequencies(cur, db.excludedWords, bands);
  const { words: prevWords } = computeWordFrequencies(prev, db.excludedWords, bands);
  const themeDiff = analysis.compareThemes(words, prevWords).filter((t) => t.status === "increasing" || t.status === "new").slice(0, 8);

  const tasks = db.tasks.filter((t) => cfg.storeIds.includes(t.storeId));
  const statusCounts = { "未対応": 0, "対応中": 0, "対応済み": 0, "効果確認済み": 0 };
  tasks.forEach((t) => statusCounts[t.status] = (statusCounts[t.status] || 0) + 1);
  const verified = tasks.filter((t) => t.status === "効果確認済み");

  const summaryText = autoSummaryText(m, pm, storeNames, `${cfg.periodStart}〜${cfg.periodEnd}`);
  currentReport = { cfg: { ...cfg }, m, pm, breakdown, words, themeDiff, statusCounts, verified, summaryText, storeNames, commentCount };

  const brand = db.brand;
  const wrap = root.querySelector("#previewWrap");
  wrap.innerHTML = `
    <div class="card no-print">
      <div class="card-title"><h3>体裁設定</h3></div>
      <div class="field-row">
        <div class="field"><label>会社名</label><input type="text" id="brandCompany" value="${escapeHtml(brand.company||"")}"></div>
        <div class="field"><label>作成者</label><input type="text" id="brandAuthor" value="${escapeHtml(user.name)}"></div>
      </div>
      <div class="field"><label>概要（自動生成・編集可）</label><textarea id="summaryEdit" rows="5">${escapeHtml(summaryText)}</textarea></div>
      <button class="btn small" id="applyEdit">プレビューに反映</button>
      <hr class="divider">
      <p class="hint">元コメントは初期状態では掲載されません。掲載したいコメントのみ選択してください。</p>
      <input type="text" id="commentSearch" placeholder="コメントを検索して掲載候補に追加">
      <div id="commentSearchResults" class="stack" style="max-height:140px;overflow-y:auto;margin-top:6px"></div>
      <div style="margin-top:8px"><label>掲載予定コメント（${cfg.includedComments.length}件）</label>
        <div id="includedList" class="stack" style="max-height:140px;overflow-y:auto"></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px;gap:8px">
        <button class="btn gold" id="printBtn">🖨 PDFとして保存（印刷）</button>
        ${can("createDraft") ? `<button class="btn primary" id="draftBtn">✉ Outlookで下書きを作成</button>` : ""}
      </div>
    </div>
    <div class="report-page" id="reportPage"></div>
  `;

  wireCommentPicker(wrap, root);
  wrap.querySelector("#applyEdit").onclick = () => { currentReport.summaryText = wrap.querySelector("#summaryEdit").value; renderReportPage(wrap); };
  wrap.querySelector("#brandCompany").onchange = (e) => { db.brand = { ...db.brand, company: e.target.value }; renderReportPage(wrap); };
  wrap.querySelector("#brandAuthor").onchange = (e) => { currentReport.author = e.target.value; renderReportPage(wrap); };
  wrap.querySelector("#printBtn").onclick = () => { saveReportRecord(); window.print(); };
  const draftBtn = wrap.querySelector("#draftBtn");
  if (draftBtn) draftBtn.onclick = () => openDraftModal(root);

  currentReport.author = user.name;
  renderReportPage(wrap);
}

function wireCommentPicker(wrap, root) {
  const search = wrap.querySelector("#commentSearch");
  const results = wrap.querySelector("#commentSearchResults");
  const list = wrap.querySelector("#includedList");
  function renderList() {
    const recs = db.records.filter((r) => cfg.includedComments.includes(r.id));
    list.innerHTML = recs.map((r) => `<div class="comment-item"><div class="meta">${escapeHtml(db.storeName(r.storeId))} / ${r.date} / ★${r.rating??"-"} <button class="btn small ghost" data-remove="${r.id}">削除</button></div><div>${escapeHtml(r.comment)}</div></div>`).join("") || `<div class="hint">未選択</div>`;
    list.querySelectorAll("[data-remove]").forEach((b) => b.onclick = () => { const i = cfg.includedComments.indexOf(b.dataset.remove); if (i>=0) cfg.includedComments.splice(i,1); renderList(); wrap.querySelector("[id^=includedList]") && renderReportPage(wrap); });
  }
  search.oninput = () => {
    const q = search.value.trim();
    if (!q) { results.innerHTML = ""; return; }
    const hits = db.records.filter((r) => r.comment && r.comment.includes(q) && !cfg.includedComments.includes(r.id)).slice(0, 15);
    results.innerHTML = hits.map((r) => `<div class="comment-item"><div class="meta">${escapeHtml(db.storeName(r.storeId))} / ${r.date} / ★${r.rating??"-"} <button class="btn small" data-add="${r.id}">掲載に追加</button></div><div>${escapeHtml(r.comment)}</div></div>`).join("");
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
        <div class="company">${escapeHtml(brand.company || "会社名未設定")}</div>
        <h1 style="margin:4px 0">お客様の声 月次報告</h1>
        <div class="muted">${escapeHtml(r.storeNames)} ／ ${r.cfg.periodStart} ～ ${r.cfg.periodEnd}</div>
      </div>
      <div class="muted" style="text-align:right">
        <div>作成者: ${escapeHtml(r.author||"")}</div>
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
    <div class="stack">${includedRecs.map((rec) => `<div class="comment-item"><div class="meta">${escapeHtml(db.storeName(rec.storeId))} / ${rec.date} / ★${rec.rating??"-"}</div><div>${escapeHtml(rec.comment)}</div></div>`).join("")}</div>
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

function openDraftModal(root) {
  const rec = currentReport.savedId ? db.reports.find((x) => x.id === currentReport.savedId) : saveReportRecord();
  const candidates = db.recipients.filter((rc) => !rc.storeIds.length || rc.storeIds.some((id) => cfg.storeIds.includes(id)));
  openModal(`
    <div class="modal-header"><h3>Outlook下書きを作成</h3><button data-close>&times;</button></div>
    <p class="hint">未連携環境では、宛先・件名・本文入りのメール作成画面を開きます。PDFは事前に「PDFとして保存」しておき、手動で添付してください（MAIL-05）。</p>
    <div class="field"><label>宛先を選択</label>
      <select id="recipientSelect">${candidates.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} &lt;${c.email}&gt;</option>`).join("") || `<option value="">登録済み宛先がありません</option>`}</select>
    </div>
    <div id="warnArea"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      <button class="btn ghost" data-cancel>キャンセル</button>
      <button class="btn primary" id="openMail" ${candidates.length ? "" : "disabled"}>メール作成画面を開く</button>
    </div>
  `, { onMount: (r) => {
    r.querySelector("[data-close]").onclick = closeModal;
    r.querySelector("[data-cancel]").onclick = closeModal;
    const sel = r.querySelector("#recipientSelect");
    function checkWarn() {
      const c = candidates.find((x) => x.id === sel.value);
      const warnArea = r.querySelector("#warnArea");
      if (c && !c.email.endsWith("@" + (db.brand.companyDomain || "example.co.jp"))) {
        warnArea.innerHTML = `<p class="hint" style="color:var(--warn)">⚠ 社外アドレス宛の可能性があります（MAIL-06）。送信前によく確認してください。</p>`;
      } else warnArea.innerHTML = "";
    }
    sel.onchange = checkWarn; checkWarn();
    r.querySelector("#openMail").onclick = () => {
      const c = candidates.find((x) => x.id === sel.value);
      if (!c) return;
      const period = `${rec.periodStart}〜${rec.periodEnd}`;
      const subject = c.subjectTemplate.replace("{{store}}", currentReport.storeNames).replace("{{period}}", period);
      const body = c.bodyTemplate.replace("{{store}}", currentReport.storeNames).replace("{{period}}", period).replace("{{author}}", currentReport.author || "");
      const mailto = `mailto:${encodeURIComponent(c.email)}?cc=${encodeURIComponent(c.cc||"")}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + "\n\n※PDFレポートを手動で添付してください。")}`;
      window.location.href = mailto;
      const dh = db.draftHistory;
      dh.unshift({ id: db.uid("draft"), reportId: rec.id, recipientNames: c.name, createdAt: new Date().toISOString(), user: db.currentUser().name, method: "mailto" });
      db.draftHistory = dh;
      db.audit("draft_create", rec.id, `宛先: ${c.name}`);
      toast("メール作成画面を開きました。PDFは手動で添付してください。", "good");
      closeModal();
    };
  }});
}
