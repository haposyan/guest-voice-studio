// ============================================================================
// lobby.js — "Lobby｜ダッシュボード": overall trend, task status, celebration.
// Design principle from spec §4.8 / §8: honor improvement effort & delta,
// not just raw rating rankings.
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds } from "../permissions.js";
import { filterRecords, computeMetrics, itemBreakdown, periodPreset, delta, toISODate } from "../analysis.js";
import { computeWordFrequencies } from "../tokenizer.js";
import { escapeHtml, toast } from "../components/ui.js";
import { setPendingJump } from "./guestvoice-bridge.js";

// v2.18: 月切替。0=今月、-1=先月、… 現在月より先には進めない（未来のデータは
// 存在しないため）。ナビゲーションをまたいでも当月に戻らないよう、Report
// Studio／Guest Voiceと同じくモジュール変数のまま保持する（アプリ再起動で
// リセットされれば十分）。
let monthOffset = 0;

// 指定オフセット分ずらした月の範囲。オフセット0（今月）は「今日まで」、
// それ以外の過去月は月初〜月末のフル範囲。periodPreset("thisMonth")と同じ
// 「今日まで」ルールを、任意の月にも適用できるようにしたもの。
function monthRange(offset) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + offset;
  const start = new Date(y, m, 1);
  const end = offset === 0 ? now : new Date(y, m + 1, 0);
  return { start: toISODate(start), end: toISODate(end), label: `${start.getFullYear()}年${start.getMonth() + 1}月` };
}

