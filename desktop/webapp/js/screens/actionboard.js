// ============================================================================
// actionboard.js — "Action Board｜改善課題": kanban by status, task detail
// with related-comment linking, effect verification (§4.7).
// ============================================================================

import { db } from "../db.js";
import { allowedStoreIds, can } from "../permissions.js";
import { filterRecords, computeMetrics, delta } from "../analysis.js";
import { openModal, closeModal, escapeHtml, toast, confirmDialog, dateWidgetHtml, wireDateWidget } from "../components/ui.js";

const ALL_STATUSES = ["未対応", "対応中", "対応済み", "効果確認済み"];
// 効果確認済みステータス・効果確認タブは初期値では非表示（Settings＞ブランド・保存設定で表示可）。
function visibleStatuses() {
  return db.brand.showEffectConfirm ? ALL_STATUSES : ALL_STATUSES.filter((s) => s !== "効果確認済み");
}

export function mountActionBoard(root) {
  render(root);
}

// v2.18: ドラッグ&ドロップで動かした直近1件だけ、元に戻せるようにする
// （多段Undoは複雑になりすぎるため、意図しない移動をすぐ気づいて戻せれば
// 十分という判断）。ナビゲーションをまたぐと消える＝画面を離れたら「その
// 状態が確定した」とみなす。
let lastDragChange = null;

function applyStatusChange(task, newStatus, changeLabel) {
  const prevStatus = task.status;
  if (newStatus === prevStatus) return false;
  if ((newStatus === "対応済み" || newStatus === "効果確認済み") && !task.completedAt) {
    task.completedAt = new Date().toISOString().slice(0, 10);
  }
  task.status = newStatus;
  task.history.push({ date: new Date().toISOString(), user: db.currentUser().name, change: changeLabel || `状態: ${prevStatus} → ${newStatus}` });
  db.tasks = db.tasks.map((t) => t.id === task.id ? task : t);
  db.audit("task_update", task.id, `状態: ${prevStatus} → ${newStatus}`);
  return true;
}

function render(root) {
  const myStores = allowedStoreIds();
  const STATUSES = visibleStatuses();
  const tasks = db.tasks.filter((t) => myStores.includes(t.storeId) && STATUSES.includes(t.status));
  const today = new Date().toISOString().slice(0, 10);
  const editable = can("editTasks");

  root.innerHTML = `
    <div class="row no-print" style="justify-content:space-between;margin-bottom:14px;align-items:center">
      <div class="row" style="gap:8px">
        ${lastDragChange ? `<button class="btn small" id="undoDragBtn">↶ 元に戻す（${escapeHtml(lastDragChange.taskTitle)}を${escapeHtml(lastDragChange.prevStatus)}に）</button>` : ""}
      </div>
      <div class="row" style="gap:8px">
        <button class="btn small" id="printBoardBtn">🖨 PDFデータで印刷・保存</button>
        ${editable ? `<button class="btn primary" id="newTaskBtn">＋ 新規課題を登録</button>` : ""}
      </div>
    </div>
    <div class="kanban no-print">
      ${STATUSES.map((status) => {
        const list = tasks.filter((t) => t.status === status);
        return `<div class="kanban-col" data-status-col="${status}">
          <h4>${status} <span class="badge status-${status}">${list.length}</span></h4>
          ${list.map((t) => {
            const overdue = t.dueDate && t.dueDate < today && status !== "対応済み" && status !== "効果確認済み";
            return `<div class="kanban-card ${overdue ? "overdue" : ""}" data-task="${t.id}" draggable="${editable}">
              <div class="title">${escapeHtml(t.title)}${t.severityFlag ? ' <span title="重大">🚩</span>' : ""}</div>
              <div class="meta">${escapeHtml(db.itemById(t.itemId)?.name || "")} ・ ${escapeHtml(t.assignee || "未割当")}</div>
              <div class="meta">期限: ${t.dueDate || "-"} ${overdue ? '<span style="color:var(--bad)">超過</span>' : ""}</div>
            </div>`;
          }).join("") || `<div class="hint">課題なし</div>`}
        </div>`;
      }).join("")}
    </div>
    <div class="print-only actionboard-print">
      <h1>改善課題一覧（${escapeHtml(db.storeName(db.LOCAL_STORE_ID))} / ${escapeHtml(new Date().toLocaleDateString("ja-JP"))}時点）</h1>
      <table><thead><tr><th>状態</th><th>項目</th><th>課題名</th><th>担当者</th><th>期限</th><th>説明</th><th>対応内容</th></tr></thead>
      <tbody>${taskRowsHtml(tasks, STATUSES)}</tbody></table>
    </div>
  `;

  root.querySelectorAll("[data-task]").forEach((el) => {
    el.onclick = () => openTaskDetail(el.dataset.task, root);
  });
  const newBtn = root.querySelector("#newTaskBtn");
  if (newBtn) newBtn.onclick = () => openTaskForm(root);
  root.querySelector("#printBoardBtn").onclick = () => printActionBoard();

  const undoBtn = root.querySelector("#undoDragBtn");
  if (undoBtn) undoBtn.onclick = () => {
    const change = lastDragChange;
    lastDragChange = null;
    const task = db.tasks.find((t) => t.id === change.taskId);
    if (task) applyStatusChange(task, change.prevStatus, `ドラッグ&ドロップの取り消し: ${change.newStatus} → ${change.prevStatus}`);
    toast("元に戻しました", "good");
    render(root);
  };

  if (editable) wireDragAndDrop(root, tasks);
}

