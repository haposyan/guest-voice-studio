// ============================================================================
// theme.js — v2.18: 16色のカラーテーマ。サイドバー・見出し・主要ボタンの
// 色（--navy／--navy-2）を差し替える。低評価/中立/高評価などの意味を持つ色
// （--good/--warn/--bad等）は評価の意味と結びついているため対象外 —
// テーマで変えるのはあくまで「拠点ごとのブランドカラー」の部分のみ。
//
// 16色ぶんの --navy-2（濃い版）は都度計算せず、あらかじめ暗くした値を
// 静的に持っておく（実行時計算だと毎回同じ結果になるだけで無駄なため）。
// ============================================================================

export const THEME_COLORS = [
  { id: "navy", name: "紺（既定）", main: "#17324d", dark: "#0f2438" },
  { id: "forest", name: "深緑", main: "#1f4d3d", dark: "#123326" },
  { id: "burgundy", name: "えんじ", main: "#5c1f2e", dark: "#3d1420" },
  { id: "plum", name: "梅紫", main: "#4a2b52", dark: "#301c36" },
  { id: "teal", name: "青緑", main: "#146b6b", dark: "#0d4747" },
  { id: "charcoal", name: "墨", main: "#2c2c30", dark: "#1a1a1d" },
  { id: "brick", name: "レンガ", main: "#7a3b26", dark: "#522819" },
  { id: "indigo", name: "藍", main: "#22315e", dark: "#161f3e" },
  { id: "olive", name: "オリーブ", main: "#4d4a1f", dark: "#333113" },
  { id: "slate", name: "鉄紺", main: "#374956", dark: "#25313a" },
  { id: "wine", name: "葡萄", main: "#4c1f3d", dark: "#321429" },
  { id: "moss", name: "苔", main: "#3a4d2e", dark: "#27331f" },
  { id: "steel", name: "鋼", main: "#2e4a5e", dark: "#1e313e" },
  { id: "chestnut", name: "栗", main: "#5a3a24", dark: "#3c2718" },
  { id: "midnight", name: "濃紺", main: "#131c33", dark: "#0c1222" },
  { id: "sage", name: "セージ", main: "#3f524a", dark: "#2a3732" },
];

const DEFAULT_ID = "navy";

export function applyTheme(themeId) {
  const theme = THEME_COLORS.find((t) => t.id === themeId) || THEME_COLORS.find((t) => t.id === DEFAULT_ID);
  document.documentElement.style.setProperty("--navy", theme.main);
  document.documentElement.style.setProperty("--navy-2", theme.dark);
}
