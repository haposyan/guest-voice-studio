// ============================================================================
// db.js — persistence layer (browser localStorage, scoped per-user by
// WebView2's per-app UserDataFolder under %LOCALAPPDATA%\GuestVoiceStudio —
// see desktop/MainWindow.xaml.cs). No server, no sync (customer_voice_
// requirements_local_v2.docx §7 保存先/同期, §11 ホスティング).
//
// v2 pivot: this build is single-store only. There is no HQ/本部 role, no
// cross-store aggregation — every install serves exactly one 拠点 (§14 第2版
// の変更点). "stores" still exists as a length-1 array (rather than a bare
// object) purely so analysis.js/csv.js's store-scoped logic didn't need a
// parallel single-store code path — MAP-04's alias matching still applies to
// this one store, in case the CSV's store-name column doesn't exactly match.
// ============================================================================

const NS = "cv_";
const KEYS = {
  stores: "stores",
  users: "users",
  session: "session",
  itemMappings: "itemMappings",
  records: "records",
  importBatches: "importBatches",
  excludedWords: "excludedWords",
  tasks: "tasks",
  reports: "reports",
  recipients: "recipients",
  draftHistory: "draftHistory",
  auditLog: "auditLog",
  savedViews: "savedViews",
  ratingBands: "ratingBands",
  brand: "brand",
  sentimentOverrides: "sentimentOverrides",
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("db.load failed for", key, e);
    return fallback;
  }
}
function save(key, value) {
  localStorage.setItem(NS + key, JSON.stringify(value));
}
function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

// ---------------------------------------------------------------------------
// Seed data — single store, unconfigured until first-run setup names it.
// ---------------------------------------------------------------------------
const LOCAL_STORE_ID = "st_local";

function seedStores() {
  return [{ id: LOCAL_STORE_ID, name: "", aliases: [], active: true, configured: false }];
}

function seedItemMappings() {
  const defs = [
    { key: "接客対応", category: "サービス" },
    { key: "清潔さ", category: "施設" },
    { key: "設備", category: "施設" },
    { key: "対応スピード", category: "サービス" },
    { key: "総合満足度", category: "総合" },
  ];
  return defs.map((d, i) => ({
    id: "it_" + String(i + 1).padStart(2, "0"),
    name: d.key,
    category: d.category,
    ratingCol: `${d.key}_評価`,
    commentCol: `${d.key}_コメント`,
    enabled: true,
    favorite: i === 4,
    sortOrder: i,
  }));
}

// Local roles only (AUTH-02): no company accounts, no email. A single
// Windows user profile can switch between roles to preview each view.
function seedUsers() {
  return [
    { id: "u_setup", name: "設定担当", role: "拠点設定担当", storeIds: [LOCAL_STORE_ID] },
    { id: "u_staff", name: "拠点利用者", role: "拠点利用者", storeIds: [LOCAL_STORE_ID] },
    { id: "u_view", name: "閲覧者", role: "閲覧者", storeIds: [LOCAL_STORE_ID] },
  ];
}

function seedExcludedWords() {
  return {
    common: ["こと", "ため", "よう", "これ", "それ", "あの", "この", "とても", "少し", "ちょっと", "です", "ます", "した", "して", "いる", "ある", "なり", "また", "など"],
    byStore: {},
    byItem: {},
  };
}

function seedRatingBands() {
  return { low: [1, 2], mid: [3], high: [4, 5] };
}

