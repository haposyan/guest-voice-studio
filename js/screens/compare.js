// ============================================================================
// compare.js — "Compare｜期間比較": period A vs B, side-by-side word clouds,
// theme deltas, per-store comparison (§4.6).
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds } from "../app.js";
import { filterRecords, computeMetrics, storeBreakdown, periodPreset, delta, isLowSample } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { renderWordCloud } from "../components/wordcloud.js";
import { escapeHtml } from "../components/ui.js";
import * as analysis from "../analysis.js";

let state;

export function mountCompare(root) {
  const thisM = periodPreset("thisMonth");
  const lastM = periodPreset("lastMonth");
  state = {
    storeIds: [],
    itemIds: [],
    aStart: lastM.start, aEnd: lastM.end,
    bStart: thisM.start, bEnd: thisM.end,
    aLabel: "先月", bLabel: "今月",
  };
  render(root);
}

function applyPreset(name) {
  const thisM = periodPreset("thisMonth");
  const lastM = periodPreset("lastMonth");
  const lastY = periodPreset("lastYearSameMonth");
  if (name === "thisVsLast") { state.aStart = lastM.start; state.aEnd = lastM.end; state.bStart = thisM.start; state.bEnd = thisM.end; state.aLabel = "先月"; state.bLabel = "今月"; }
  if (name === "thisVsLastYear") { state.aStart = lastY.start; state.aEnd = lastY.end; state.bStart = thisM.start; state.bEnd = thisM.end; state.aLabel = "前年同月"; state.bLabel = "今月"; }
}

