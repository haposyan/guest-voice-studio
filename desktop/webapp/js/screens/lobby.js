// ============================================================================
// lobby.js — "Lobby｜ダッシュボード": overall trend, task status, celebration.
// Design principle from spec §4.8 / §8: honor improvement effort & delta,
// not just raw rating rankings.
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds } from "../app.js";
import { filterRecords, computeMetrics, itemBreakdown, periodPreset, delta } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { escapeHtml } from "../components/ui.js";

export function mountLobby(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  const bands = db.ratingBands;
  const items = db.itemMappings.filter((i) => i.enabled);

  const thisMonth = periodPreset("thisMonth");
  const lastMonth = periodPreset("lastMonth");

  const curRecords = filterRecords(db.records, { storeIds: myStores, start: thisMonth.start, end: thisMonth.end }, bands);
  const prevRecords = filterRecords(db.records, { storeIds: myStores, start: lastMonth.start, end: lastMonth.end }, bands);

  const curMetrics = computeMetrics(curRecords, bands);
  const prevMetrics = computeMetrics(prevRecords, bands);
  const breakdown = itemBreakdown(curRecords, items, bands);

  const myTasks = db.tasks.filter((t) => myStores.includes(t.storeId));
  const statusCounts = { "未対応": 0, "対応中": 0, "対応済み": 0, "効果確認済み": 0 };
  let overdue = 0;
  const today = new Date().toISOString().slice(0, 10);
  myTasks.forEach((t) => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    if (t.dueDate && t.dueDate < today && t.status !== "対応済み" && t.status !== "効果確認済み") overdue++;
  });

  const { words: curWords } = computeWordFrequencies(curRecords, db.excludedWords, bands);
  const { words: prevWords } = computeWordFrequencies(prevRecords, db.excludedWords, bands);
  const prevMap = new Map(prevWords.map((w) => [w.word, w]));
  const rising = curWords
    .filter((w) => w.negCount > 0)
    .map((w) => ({ word: w.word, diff: w.ratePer100 - (prevMap.get(w.word)?.ratePer100 || 0) }))
    .filter((w) => w.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 6);

  const curMap = new Map(curWords.map((w) => [w.word, w]));
  const improving = prevWords
    .filter((w) => w.negCount > 0)
    .map((w) => ({ word: w.word, diff: (curMap.get(w.word)?.ratePer100 || 0) - w.ratePer100 }))
    .filter((w) => w.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 6);

  const completedThisMonth = myTasks.filter((t) => t.status === "効果確認済み" && t.completedAt && t.completedAt >= thisMonth.start);
  const doneThisMonth = myTasks.filter((t) => t.status === "対応済み" && t.completedAt && t.completedAt >= thisMonth.start);

  root.innerHTML = `
    ${(completedThisMonth.length + doneThisMonth.length) > 0 ? `
      <div class="celebrate">
        <div class="emoji">🎉</div>
        <div>今月は <strong>${completedThisMonth.length + doneThisMonth.length}件</strong> の改善が実を結びました。効果確認済み ${completedThisMonth.length}件、対応完了 ${doneThisMonth.length}件です。日々の対応に感謝します。</div>
      </div>` : `
      <div class="celebrate">
        <div class="emoji">🌱</div>
        <div>今月完了した改善課題はまだありません。Action Boardで対応状況を確認しましょう。</div>
      </div>`}

    <div class="grid cols-4">
      ${statTile("回答数", curMetrics.responseCount, "件", delta(curMetrics.responseCount, prevMetrics.responseCount))}
      ${statTile("平均評価", curMetrics.avg, "", delta(curMetrics.avg, prevMetrics.avg), true)}
      ${statTile("低評価率", curMetrics.lowRate, "%", delta(curMetrics.lowRate, prevMetrics.lowRate) != null ? -delta(curMetrics.lowRate, prevMetrics.lowRate) : null, true, true)}
      ${statTile("コメント記入率", curMetrics.fillRate, "%", delta(curMetrics.fillRate, prevMetrics.fillRate))}
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title"><h3>項目別の評価・低評価率（今月）</h3></div>
        <div class="table-wrap"><table><thead><tr><th>項目</th><th>平均</th><th>低評価率</th></tr></thead><tbody>
          ${breakdown.map((b) => `<tr><td>${escapeHtml(b.item.name)}</td><td>${b.metrics.avg ?? "-"}</td><td style="color:${(b.metrics.lowRate||0) > 20 ? "var(--bad)" : "inherit"}">${b.metrics.lowRate ?? "-"}%</td></tr>`).join("")}
        </tbody></table></div>
      </div>
      <div class="card">
        <div class="card-title"><h3>改善課題の状況</h3><a href="#actionboard" class="btn small">Action Boardへ</a></div>
        <div class="grid cols-2">
          ${Object.entries(statusCounts).map(([k, v]) => `<div class="stat-tile"><div class="label"><span class="badge status-${k}">${k}</span></div><div class="value">${v}</div></div>`).join("")}
        </div>
        ${overdue ? `<p class="hint" style="color:var(--bad);margin-top:10px">⚠ 期限超過の課題が ${overdue}件 あります</p>` : `<p class="hint" style="margin-top:10px">期限超過の課題はありません</p>`}
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title"><h3>増加している不満テーマ</h3></div>
        ${rising.length ? `<div class="tag-list">${rising.map((r) => `<span class="chip" style="border-color:var(--bad)">${escapeHtml(r.word)} <span class="muted">+${r.diff.toFixed(1)}</span></span>`).join("")}</div>` : `<div class="empty-state">先月比で増加しているテーマはありません</div>`}
      </div>
      <div class="card">
        <div class="card-title"><h3>改善傾向のテーマ</h3></div>
        ${improving.length ? `<div class="tag-list">${improving.map((r) => `<span class="chip" style="border-color:var(--good)">${escapeHtml(r.word)} <span class="muted">${r.diff.toFixed(1)}</span></span>`).join("")}</div>` : `<div class="empty-state">先月比で改善しているテーマはまだありません</div>`}
      </div>
    </div>
  `;
}

function statTile(label, value, unit, deltaVal, isDecimal, invertGoodBad) {
  let deltaHtml = "";
  if (deltaVal != null && !isNaN(deltaVal)) {
    const good = invertGoodBad ? deltaVal <= 0 : deltaVal >= 0;
    const cls = deltaVal === 0 ? "flat" : good ? "up" : "down";
    const sign = deltaVal > 0 ? "+" : "";
    deltaHtml = `<div class="delta ${cls}">${sign}${deltaVal}${unit} 前月比</div>`;
  }
  return `<div class="stat-tile">
    <div class="label">${label}</div>
    <div class="value">${value ?? "-"}<span class="unit">${unit}</span></div>
    ${deltaHtml}
  </div>`;
}