// v2.18: カンバンカードをドラッグして別の列にドロップすると状態が変わる。
// クリックでの詳細編集（既存の状態プルダウン）はそのまま残しており、
// ドラッグはあくまで手早く動かすための追加手段という位置づけ。
function wireDragAndDrop(root, tasks) {
  let draggingId = null;
  root.querySelectorAll(".kanban-card[draggable='true']").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      draggingId = card.dataset.task;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", draggingId); // 一部ブラウザはデータ未設定だとdrop不可のため
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
  });
  root.querySelectorAll(".kanban-col[data-status-col]").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; col.classList.add("drop-target"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop-target"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      const taskId = draggingId || e.dataTransfer.getData("text/plain");
      draggingId = null;
      if (!taskId) return;
      const task = tasks.find((t) => t.id === taskId);
      const newStatus = col.dataset.statusCol;
      if (!task || task.status === newStatus) return;
      const prevStatus = task.status;
      const changed = applyStatusChange(task, newStatus, `ドラッグ&ドロップで状態変更: ${prevStatus} → ${newStatus}`);
      if (changed) {
        lastDragChange = { taskId: task.id, taskTitle: task.title, prevStatus, newStatus };
        toast(`「${task.title}」を${newStatus}に変更しました`, "good");
        render(root);
      }
    });
  });
}