export function mountLobby(root) {
  const user = db.currentUser();
  const myStores = allowedStoreIds(user);
  const bands = db.ratingBands;
  const items = db.itemMappings.filter((i) => i.enabled);

  const thisMonth = monthRange(monthOffset);
  const lastMonth = monthRange(monthOffset - 1);

  const curRecords = filterRecords(db.records, { storeIds: myStores, start: thisMonth.start, end: thisMonth.end }, bands);
  const prevRecords = filterRecords(db.records, { storeIds: myStores, start: lastMonth.start, end: lastMonth.end }, bands);

  const curMetrics = computeMetrics(curRecords, bands);
  const prevMetrics = computeMetrics(prevRecords, bands);
  const breakdown = itemBreakdown(curRecords, items, bands);

  const myTasks = db.tasks.filter((t) => myStores.includes(t.storeId));
  // 効果確認済みステータスはSettings＞ブランド・保存設定で表示をオンにするまで
  // 初期値では使われない（Action Board側と表示を揃える）。
  const statusCounts = db.brand.showEffectConfirm
    ? { "未対応": 0, "対応中": 0, "対応済み": 0, "効果確認済み": 0 }
    : { "未対応": 0, "対応中": 0, "対応済み": 0 };
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

  const completedThisMonth = myTasks.filter((t) => t.status === "効果確認済み" && t.completedAt && t.completedAt >= thisMonth.start && t.completedAt <= thisMonth.end);
  const doneThisMonth = myTasks.filter((t) => t.status === "対応済み" && t.completedAt && t.completedAt >= thisMonth.start && t.completedAt <= thisMonth.end);

  // v2.19: 客室稼働率・宿泊者数の入力は不要とのことで廃止し、「客室稼働数」
  // （＝その月に稼働した客室の実数）のみを手入力する項目にした。PMS連携が
  // ないため月ごとに手入力する（db.occupancy、"YYYY-MM"キー）。回答率＝
  // 回答数÷客室稼働数。
  const monthKey = thisMonth.start.slice(0, 7);
  const occ = db.occupancy[monthKey] || {};
  const responseRate = occ.roomCount ? Math.round((curMetrics.responseCount / occ.roomCount) * 1000) / 10 : null;

  root.innerHTML = `
    <div class="card no-print" style="padding:10px 16px">
      <div class="row" style="align-items:center;justify-content:center;gap:14px">
        <button class="btn small" id="prevMonthBtn">‹ 前月</button>
        <strong style="min-width:7em;text-align:center">${escapeHtml(thisMonth.label)}${monthOffset === 0 ? "（今月）" : ""}</strong>
        <button class="btn small" id="nextMonthBtn" ${monthOffset >= 0 ? "disabled" : ""}>翌月 ›</button>
        ${monthOffset !== 0 ? `<button class="btn small" id="thisMonthBtn" style="margin-left:8px">今月に戻る</button>` : ""}
      </div>
    </div>

    ${(completedThisMonth.length + doneThisMonth.length) > 0 ? `
      <div class="celebrate">
        <div class="emoji">🎉</div>
        <div>${escapeHtml(thisMonth.label)}は <strong>${completedThisMonth.length + doneThisMonth.length}件</strong> の改善が実を結びました。効果確認済み ${completedThisMonth.length}件、対応完了 ${doneThisMonth.length}件です。日々の対応に感謝します。</div>
      </div>` : `
      <div class="celebrate">
        <div class="emoji">🌱</div>
        <div>${escapeHtml(thisMonth.label)}に完了した改善課題はまだありません。Action Boardで対応状況を確認しましょう。</div>
      </div>`}

    <div class="grid cols-4">
      ${statTile("回答数", curMetrics.responseCount, "件", delta(curMetrics.responseCount, prevMetrics.responseCount))}
      ${statTile("全項目平均評価", curMetrics.avg, "", delta(curMetrics.avg, prevMetrics.avg), true)}
      ${statTile("低評価率", curMetrics.lowRate, "%", delta(curMetrics.lowRate, prevMetrics.lowRate) != null ? -delta(curMetrics.lowRate, prevMetrics.lowRate) : null, true, true, "全体のうち2以下の評価率")}
      ${statTile("コメント記入率", curMetrics.fillRate, "%", delta(curMetrics.fillRate, prevMetrics.fillRate), false, false, "評価かコメントが入った項目のうち、コメントも入力された割合")}
    </div>

    <div class="card no-print">
      <div class="card-title"><h3>客室稼働数・回答率（${escapeHtml(thisMonth.label)}）</h3></div>
      <p class="hint">PMSとの連携がないため、客室稼働数は手入力です。入力すると、回答率（回答数÷客室稼働数）が自動で計算されます。</p>
      <div class="field-row">
        <div class="field"><label>客室稼働数</label><input type="number" id="occRooms" min="0" step="1" value="${occ.roomCount ?? ""}" placeholder="例：420"></div>
        <div class="field"><label>回答率</label><div style="padding-top:8px;font-weight:700;font-size:1.1rem">${responseRate != null ? `${responseRate}%` : "-"}</div></div>
        <div class="field" style="justify-content:flex-end;display:flex"><button class="btn small primary" id="occSave">保存</button></div>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <div class="card-title"><h3>項目別の評価・低評価率（${escapeHtml(thisMonth.label)}）</h3></div>
        <p class="muted" style="font-size:.76rem;margin:-4px 0 8px">※低評価率は「全体のうち2以下の評価率」です（低評価率の定義はLobby上部と共通）。行をクリックすると、その項目・期間でGuest Voice画面に移動します。</p>
        <div class="table-wrap"><table><thead><tr><th>項目</th><th>平均</th><th>低評価率</th></tr></thead><tbody>
          ${breakdown.map((b) => `<tr class="clickable-row" data-item-id="${escapeHtml(b.item.id)}"><td>${escapeHtml(b.item.name)}</td><td>${b.metrics.avg ?? "-"}</td><td style="color:${(b.metrics.lowRate||0) > 20 ? "var(--bad)" : "inherit"}">${b.metrics.lowRate ?? "-"}%</td></tr>`).join("")}
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
        <div class="card-title"><h3>増加している単語</h3></div>
        <p class="muted" style="font-size:.76rem;margin:-4px 0 8px">コメントに含まれる単語のうち、先月より出現率が上がっているものです。</p>
        ${rising.length ? `<div class="tag-list">${rising.map((r) => `<span class="chip static" style="border-color:var(--bad)">${escapeHtml(r.word)} <span class="muted">+${r.diff.toFixed(1)}</span></span>`).join("")}</div>` : `<div class="empty-state">先月比で増加している単語はありません</div>`}
      </div>
      <div class="card">
        <div class="card-title"><h3>減っている単語</h3></div>
        <p class="muted" style="font-size:.76rem;margin:-4px 0 8px">コメントに含まれる単語のうち、先月より出現率が下がっているものです。</p>
        ${improving.length ? `<div class="tag-list">${improving.map((r) => `<span class="chip static" style="border-color:var(--good)">${escapeHtml(r.word)} <span class="muted">${r.diff.toFixed(1)}</span></span>`).join("")}</div>` : `<div class="empty-state">先月比で減っている単語はまだありません</div>`}
      </div>
    </div>
  `;

  root.querySelector("#prevMonthBtn").onclick = () => { monthOffset -= 1; mountLobby(root); };
  const nextBtn = root.querySelector("#nextMonthBtn");
  if (nextBtn && !nextBtn.disabled) nextBtn.onclick = () => { monthOffset += 1; mountLobby(root); };
  const thisBtn = root.querySelector("#thisMonthBtn");
  if (thisBtn) thisBtn.onclick = () => { monthOffset = 0; mountLobby(root); };

  root.querySelector("#occSave").onclick = () => {
    const rooms = root.querySelector("#occRooms").value;
    const all = db.occupancy;
    all[monthKey] = { roomCount: rooms === "" ? null : Number(rooms) };
    db.occupancy = all;
    toast("保存しました", "good");
    mountLobby(root);
  };

  root.querySelectorAll(".clickable-row[data-item-id]").forEach((tr) => {
    tr.onclick = () => {
      setPendingJump(tr.dataset.itemId, thisMonth.start, thisMonth.end);
      location.hash = "#guestvoice";
    };
  });
}

function statTile(label, value, unit, deltaVal, isDecimal, invertGoodBad, note) {
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
    ${note ? `<div class="muted" style="font-size:.68rem;margin-top:2px;line-height:1.3">※${note}</div>` : ""}
  </div>`;
}
