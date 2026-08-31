// ============================================================================
// history.js — "History｜履歴": import history, saved analysis views,
// report history, audit log (§4.11).
// ============================================================================

import { db, DATA_RETENTION_DAYS } from "../db.js";
import { can } from "../app.js";
import { escapeHtml, confirmDialog, toast } from "../components/ui.js";

let activeTab = "import";

export function mountHistory(root) {
  activeTab = "import";
  render(root);
}

function render(root) {
  root.innerHTML = `
    <div class="tabs">
      <button class="tab-btn ${activeTab === "import" ? "active" : ""}" data-tab="import">取込履歴</button>
      <button class="tab-btn ${activeTab === "views" ? "active" : ""}" data-tab="views">保存済み分析条件</button>
      <button class="tab-btn ${activeTab === "reports" ? "active" : ""}" data-tab="reports">報告書履歴</button>
      <button class="tab-btn ${activeTab === "audit" ? "active" : ""}" data-tab="audit">監査ログ</button>
    </div>
    <div id="pane"></div>
  `;
  root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { activeTab = b.dataset.tab; render(root); });
  renderPane(root);
}

function renderPane(root) {
  const pane = root.querySelector("#pane");
  if (activeTab === "import") return renderImportHistory(pane);
  if (activeTab === "views") return renderSavedViews(pane);
  if (activeTab === "reports") return renderReports(pane);
  if (activeTab === "audit") return renderAudit(pane);
}

function renderImportHistory(pane) {
  const batches = db.importBatches;
  pane.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>取込バッチ一覧</h3><a href="#import" class="btn small primary">＋ 新しく取り込む</a></div>
      <div class="table-wrap"><table><thead><tr>
        <th>取込日時</th><th>ファイル名</th><th>対象期間</th><th>成功/重複/エラー/対象外</th>
      </tr></thead><tbody>
        ${batches.map((b) => `<tr>
          <td>${new Date(b.importedAt).toLocaleString("ja-JP")}</td>
          <td>${escapeHtml(b.filename)}</td>
          <td>${b.periodStart||"-"} ～ ${b.periodEnd||"-"}</td>
          <td>${b.success} / ${b.duplicate} / ${b.error} / ${b.excluded}</td>
        </tr>`).join("") || `<tr><td colspan="4" class="empty-state">取込履歴がありません</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

function renderSavedViews(pane) {
  const views = db.savedViews;
  pane.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>保存済み分析条件</h3></div>
      <p class="hint">Guest Voice / Compare 画面で条件を保存すると、ここから再表示できます（試作版：手動保存機能は今後拡張）。</p>
      <div class="table-wrap"><table><thead><tr><th>名称</th><th>作成者</th><th>作成日</th></tr></thead><tbody>
        ${views.map((v) => `<tr><td>${escapeHtml(v.name)}</td><td>${escapeHtml(v.user)}</td><td>${v.createdAt}</td></tr>`).join("") || `<tr><td colspan="3" class="empty-state">保存済みの分析条件はありません</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

function renderReports(pane) {
  const reports = db.reports;
  pane.innerHTML = `
    <div class="card">
      <div class="card-title"><h3>作成済み報告書</h3><a href="#reportstudio" class="btn small primary">Report Studioへ</a></div>
      <div class="table-wrap"><table><thead><tr><th>作成日時</th><th>拠点</th><th>期間</th><th>種別</th><th>作成者</th></tr></thead><tbody>
        ${reports.map((r) => `<tr>
          <td>${new Date(r.createdAt).toLocaleString("ja-JP")}</td>
          <td>${r.storeIds.map((id) => escapeHtml(db.storeName(id))).join(", ")}</td>
          <td>${r.periodStart} ～ ${r.periodEnd}</td>
          <td>${r.type === "summary" ? "要約版" : "詳細版"}</td>
          <td>${escapeHtml(r.author||"-")}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="empty-state">作成済み報告書がありません</td></tr>`}
      </tbody></table></div>
    </div>
    <div class="card">
      <div class="card-title"><h3>Outlook下書き作成履歴</h3></div>
      <div class="table-wrap"><table><thead><tr><th>作成日時</th><th>宛先</th><th>方式</th><th>実行者</th></tr></thead><tbody>
        ${db.draftHistory.map((d) => `<tr><td>${new Date(d.createdAt).toLocaleString("ja-JP")}</td><td>${escapeHtml(d.recipientNames||"-")}</td><td>${d.method === "m365" ? "Microsoft 365連携" : "mailto（手動添付）"}</td><td>${escapeHtml(d.user)}</td></tr>`).join("") || `<tr><td colspan="4" class="empty-state">下書き作成履歴がありません</td></tr>`}
      </tbody></table></div>
    </div>
  `;
}

function renderAudit(pane) {
  const log = db.auditLog;
  pane.innerHTML = `
    <div class="card">
      <div class="card-title">
        <h3>監査ログ（誰が・いつ・何をしたか）</h3>
        ${can("deleteData") ? `<button class="btn small danger" id="purgeOld">保存期限を過ぎたログを削除</button>` : ""}
      </div>
      <p class="hint">保存期限は${DATA_RETENTION_DAYS}日（5年間）に固定されています。削除は権限者のみ実行できます。</p>
      <div class="table-wrap"><table><thead><tr><th>日時</th><th>操作者</th><th>操作</th><th>対象</th><th>詳細</th></tr></thead><tbody>
        ${log.slice(0, 200).map((l) => `<tr><td>${new Date(l.date).toLocaleString("ja-JP")}</td><td>${escapeHtml(l.user)}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.target)}</td><td>${escapeHtml(l.detail)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty-state">ログがありません</td></tr>`}
      </tbody></table></div>
    </div>
  `;
  const purgeBtn = pane.querySelector("#purgeOld");
  if (purgeBtn) purgeBtn.onclick = () => {
    confirmDialog("保存期限を過ぎた監査ログを完全に削除します。この操作は取り消せません。", () => {
      const days = DATA_RETENTION_DAYS;
      const cutoff = Date.now() - days * 86400000;
      db.auditLog = db.auditLog.filter((l) => new Date(l.date).getTime() >= cutoff);
      db.audit("purge_audit_log", "auditLog", `${days}日超のログを削除`);
      toast("保存期限を過ぎたログを削除しました", "good");
      renderAudit(pane);
    }, { danger: true, okLabel: "削除する" });
  };
}
