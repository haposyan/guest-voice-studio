// ============================================================================
// db.js — persistence layer (localStorage-backed prototype "database").
//
// Production note: this in-browser store is a prototype stand-in. The real
// deployment should replace it with a server-side DB reachable only via an
// authenticated API (see README §要確認事項 / 非機能要件).
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
  retention: "retention",
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
// Seed data
// ---------------------------------------------------------------------------
const STORE_NAMES = [
  "札幌店","函館店","盛岡店","仙台店","郡山店","水戸店","宇都宮店","前橋店","さいたま店","千葉店",
  "新宿店","渋谷店","横浜店","川崎店","新潟店","富山店","金沢店","福井店","甲府店","長野店",
  "岐阜店","静岡店","名古屋店","津店","大津店","京都店","大阪店","神戸店","奈良店","和歌山店",
  "岡山店","広島店","高松店","松山店","福岡店",
];

function seedStores() {
  return STORE_NAMES.map((name, i) => ({
    id: "st_" + String(i + 1).padStart(2, "0"),
    name,
    aliases: [name.replace("店", ""), name.replace("店", "支店")],
    active: true,
  }));
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

function seedUsers(stores) {
  return [
    { id: "u_admin", name: "本部 太郎", email: "honbu.taro@example.co.jp", role: "本部管理者", storeIds: stores.map((s) => s.id) },
    { id: "u_mgr1", name: "拠点 花子", email: "hanako@example.co.jp", role: "拠点責任者", storeIds: ["st_11"] }, // 新宿店
    { id: "u_mgr2", name: "拠点 次郎", email: "jiro@example.co.jp", role: "拠点責任者", storeIds: ["st_27"] }, // 大阪店
    { id: "u_view1", name: "閲覧 三郎", email: "saburo@example.co.jp", role: "閲覧者", storeIds: stores.map((s) => s.id) },
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

function seedRecipients() {
  return [
    {
      id: uid("rcp"),
      name: "エリアマネージャー 佐藤様",
      email: "sato.area@example.co.jp",
      cc: "honbu.taro@example.co.jp",
      storeIds: ["st_11"],
      subjectTemplate: "【{{store}}】お客様の声 月次報告（{{period}}）",
      bodyTemplate: "佐藤様\n\nお世話になっております。{{store}}の{{period}}分お客様の声レポートを添付いたします。\nご確認のほど、よろしくお願いいたします。\n\n{{author}}",
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const db = {
  init() {
    if (!localStorage.getItem(NS + KEYS.stores)) {
      const stores = seedStores();
      save(KEYS.stores, stores);
      save(KEYS.users, seedUsers(stores));
    }
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
    if (!localStorage.getItem(NS + KEYS.brand)) save(KEYS.brand, { company: "サンプル株式会社", logo: "", retentionDays: 1095, keepRawCsv: false });
  },

  resetAll() {
    Object.values(KEYS).forEach((k) => localStorage.removeItem(NS + k));
    this.init();
  },

  uid,

  // -- generic getters/setters --
  get stores() { return load(KEYS.stores, []); },
  set stores(v) { save(KEYS.stores, v); },
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
};

db.init();
