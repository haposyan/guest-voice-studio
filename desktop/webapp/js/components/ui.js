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
