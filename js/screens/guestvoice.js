// ============================================================================
// guestvoice.js — "Guest Voice｜お客様の声" screen: filtering, aggregation,
// word cloud / ranking, original-comment drill-down (§4.4, §4.5).
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds } from "../app.js";
import { filterRecords, computeMetrics, itemBreakdown, periodPreset } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { renderWordCloud, renderWordRanking } from "../components/wordcloud.js";
import { ratingDistributionChart } from "../components/charts.js";
import { openModal, closeModal, escapeHtml, toast } from "../components/ui.js";

let filters;

export function mountGuestVoice(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  filters = {
    storeIds: user.role === "本部管理者" ? [] : [...myStores],
    itemIds: [],
    periodKey: "thisMonth",
    start: periodPreset("thisMonth").start,
    end: periodPreset("thisMonth").end,
    band: "all",
    commentFilter: "all",
  };
  render(root);
}

function render(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  const stores = db.stores.filter((s) => myStores.includes(s.id));
  const items = db.itemMappings.filter((i) => i.enabled);
  const bands = db.ratingBands;

  const effectiveStoreIds = filters.storeIds.length ? filters.storeIds : myStores;
  const effectiveItemIds = filters.itemIds.length ? filters.itemIds : items.map((i) => i.id);

  const all = filterRecords(db.records, {
    storeIds: effectiveStoreIds, itemIds: effectiveItemIds,
    start: filters.start, end: filters.end, band: filters.band, commentFilter: filters.commentFilter,
  }, bands);

  const metrics = computeMetrics(all, bands);
  const breakdown = itemBreakdown(all, items.filter((i) => effectiveItemIds.includes(i.id)), bands);
  const { words, commentCount } = computeWordFrequencies(all, db.excludedWords, bands);

  root.innerHTML = `
    <div class="card">
      <div class="card-title"><h2>絞り込み</h2><span class="muted" style="font-size:.8rem">${all.length}件のレコードが該当</span></div>
      <div class="stack">
        <div>
          <label>拠点${user.role === "本部管理者" ? "" : "（権限範囲）"}</label>
          <div class="tag-list" id="storeChips">
            ${user.role === "本部管理者" ? `<span class="chip ${!filters.storeIds.length ? "active" : ""}" data-store-all>全拠点</span>` : ""}
            ${stores.map((s) => `<span class="chip ${filters.storeIds.includes(s.id) ? "active" : ""}" data-store="${s.id}">${escapeHtml(s.name)}</span>`).join("")}
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>期間</label>
            <div class="pill-toggle" id="periodPreset">
              <button data-period="thisMonth" class="${filters.periodKey === "thisMonth" ? "active" : ""}">今月</button>
              <button data-period="lastMonth" class="${filters.periodKey === "lastMonth" ? "active" : ""}">先月</button>
              <button data-period="lastYearSameMonth" class="${filters.periodKey === "lastYearSameMonth" ? "active" : ""}">前年同月</button>
              <button data-period="custom" class="${filters.periodKey === "custom" ? "active" : ""}">カスタム</button>
            </div>
          </div>
          <div class="field"><label>開始日</label><input type="date" id="startDate" value="${filters.start || ""}"></div>
          <div class="field"><label>終了日</label><input type="date" id="endDate" value="${filters.end || ""}"></div>
        </div>
        <div>
          <label>項目</label>
          <div class="tag-list">
            <span class="chip ${!filters.itemIds.length ? "active" : ""}" data-item-all>すべて選択</span>
            ${items.map((i) => `<span class="chip ${filters.itemIds.includes(i.id) ? "active" : ""}" data-item="${i.id}">${escapeHtml(i.name)}</span>`).join("")}
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>評価帯</label>
            <div class="tag-list">
              ${["all","low","mid","high"].map((b) => `<span class="chip ${filters.band === b ? "active gold" : ""}" data-band="${b}">${{all:"すべて",low:"低評価(1-2)",mid:"中立(3)",high:"高評価(4-5)"}[b]}</span>`).join("")}
            </div>
          </div>
          <div class="field">
            <label>コメント</label>
            <div class="tag-list">
              ${["all","only","none"].map((c) => `<span class="chip ${filters.commentFilter === c ? "active" : ""}" data-comment="${c}">${{all:"すべて",only:"ありのみ",none:"なしを含む"}[c]}</span>`).join("")}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid cols-5">
      <div class="stat-tile"><div class="label">回答数</div><div class="value">${metrics.responseCount}<span class="unit">件</span></div></div>
      <div class="stat-tile"><div class="label">コメント数</div><div class="value">${metrics.commentCount}<span class="unit">件</span></div></div>
      <div class="stat-tile"><div class="label">コメント記入率</div><div class="value">${metrics.fillRate}<span class="unit">%</span></div></div>
      <div class="stat-tile"><div class="label">平均評価</div><div class="value">${metrics.avg ?? "-"}<span class="unit">/ 中央値 ${metrics.median ?? "-"}</span></div></div>
      <div class="stat-tile"><div class="label">低評価率</div><div class="value" style="color:${metrics.lowRate > 20 ? "var(--bad)" : "var(--navy)"}">${metrics.lowRate ?? "-"}<span class="unit">%</span></div></div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title"><h3>評価分布</h3></div>
        ${ratingDistributionChart(metrics.distribution, bands)}
      </div>
      <div class="card">
        <div class="card-title"><h3>項目別サマリー</h3></div>
        <div class="table-wrap"><table><thead><tr><th>項目</th><th>回答数</th><th>平均</th><th>低評価率</th><th>記入率</th></tr></thead><tbody>
          ${breakdown.map((b) => `<tr><td>${escapeHtml(b.item.name)}</td><td>${b.metrics.responseCount}</td><td>${b.metrics.avg ?? "-"}</td><td>${b.metrics.lowRate ?? "-"}%</td><td>${b.metrics.fillRate}%</td></tr>`).join("")}
        </tbody></table></div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <h3>ワードクラウド・頻出テーマ</h3>
        <span class="muted" style="font-size:.78rem">コメント${commentCount}件を分析（簡易語抽出／ANL-01 参照：README §要確認事項）</span>
      </div>
      <div class="row" style="gap:24px;align-items:flex-start" class="wrap">
        <div style="flex:1.4">${renderWordCloud(words)}</div>
        <div style="flex:1">${renderWordRanking(words)}</div>
      </div>
      <div class="field-row" style="margin-top:14px;align-items:flex-end">
        <div class="field" style="flex:2">
          <label>除外語を追加（共通・即時再集計／ANL-02）</label>
          <input type="text" id="stopwordInput" placeholder="例：普通">
        </div>
        <button class="btn small" id="addStopword" style="margin-bottom:12px">追加</button>
      </div>
    </div>
  `;

  wireFilters(root);
  root.querySelectorAll("[data-word]").forEach((el) => {
    el.onclick = () => showCommentsForWord(el.dataset.word, all, words);
  });
  root.querySelector("#addStopword").onclick = () => {
    const input = root.querySelector("#stopwordInput");
    const w = input.value.trim();
    if (!w) return;
    const ew = db.excludedWords;
    if (!ew.common.includes(w)) ew.common.push(w);
    db.excludedWords = ew;
    toast(`「${w}」を除外語に追加しました`, "good");
    render(root);
  };
}