function render(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  const stores = db.stores.filter((s) => myStores.includes(s.id));
  const items = db.itemMappings.filter((i) => i.enabled);
  const bands = db.ratingBands;

  const effStoreIds = state.storeIds.length ? state.storeIds : myStores;
  const effItemIds = state.itemIds.length ? state.itemIds : items.map((i) => i.id);

  const recA = filterRecords(db.records, { storeIds: effStoreIds, itemIds: effItemIds, start: state.aStart, end: state.aEnd }, bands);
  const recB = filterRecords(db.records, { storeIds: effStoreIds, itemIds: effItemIds, start: state.bStart, end: state.bEnd }, bands);
  const mA = computeMetrics(recA, bands);
  const mB = computeMetrics(recB, bands);

  const { words: wordsA, commentCount: ccA } = computeWordFrequencies(recA, db.excludedWords, bands);
  const { words: wordsB, commentCount: ccB } = computeWordFrequencies(recB, db.excludedWords, bands);
  const themeDiff = analysis.compareThemes(wordsA, wordsB, ccA, ccB);

  const storesA = storeBreakdown(recA, stores, bands);
  const storesB = storeBreakdown(recB, stores, bands);
  const storeRows = stores.map((s) => {
    const a = storesA.find((x) => x.store.id === s.id).metrics;
    const b = storesB.find((x) => x.store.id === s.id).metrics;
    const avgDelta = delta(b.avg, a.avg);
    return { store: s, a, b, avgDelta, lowN: Math.min(a.ratedCount, b.ratedCount) };
  }).filter((r) => r.a.responseCount || r.b.responseCount)
    .sort((x, y) => (y.avgDelta ?? -99) - (x.avgDelta ?? -99));

  root.innerHTML = `
    <div class="card">
      <div class="card-title"><h2>比較条件</h2></div>
      <div class="row wrap" style="gap:8px;margin-bottom:12px">
        <button class="btn small" id="presetLast">今月 対 先月</button>
        <button class="btn small" id="presetYear">今月 対 前年同月</button>
        <span class="hint">「改善前対改善後」は Action Board の課題詳細から比較期間を指定できます</span>
      </div>
      <div class="field-row">
        <div class="field"><label>期間A（${escapeHtml(state.aLabel)}）開始</label><input type="date" id="aStart" value="${state.aStart || ""}"></div>
        <div class="field"><label>期間A 終了</label><input type="date" id="aEnd" value="${state.aEnd || ""}"></div>
        <div class="field"><label>期間B（${escapeHtml(state.bLabel)}）開始</label><input type="date" id="bStart" value="${state.bStart || ""}"></div>
        <div class="field"><label>期間B 終了</label><input type="date" id="bEnd" value="${state.bEnd || ""}"></div>
      </div>
      <div>
        <label>拠点</label>
        <div class="tag-list">
          ${user.role === "本部管理者" ? `<span class="chip ${!state.storeIds.length ? "active" : ""}" data-store-all>全拠点</span>` : ""}
          ${stores.map((s) => `<span class="chip ${state.storeIds.includes(s.id) ? "active" : ""}" data-store="${s.id}">${escapeHtml(s.name)}</span>`).join("")}
        </div>
      </div>
      <div style="margin-top:10px">
        <label>項目</label>
        <div class="tag-list">
          <span class="chip ${!state.itemIds.length ? "active" : ""}" data-item-all>すべて選択</span>
          ${items.map((i) => `<span class="chip ${state.itemIds.includes(i.id) ? "active" : ""}" data-item="${i.id}">${escapeHtml(i.name)}</span>`).join("")}
        </div>
      </div>
    </div>

    <div class="grid cols-4">
      ${compareTile("回答数", mA.responseCount, mB.responseCount, "件")}
      ${compareTile("平均評価", mA.avg, mB.avg, "")}
      ${compareTile("低評価率", mA.lowRate, mB.lowRate, "%", true)}
      ${compareTile("コメント記入率", mA.fillRate, mB.fillRate, "%")}
    </div>

    <div class="card">
      <div class="card-title"><h3>ワードクラウド比較</h3></div>
      <div class="grid cols-2">
        <div><h4>期間A：${escapeHtml(state.aLabel)}（${state.aStart}〜${state.aEnd}）／コメント${ccA}件</h4>${renderWordCloud(wordsA, { limit: 30 })}</div>
        <div><h4>期間B：${escapeHtml(state.bLabel)}（${state.bStart}〜${state.bEnd}）／コメント${ccB}件</h4>${renderWordCloud(wordsB, { limit: 30 })}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title"><h3>テーマの増減</h3></div>
      <div class="table-wrap"><table><thead><tr><th>語</th><th>状態</th><th>期間A 出現率</th><th>期間B 出現率</th><th>差</th></tr></thead><tbody>
        ${themeDiff.slice(0, 25).map((t) => `<tr>
          <td>${escapeHtml(t.word)}</td>
          <td>${themeLabel(t.status)}</td>
          <td>${t.rateA}</td><td>${t.rateB}</td>
          <td style="color:${t.diff > 0 ? "var(--bad)" : t.diff < 0 ? "var(--good)" : "inherit"}">${t.diff > 0 ? "+" : ""}${t.diff}</td>
        </tr>`).join("")}
      </tbody></table></div>
    </div>

    <div class="card">
      <div class="card-title"><h3>拠点別比較（平均評価の改善幅順）</h3></div>
      <div class="table-wrap"><table><thead><tr><th>拠点</th><th>期間A 平均</th><th>期間B 平均</th><th>差</th><th>期間B 低評価率</th><th></th></tr></thead><tbody>
        ${storeRows.map((r) => `<tr>
          <td>${escapeHtml(r.store.name)}</td>
          <td>${r.a.avg ?? "-"}</td>
          <td>${r.b.avg ?? "-"}</td>
          <td style="color:${(r.avgDelta||0) > 0 ? "var(--good)" : (r.avgDelta||0) < 0 ? "var(--bad)" : "inherit"}">${r.avgDelta != null ? (r.avgDelta > 0 ? "+" : "") + r.avgDelta : "-"}</td>
          <td>${r.b.lowRate ?? "-"}%</td>
          <td>${isLowSample(r.lowN) ? '<span class="hint">参考値（サンプル少）</span>' : ""}</td>
        </tr>`).join("")}
      </tbody></table></div>
    </div>
  `;

  root.querySelector("#presetLast").onclick = () => { applyPreset("thisVsLast"); render(root); };
  root.querySelector("#presetYear").onclick = () => { applyPreset("thisVsLastYear"); render(root); };
  root.querySelector("#aStart").onchange = (e) => { state.aStart = e.target.value; state.aLabel = "期間A"; render(root); };
  root.querySelector("#aEnd").onchange = (e) => { state.aEnd = e.target.value; state.aLabel = "期間A"; render(root); };
  root.querySelector("#bStart").onchange = (e) => { state.bStart = e.target.value; state.bLabel = "期間B"; render(root); };
  root.querySelector("#bEnd").onchange = (e) => { state.bEnd = e.target.value; state.bLabel = "期間B"; render(root); };
  const allStoreBtn = root.querySelector("[data-store-all]");
  if (allStoreBtn) allStoreBtn.onclick = () => { state.storeIds = []; render(root); };
  root.querySelectorAll("[data-store]").forEach((el) => {
    el.onclick = () => { const id = el.dataset.store; const i = state.storeIds.indexOf(id); if (i >= 0) state.storeIds.splice(i, 1); else state.storeIds.push(id); render(root); };
  });
  root.querySelector("[data-item-all]").onclick = () => { state.itemIds = []; render(root); };
  root.querySelectorAll("[data-item]").forEach((el) => {
    el.onclick = () => { const id = el.dataset.item; const i = state.itemIds.indexOf(id); if (i >= 0) state.itemIds.splice(i, 1); else state.itemIds.push(id); render(root); };
  });
}

function themeLabel(status) {
  return { new: '<span class="badge status-未対応">新規出現</span>', disappeared: '<span class="badge">消滅</span>', increasing: '<span class="badge status-対応中">増加</span>', decreasing: '<span class="badge status-効果確認済み">減少</span>', flat: "継続" }[status] || status;
}

function compareTile(label, a, b, unit, invert) {
  const d = delta(b, a);
  let deltaHtml = "";
  if (d != null) {
    const good = invert ? d <= 0 : d >= 0;
    const cls = d === 0 ? "flat" : good ? "up" : "down";
    deltaHtml = `<div class="delta ${cls}">${d > 0 ? "+" : ""}${d}${unit}</div>`;
  }
  return `<div class="stat-tile">
    <div class="label">${label}</div>
    <div class="value" style="font-size:1.1rem">${a ?? "-"} → ${b ?? "-"}<span class="unit">${unit}</span></div>
    ${deltaHtml}
  </div>`;
}