// v2.19: Word/Excel出力（HTMLに.doc/.xls拡張子を付けて保存する方式）は
// PDF/Word同様の理由で結局保存できない、というフィードバックのため撤去。
// Report Studioと同じ「PDFデータで印刷・保存」（window.print()で印刷
// ダイアログを開き、「PDFとして保存」を選んでもらう）方式に統一した。
// 一覧そのもの（カンバン列）は印刷向きのレイアウトではないため、印刷時
// だけ表示される専用のテーブル（.actionboard-print、CSS側で
// @media printのときのみ表示）を別途用意している。
function printActionBoard() {
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, "0");
  const suggested = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}ActionBoard`;
  const originalTitle = document.title;
  document.title = suggested;
  const restore = () => { document.title = originalTitle; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  setTimeout(restore, 20000);
  window.print();
}

function taskRowsHtml(tasks, STATUSES) {
  const today = new Date().toISOString().slice(0, 10);
  return STATUSES.map((status) => tasks.filter((t) => t.status === status)).flat().map((t) => {
    const overdue = t.dueDate && t.dueDate < today && t.status !== "対応済み" && t.status !== "効果確認済み";
    return `<tr>
      <td>${escapeHtml(t.status)}</td>
      <td>${escapeHtml(db.itemById(t.itemId)?.name || "")}</td>
      <td>${escapeHtml(t.title)}${t.severityFlag ? " 🚩" : ""}</td>
      <td>${escapeHtml(t.assignee || "未割当")}</td>
      <td>${escapeHtml(t.dueDate || "-")}${overdue ? "（超過）" : ""}</td>
      <td>${escapeHtml(t.description || "")}</td>
      <td>${escapeHtml(t.content || "")}</td>
    </tr>`;
  }).join("");
}

function commentSearchUI(prefix, initialSelected) {
  return `
    <div class="field">
      <label>関連コメントを検索して追加</label>
      <input type="text" id="${prefix}Search" placeholder="キーワードで元コメントを検索">
      <div id="${prefix}Results" class="stack" style="max-height:160px;overflow-y:auto;margin-top:6px"></div>
    </div>
    <div class="field">
      <label>関連付け済みコメント（<span id="${prefix}Count">${initialSelected.length}</span>件）</label>
      <div id="${prefix}Selected" class="stack" style="max-height:160px;overflow-y:auto"></div>
    </div>
  `;
}

function wireCommentSearch(root, prefix, selectedIds) {
  const searchInput = root.querySelector(`#${prefix}Search`);
  const resultsEl = root.querySelector(`#${prefix}Results`);
  const selectedEl = root.querySelector(`#${prefix}Selected`);
  const countEl = root.querySelector(`#${prefix}Count`);

  function renderSelected() {
    const recs = db.records.filter((r) => selectedIds.includes(r.id) && r.comment);
    selectedEl.innerHTML = recs.map((r) => `
      <div class="comment-item">
        <div class="meta">${r.date} / ★${r.rating ?? "-"}
          <button class="btn small ghost" data-unlink="${r.id}">解除</button>
        </div>
        <div>${escapeHtml(r.comment)}</div>
      </div>`).join("") || `<div class="hint">まだありません</div>`;
    countEl.textContent = selectedIds.length;
    selectedEl.querySelectorAll("[data-unlink]").forEach((b) => {
      b.onclick = () => { const idx = selectedIds.indexOf(b.dataset.unlink); if (idx >= 0) selectedIds.splice(idx, 1); renderSelected(); };
    });
  }
  searchInput.oninput = () => {
    const q = searchInput.value.trim();
    if (!q) { resultsEl.innerHTML = ""; return; }
    const hits = db.records.filter((r) => r.comment && r.comment.includes(q) && !selectedIds.includes(r.id)).slice(0, 20);
    resultsEl.innerHTML = hits.map((r) => `
      <div class="comment-item">
        <div class="meta">${r.date} / ★${r.rating ?? "-"}
          <button class="btn small" data-link="${r.id}">追加</button>
        </div>
        <div>${escapeHtml(r.comment)}</div>
      </div>`).join("") || `<div class="hint">該当なし</div>`;
    resultsEl.querySelectorAll("[data-link]").forEach((b) => {
      b.onclick = () => { selectedIds.push(b.dataset.link); searchInput.value = ""; resultsEl.innerHTML = ""; renderSelected(); };
    });
  };
  renderSelected();
}

