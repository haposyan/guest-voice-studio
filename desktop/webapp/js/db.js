// ============================================================================
// db.js — persistence layer (browser localStorage, scoped per-user by
// WebView2's per-app UserDataFolder — location chosen by the user on first
// launch, see desktop/MainWindow.xaml.cs). No server, no sync (customer_voice_
// requirements_local_v2.docx §7 保存先/同期, §11 ホスティング).
//
// v2 pivot: this build is single-store only. There is no HQ/本部 role, no
// cross-store aggregation — every install serves exactly one 拠点 (§14 第2版
// の変更点). "stores" still exists as a length-1 array (rather than a bare
// object) purely so analysis.js/csv.js's store-scoped logic didn't need a
// parallel single-store code path — MAP-04's alias matching still applies to
// this one store, in case the CSV's store-name column doesn't exactly match.
//
// Local role selection was removed after real-world feedback that a single
// PC used by one small team doesn't need a role picker ("違いが判りません").
// There's one implicit local user; who-did-what in the audit log is recorded
// using the signed-in Windows account name instead (see currentUser()).
// ============================================================================

const NS = "cv_";
const KEYS = {
  stores: "stores",
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
// Official 休暇村 facility list (一般財団法人休暇村協会 — www.qkamura.or.jp/list/),
// grouped by region, for the first-run store picker (§ setup.js). Kept as
// data here rather than free text so the store name always matches the real
// facility name. "その他（一覧にない）" lets a user type a name manually if
// their facility isn't listed here (e.g. a new opening not yet reflected).
// ---------------------------------------------------------------------------
export const KYUKAMURA_REGIONS = [
  { region: "北海道・東北", hotels: ["休暇村 支笏湖", "休暇村 岩手網張温泉", "休暇村 陸中宮古", "休暇村 乳頭温泉郷", "休暇村 気仙沼大島", "休暇村 庄内羽黒", "休暇村 裏磐梯"] },
  { region: "関東・甲信越", hotels: ["休暇村 那須", "休暇村 日光湯元", "休暇村 嬬恋鹿沢", "休暇村 奥武蔵", "休暇村 館山", "休暇村 妙高", "リトリート安曇野ホテル", "休暇村 乗鞍高原"] },
  { region: "東海・北陸", hotels: ["休暇村 南伊豆", "休暇村 富士", "休暇村 伊良湖", "休暇村 茶臼山高原", "休暇村 能登千里浜", "休暇村 越前三国"] },
  { region: "近畿", hotels: ["休暇村 近江八幡", "休暇村 南淡路", "休暇村 竹野海岸", "休暇村 紀州加太", "休暇村 南紀勝浦"] },
  { region: "中国・四国", hotels: ["休暇村 奥大山", "休暇村 蒜山高原", "休暇村 大久野島", "休暇村 帝釈峡", "休暇村 讃岐五色台", "休暇村 瀬戸内東予"] },
  { region: "九州", hotels: ["休暇村 志賀島", "休暇村 南阿蘇", "休暇村 指宿"] },
];

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
    if (!localStorage.getItem(NS + KEYS.brand)) save(KEYS.brand, { company: "一般財団法人休暇村協会", logo: "", retentionDays: 1095, keepRawCsv: false });
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

  // No login screen: there is one implicit local user. Audit entries are
  // attributed to the signed-in Windows account (window.__NATIVE__) when
  // running in the desktop shell, so "who did it" is still meaningful.
  currentUser() {
    const winName = (typeof window !== "undefined" && window.__NATIVE__?.windowsUserName) || null;
    return { id: "local", name: winName || "利用者", role: "利用者" };
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
      user: u.name,
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