function seedRecipients() { return []; }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const db = {
  LOCAL_STORE_ID,

  init() {
    if (!localStorage.getItem(NS + KEYS.stores)) save(KEYS.stores, seedStores());
    if (!localStorage.getItem(NS + KEYS.users)) save(KEYS.users, seedUsers());
    if (!localStorage.getItem(NS + KEYS.itemMappings)) save(KEYS.itemMappings, seedItemMappings());
    if (!localStorage.getItem(NS + KEYS.records)) save(KEYS.records, []);
    if (!localStorage.getItem(NS + KEYS.importBatches)) save(KEYS.importBatches, []);
    if (!localStorage.getItem(NS + KEYS.excludedWords)) save(KEYS.excludedWords, seedExcludedWords());
    if (!localStorage.getItem(NS + KEYS.tasks)) save(KEYS.tasks, []);
    if (!localStorage.getItem(NS + KEYS.reports)) save(KEYS.reports, []);
    if (!localStorage.getItem(NS + KEYS.recipients)) save(KEYS.recipients, seedRecipients());
    if (!localStorage.getItem(NS + KEYS.draftHistory)) save(KEYS.draftHistory, []);
    if (!localStorage.getItem(NS + KEYS.auditLog)) save(KEYS.auditLog, []);
    if (!localStorage.getItem(NS + KEYS.savedViews)) save(KEYS.savedViews, []);
    if (!localStorage.getItem(NS + KEYS.ratingBands)) save(KEYS.ratingBands, seedRatingBands());
    if (!localStorage.getItem(NS + KEYS.brand)) save(KEYS.brand, { company: "", logo: "", retentionDays: 1095, keepRawCsv: false });
    if (!localStorage.getItem(NS + KEYS.sentimentOverrides)) save(KEYS.sentimentOverrides, {});
  },

  resetAll() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(NS + k));
    this.init();
  },

  uid,

  get stores() { return load(KEYS.stores, []); },
  set stores(v) { save(KEYS.stores, v); },
  get localStore() { return this.stores.find((s) => s.id === LOCAL_STORE_ID); },
  get isConfigured() { return !!this.localStore?.configured; },

  get users() { return load(KEYS.users, []); },
  set users(v) { save(KEYS.users, v); },
  get session() { return load(KEYS.session, null); },
  set session(v) { save(KEYS.session, v); },
  get itemMappings() { return load(KEYS.itemMappings, []); },
  set itemMappings(v) { save(KEYS.itemMappings, v); },
  get records() { return load(KEYS.records, []); },
  set records(v) { save(KEYS.records, v); },
  get importBatches() { return load(KEYS.importBatches, []); },
  set importBatches(v) { save(KEYS.importBatches, v); },
  get excludedWords() { return load(KEYS.excludedWords, seedExcludedWords()); },
  set excludedWords(v) { save(KEYS.excludedWords, v); },
  get tasks() { return load(KEYS.tasks, []); },
  set tasks(v) { save(KEYS.tasks, v); },
  get reports() { return load(KEYS.reports, []); },
  set reports(v) { save(KEYS.reports, v); },
  get recipients() { return load(KEYS.recipients, []); },
  set recipients(v) { save(KEYS.recipients, v); },
  get draftHistory() { return load(KEYS.draftHistory, []); },
  set draftHistory(v) { save(KEYS.draftHistory, v); },
  get auditLog() { return load(KEYS.auditLog, []); },
  set auditLog(v) { save(KEYS.auditLog, v); },
  get savedViews() { return load(KEYS.savedViews, []); },
  set savedViews(v) { save(KEYS.savedViews, v); },
  get ratingBands() { return load(KEYS.ratingBands, seedRatingBands()); },
  set ratingBands(v) { save(KEYS.ratingBands, v); },
  get brand() { return load(KEYS.brand, {}); },
  set brand(v) { save(KEYS.brand, v); },
  get sentimentOverrides() { return load(KEYS.sentimentOverrides, {}); },
  set sentimentOverrides(v) { save(KEYS.sentimentOverrides, v); },

  currentUser() {
    const s = this.session;
    if (!s) return null;
    return this.users.find((u) => u.id === s.userId) || null;
  },

  storeById(id) { return this.stores.find((s) => s.id === id); },
  storeName(id) { return this.storeById(id)?.name || id; },
  itemById(id) { return this.itemMappings.find((i) => i.id === id); },

  audit(action, target, detail) {
    const u = this.currentUser();
    const log = this.auditLog;
    log.unshift({
      id: uid("log"),
      action, target, detail: detail || "",
      user: u ? u.name : "system",
      date: new Date().toISOString(),
    });
    this.auditLog = log.slice(0, 2000);
  },

  // ---- Full-state export/import, used by the encrypted backup feature ----
  exportState() {
    const state = {};
    Object.entries(KEYS).forEach(([prop, key]) => { state[prop] = load(key, null); });
    return state;
  },
  importState(state) {
    Object.entries(KEYS).forEach(([prop, key]) => {
      if (state[prop] !== undefined) save(key, state[prop]);
    });
  },
};

db.init();