function openTaskForm(root, prefill) {
  const items = db.itemMappings.filter((i) => i.enabled);
  const selectedIds = prefill?.relatedComments ? [...prefill.relatedComments] : [];

  openModal(`
    <div class="modal-header"><h3>新規改善課題</h3><button data-close>&times;</button></div>
    <div class="field"><label>対象項目</label><select id="fItem">${items.map((i) => `<option value="${i.id}" ${prefill?.itemId===i.id?"selected":""}>${escapeHtml(i.name)}</option>`).join("")}</select></div>
    <div class="field"><label>課題名</label><input type="text" id="fTitle" value="${escapeHtml(prefill?.title||"")}"></div>
    <div class="field"><label>説明</label><textarea id="fDesc">${escapeHtml(prefill?.description||"")}</textarea></div>
    <div class="field-row">
      <div class="field"><label>担当者</label><input type="text" id="fAssignee"></div>
      <div class="field"><label>期限</label>${dateWidgetHtml("fDue", "")}</div>
    </div>
    <div class="field"><label>対応内容（予定）</label><textarea id="fContent"></textarea></div>
    <div class="field checkbox-row"><input type="checkbox" id="fSeverity"><label style="margin:0">重大コメント（安全・衛生・法令等）として個別フラグを付ける</label></div>
    ${commentSearchUI("new", selectedIds)}
    <div class="row" style="justify-content:flex-end;margin-top:14px">
      <button class="btn ghost" data-cancel>キャンセル</button>
      <button class="btn primary" id="saveTask">登録する</button>
    </div>
  `, { width: 620, onMount: (r) => {
    r.querySelector("[data-close]").onclick = closeModal;
    r.querySelector("[data-cancel]").onclick = closeModal;
    wireCommentSearch(r, "new", selectedIds);
    wireDateWidget(r, "fDue");
    r.querySelector("#saveTask").onclick = () => {
      const title = r.querySelector("#fTitle").value.trim();
      if (!title) { toast("課題名を入力してください", "bad"); return; }
      const task = {
        id: db.uid("task"),
        storeId: db.LOCAL_STORE_ID,
        itemId: r.querySelector("#fItem").value,
        title,
        description: r.querySelector("#fDesc").value.trim(),
        relatedComments: [...selectedIds],
        severityFlag: r.querySelector("#fSeverity").checked,
        assignee: r.querySelector("#fAssignee").value.trim(),
        dueDate: r.querySelector("#fDue").value,
        content: r.querySelector("#fContent").value.trim(),
        attachmentsNote: "",
        status: "未対応",
        createdAt: new Date().toISOString().slice(0, 10),
        completedAt: null,
        effect: null,
        history: [{ date: new Date().toISOString(), user: db.currentUser().name, change: "課題を登録" }],
      };
      const tasks = db.tasks; tasks.push(task); db.tasks = tasks;
      db.audit("task_create", task.id, task.title);
      toast("改善課題を登録しました", "good");
      closeModal();
      render(root);
    };
  }});
}

