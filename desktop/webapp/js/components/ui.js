// ============================================================================
// ui.js — tiny shared UI helpers: toasts, modal, confirm dialog.
// ============================================================================

export function toast(message, kind = "") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3400);
}

let modalRoot = null;
export function openModal(innerHtml, { onMount, width } = {}) {
  closeModal();
  modalRoot = document.createElement("div");
  modalRoot.className = "modal-backdrop";
  modalRoot.innerHTML = `<div class="modal" style="${width ? `width:${width}px` : ""}">${innerHtml}</div>`;
  modalRoot.addEventListener("click", (e) => { if (e.target === modalRoot) closeModal(); });
  document.body.appendChild(modalRoot);
  if (onMount) onMount(modalRoot);
  return modalRoot;
}
export function closeModal() {
  if (modalRoot) { modalRoot.remove(); modalRoot = null; }
}

export function confirmDialog(message, onConfirm, opts = {}) {
  openModal(`
    <div class="modal-header"><h3>${opts.title || "確認"}</h3><button data-close>&times;</button></div>
    <p>${message}</p>
    <div class="row" style="justify-content:flex-end">
      <button class="btn" data-cancel>キャンセル</button>
      <button class="btn ${opts.danger ? "danger" : "primary"}" data-ok>${opts.okLabel || "OK"}</button>
    </div>
  `, {
    onMount: (root) => {
      root.querySelector("[data-close]").onclick = closeModal;
      root.querySelector("[data-cancel]").onclick = closeModal;
      root.querySelector("[data-ok]").onclick = () => { closeModal(); onConfirm(); };
    },
  });
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fmtDate(iso) {
  if (!iso) return "-";
  return iso;
}

export function fmtNum(n, digits = 1) {
  if (n == null || isNaN(n)) return "-";
  return Number(n).toFixed(digits).replace(/\.0$/, digits === 1 ? ".0" : "");
}

// v2.18: 期限入力用の日付ウィジェット。西暦4桁→月2桁→日2桁の順に、頭から
// 続けて数字を打つだけで次の欄へ自動的に進む（標準の<input type=date>は
// クリックしてカレンダーから選ぶ操作が前提で、キーボードだけでの直接入力が
// 分かりにくいという声への対応）。値はhidden inputにISO形式（YYYY-MM-DD）で
// 持つので、呼び出し側は今まで通り document.getElementById(id).value を
// 読むだけでよい — wireDateWidget()を呼び忘れなければ挙動を差し替えるだけで
// 既存の保存ロジックに変更は不要。
export function dateWidgetHtml(id, value) {
  const [y, m, d] = (value || "").split("-");
  return `<div class="date-widget" data-date-widget="${id}">
    <input type="text" inputmode="numeric" maxlength="4" placeholder="西暦" class="date-y" value="${y || ""}">
    <span class="sep">/</span>
    <input type="text" inputmode="numeric" maxlength="2" placeholder="月" class="date-m" value="${m || ""}">
    <span class="sep">/</span>
    <input type="text" inputmode="numeric" maxlength="2" placeholder="日" class="date-d" value="${d || ""}">
    <input type="hidden" id="${id}" value="${value || ""}">
  </div>`;
}

export function wireDateWidget(root, id) {
  const wrap = root.querySelector(`[data-date-widget="${id}"]`);
  if (!wrap) return;
  const y = wrap.querySelector(".date-y"), m = wrap.querySelector(".date-m"), d = wrap.querySelector(".date-d");
  const hidden = wrap.querySelector(`#${id}`);
  function sync() {
    const yy = y.value.trim();
    const mm = m.value.trim();
    const dd = d.value.trim();
    hidden.value = (yy.length === 4 && mm && dd) ? `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}` : "";
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }
  y.oninput = () => { y.value = y.value.replace(/\D/g, "").slice(0, 4); if (y.value.length === 4) m.focus(); sync(); };
  m.oninput = () => { m.value = m.value.replace(/\D/g, "").slice(0, 2); if (m.value.length === 2) d.focus(); sync(); };
  d.oninput = () => { d.value = d.value.replace(/\D/g, "").slice(0, 2); sync(); };
  [y, m, d].forEach((el) => { el.onblur = sync; });
}