function wireFilters(root) {
  root.querySelectorAll("[data-store]").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.store;
      const idx = filters.storeIds.indexOf(id);
      if (idx >= 0) filters.storeIds.splice(idx, 1); else filters.storeIds.push(id);
      render(root);
    };
  });
  const allStoreBtn = root.querySelector("[data-store-all]");
  if (allStoreBtn) allStoreBtn.onclick = () => { filters.storeIds = []; render(root); };

  root.querySelectorAll("[data-item]").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.item;
      const idx = filters.itemIds.indexOf(id);
      if (idx >= 0) filters.itemIds.splice(idx, 1); else filters.itemIds.push(id);
      render(root);
    };
  });
  const allItemBtn = root.querySelector("[data-item-all]");
  if (allItemBtn) allItemBtn.onclick = () => { filters.itemIds = []; render(root); };

  root.querySelectorAll("[data-band]").forEach((el) => {
    el.onclick = () => { filters.band = el.dataset.band; render(root); };
  });
  root.querySelectorAll("[data-comment]").forEach((el) => {
    el.onclick = () => { filters.commentFilter = el.dataset.comment; render(root); };
  });
  root.querySelectorAll("[data-period]").forEach((el) => {
    el.onclick = () => {
      filters.periodKey = el.dataset.period;
      if (el.dataset.period !== "custom") {
        const p = periodPreset(el.dataset.period);
        filters.start = p.start; filters.end = p.end;
      }
      render(root);
    };
  });
  root.querySelector("#startDate").onchange = (e) => { filters.periodKey = "custom"; filters.start = e.target.value; render(root); };
  root.querySelector("#endDate").onchange = (e) => { filters.periodKey = "custom"; filters.end = e.target.value; render(root); };
}

function showCommentsForWord(word, allRecords, words) {
  const entry = words.find((w) => w.word === word);
  if (!entry) return;
  const matches = allRecords.filter((r) => entry.recordIds.includes(r.id));
  openModal(`
    <div class="modal-header"><h3>「${escapeHtml(word)}」を含む元コメント（${matches.length}件）</h3><button data-close>&times;</button></div>
    <div class="stack">
      ${matches.map((m) => `
        <div class="comment-item">
          <div class="meta">
            <span class="rating-dot ${m.rating <= 2 ? "low" : m.rating >= 4 ? "high" : "mid"}">${m.rating ? "★".repeat(m.rating) : "評価不明"}</span>
            <span>${escapeHtml(db.storeName(m.storeId))}</span>
            <span>${m.date}</span>
            <span>${escapeHtml(db.itemById(m.itemId)?.name || "")}</span>
          </div>
          <div>${escapeHtml(m.comment)}</div>
        </div>
      `).join("") || `<div class="empty-state">該当コメントがありません</div>`}
    </div>
  `, { width: 640, onMount: (r) => { r.querySelector("[data-close]").onclick = closeModal; } });
}