function openTaskDetail(taskId, root) {
  const task = db.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const editable = can("editTasks");
  const bands = db.ratingBands;
  const selectedIds = [...task.relatedComments];
  const showEffect = !!db.brand.showEffectConfirm;
  // 現在のタスクが既に効果確認済みの場合は、非表示設定でも選択肢から消してしまうと
  // 元に戻せなくなるため、状態選択肢には残す。
  const statusOptions = showEffect || task.status === "効果確認済み" ? ALL_STATUSES : visibleStatuses();

  openModal(`
    <div class="modal-header"><h3>${escapeHtml(task.title)} ${task.severityFlag ? "🚩" : ""}</h3><button data-close>&times;</button></div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="basic">基本・実行</button>
      ${showEffect ? `<button class="tab-btn" data-tab="effect">効果確認</button>` : ""}
      <button class="tab-btn" data-tab="history">更新履歴</button>
    </div>
    <div data-pane="basic">
      <div class="field"><label>項目</label><div>${escapeHtml(db.itemById(task.itemId)?.name || "-")}</div></div>
      <div class="field"><label>状態</label>
        <select id="statusSelect" ${editable ? "" : "disabled"}>
          ${statusOptions.map((s) => `<option value="${s}" ${task.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>説明</label><textarea id="descField" ${editable ? "" : "disabled"}>${escapeHtml(task.description)}</textarea></div>
      <div class="field-row">
        <div class="field"><label>担当者</label><input type="text" id="assigneeField" value="${escapeHtml(task.assignee||"")}" ${editable?"":"disabled"}></div>
        <div class="field"><label>期限</label>${editable ? dateWidgetHtml("dueField", task.dueDate || "") : `<input type="date" id="dueField" value="${task.dueDate||""}" disabled>`}</div>
      </div>
      <div class="field"><label>対応内容</label><textarea id="contentField" ${editable?"":"disabled"}>${escapeHtml(task.content||"")}</textarea></div>
      <div class="field"><label>添付資料メモ（ファイル名等）</label><input type="text" id="attachField" value="${escapeHtml(task.attachmentsNote||"")}" ${editable?"":"disabled"}></div>
      ${editable ? commentSearchUI("edit", selectedIds) : `<div class="field"><label>関連コメント（${selectedIds.length}件）</label></div>`}
      ${editable ? `<div class="row" style="justify-content:flex-end"><button class="btn primary" id="saveDetail">保存</button></div>` : ""}
    </div>
    <div data-pane="effect" style="display:none"></div>
    <div data-pane="history" style="display:none">
      <div class="stack">
        ${task.history.slice().reverse().map((h) => `<div class="comment-item"><div class="meta">${new Date(h.date).toLocaleString("ja-JP")} ・ ${escapeHtml(h.user)}</div><div>${escapeHtml(h.change)}</div></div>`).join("")}
      </div>
    </div>
  `, { width: 680, onMount: (r) => {
    r.querySelector("[data-close]").onclick = closeModal;
    r.querySelectorAll(".tab-btn").forEach((b) => {
      b.onclick = () => {
        r.querySelectorAll(".tab-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        r.querySelectorAll("[data-pane]").forEach((p) => p.style.display = p.dataset.pane === b.dataset.tab ? "" : "none");
        if (b.dataset.tab === "effect") renderEffectPane(r, task, root);
      };
    });
    if (editable) {
      wireCommentSearch(r, "edit", selectedIds);
      wireDateWidget(r, "dueField");
      r.querySelector("#saveDetail").onclick = () => {
        const newStatus = r.querySelector("#statusSelect").value;
        const changes = [];
        if (newStatus !== task.status) {
          changes.push(`状態: ${task.status} → ${newStatus}`);
          if ((newStatus === "対応済み" || newStatus === "効果確認済み") && !task.completedAt) {
            task.completedAt = new Date().toISOString().slice(0, 10);
          }
          task.status = newStatus;
        }
        task.description = r.querySelector("#descField").value.trim();
        task.assignee = r.querySelector("#assigneeField").value.trim();
        task.dueDate = r.querySelector("#dueField").value;
        task.content = r.querySelector("#contentField").value.trim();
        task.attachmentsNote = r.querySelector("#attachField").value.trim();
        task.relatedComments = [...selectedIds];
        task.history.push({ date: new Date().toISOString(), user: db.currentUser().name, change: changes.length ? changes.join(" / ") : "内容を更新" });
        const tasks = db.tasks.map((t) => t.id === task.id ? task : t);
        db.tasks = tasks;
        db.audit("task_update", task.id, changes.join(", "));
        toast("課題を更新しました", "good");
        closeModal();
        render(root);
      };
    }
  }});
}

function renderEffectPane(modalRoot, task, root) {
  const pane = modalRoot.querySelector('[data-pane="effect"]');
  const bands = db.ratingBands;
  const eff = task.effect || {};
  pane.innerHTML = `
    <p class="hint">対応前後の期間を指定し、指標の変化を確認したうえで、人が「効果確認済み」に変更してください。</p>
    <div class="field-row">
      <div class="field"><label>比較対象期間（対応前）開始</label><input type="date" id="effBeforeStart" value="${eff.beforeStart||""}"></div>
      <div class="field"><label>対応前 終了</label><input type="date" id="effBeforeEnd" value="${eff.beforeEnd||task.createdAt||""}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>比較対象期間（対応後）開始</label><input type="date" id="effAfterStart" value="${eff.afterStart||task.completedAt||""}"></div>
      <div class="field"><label>対応後 終了</label><input type="date" id="effAfterEnd" value="${eff.afterEnd||new Date().toISOString().slice(0,10)}"></div>
    </div>
    <button class="btn small" id="calcEffect">指標を計算</button>
    <div id="effectResult" style="margin-top:12px"></div>
    <div class="field" style="margin-top:10px"><label>振り返り</label><textarea id="retro">${escapeHtml(eff.retrospective||"")}</textarea></div>
    <div class="row" style="justify-content:flex-end">
      <button class="btn primary" id="markVerified" ${task.status === "効果確認済み" ? "disabled" : ""}>効果確認済みにする</button>
    </div>
  `;
  function calc() {
    const bStart = pane.querySelector("#effBeforeStart").value;
    const bEnd = pane.querySelector("#effBeforeEnd").value;
    const aStart = pane.querySelector("#effAfterStart").value;
    const aEnd = pane.querySelector("#effAfterEnd").value;
    const before = filterRecords(db.records, { storeIds: [task.storeId], itemIds: [task.itemId], start: bStart, end: bEnd }, bands);
    const after = filterRecords(db.records, { storeIds: [task.storeId], itemIds: [task.itemId], start: aStart, end: aEnd }, bands);
    const mBefore = computeMetrics(before, bands);
    const mAfter = computeMetrics(after, bands);
    const avgDiff = delta(mAfter.avg, mBefore.avg);
    const lowDiff = delta(mAfter.lowRate, mBefore.lowRate);
    const result = { beforeStart: bStart, beforeEnd: bEnd, afterStart: aStart, afterEnd: aEnd, avgDiff, lowDiff, beforeN: before.length, afterN: after.length };
    pane.querySelector("#effectResult").innerHTML = `
      <div class="grid cols-2">
        <div class="stat-tile"><div class="label">平均評価の差</div><div class="value" style="color:${avgDiff>0?'var(--good)':avgDiff<0?'var(--bad)':'inherit'}">${avgDiff!=null?(avgDiff>0?"+":"")+avgDiff:"-"}</div></div>
        <div class="stat-tile"><div class="label">低評価率の差</div><div class="value" style="color:${lowDiff<0?'var(--good)':lowDiff>0?'var(--bad)':'inherit'}">${lowDiff!=null?(lowDiff>0?"+":"")+lowDiff+"%":"-"}</div></div>
      </div>
      <p class="hint">対応前 ${before.length}件 ／ 対応後 ${after.length}件${(before.length<5||after.length<5)?"（参考値：サンプル数が少ない）":""}</p>
    `;
    return result;
  }
  let lastResult = eff;
  pane.querySelector("#calcEffect").onclick = () => { lastResult = calc(); };
  pane.querySelector("#markVerified").onclick = () => {
    const result = lastResult.avgDiff !== undefined ? lastResult : calc();
    confirmDialog("効果確認済みに変更しますか？この操作は人による最終確認として記録されます。", () => {
      task.status = "効果確認済み";
      task.effect = { ...result, retrospective: pane.querySelector("#retro").value.trim() };
      if (!task.completedAt) task.completedAt = new Date().toISOString().slice(0, 10);
      task.history.push({ date: new Date().toISOString(), user: db.currentUser().name, change: "効果確認済みに変更（人による確認）" });
      db.tasks = db.tasks.map((t) => t.id === task.id ? task : t);
      db.audit("task_verify", task.id, "効果確認済み");
      toast("効果確認済みにしました", "good");
      closeModal();
      render(root);
    });
  };
}
