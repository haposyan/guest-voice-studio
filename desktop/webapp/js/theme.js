// ============================================================================
// theme.js — v2.19: 16色のカラーテーマ。気分転換ではなく、色弱・低視力の
// 方でも使えるようにするためのアクセシビリティ機能 — 明るい色から暗い色
// まで選べる必要がある（暗い背景・明るい文字の組み合わせが読みにくい方も
// いれば、その逆の方もいる）。
//
// サイドバー・主要ボタンなどの「ブランド面」（--brand/--brand-2）と、その
// 上に乗る文字色（--brand-contrast-text、--sidebar-text系、--sidebar-
// overlay系）を、選んだ色の明るさに応じて白系／濃色系に自動で切り替える
// ことで、どの明るさを選んでもコントラストが崩れないようにしている。
// 評価の良し悪しを示す色（good/warn/bad）はテーマの対象外 — 別の意味を
// 持つ色なので、明るさで選ばせると混乱するため固定のまま。
//
// 明るさは相対輝度（WCAGのrelative luminance計算）で判定し、しきい値
// 0.5を境に文字色を切り替える。
// ============================================================================

export const THEME_COLORS = [
  // 明るい（白に近い）順 → 暗い（黒に近い）順。ボタン等の面は薄いグレー
  // 系でも視認できるよう、最も明るいものでも背景（--ivory系）とは区別が
  // つく濃さに留めている。
  { id: "cloud", name: "雲白", main: "#e8e6df", dark: "#d6d3c8" },
  { id: "mist", name: "霧灰", main: "#c9cdd1", dark: "#aeb3b8" },
  { id: "sand", name: "砂", main: "#cdbfa0", dark: "#b0a17f" },
  { id: "sky", name: "空色", main: "#7fa8c9", dark: "#5c85a8" },
  { id: "sage-l", name: "淡セージ", main: "#8ba58f", dark: "#6c8770" },
  { id: "gold-l", name: "淡金", main: "#c9a45c", dark: "#a8843f" },
  { id: "coral", name: "珊瑚", main: "#c17a5e", dark: "#9c5c42" },
  { id: "teal", name: "青緑", main: "#146b6b", dark: "#0d4747" },
  { id: "steel", name: "鋼", main: "#2e4a5e", dark: "#1e313e" },
  { id: "forest", name: "深緑", main: "#1f4d3d", dark: "#123326" },
  { id: "navy", name: "紺（既定）", main: "#17324d", dark: "#0f2438" },
  { id: "indigo", name: "藍", main: "#22315e", dark: "#161f3e" },
  { id: "wine", name: "葡萄", main: "#4c1f3d", dark: "#321429" },
  { id: "burgundy", name: "えんじ", main: "#5c1f2e", dark: "#3d1420" },
  { id: "charcoal", name: "墨", main: "#2c2c30", dark: "#1a1a1d" },
  { id: "midnight", name: "漆黒", main: "#0c1120", dark: "#07090f" },
];

const DEFAULT_ID = "navy";

// WCAGの相対輝度計算（sRGB）。0（黒）〜1（白）。
function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyTheme(themeId) {
  const theme = THEME_COLORS.find((t) => t.id === themeId) || THEME_COLORS.find((t) => t.id === DEFAULT_ID);
  const isLight = relativeLuminance(theme.main) > 0.5;
  const root = document.documentElement.style;
  root.setProperty("--brand", theme.main);
  root.setProperty("--brand-2", theme.dark);
  if (isLight) {
    root.setProperty("--brand-contrast-text", "#1f2a24");
    root.setProperty("--sidebar-text", "#1f2a24");
    root.setProperty("--sidebar-text-soft", "#3a453f");
    root.setProperty("--sidebar-overlay-1", "rgba(0,0,0,.08)");
    root.setProperty("--sidebar-overlay-2", "rgba(0,0,0,.14)");
    root.setProperty("--sidebar-overlay-3", "rgba(0,0,0,.3)");
    root.setProperty("--sidebar-overlay-4", "rgba(0,0,0,.35)");
  } else {
    root.setProperty("--brand-contrast-text", "#fff");
    root.setProperty("--sidebar-text", "#f3ecdd");
    root.setProperty("--sidebar-text-soft", "#dfe6ee");
    root.setProperty("--sidebar-overlay-1", "rgba(255,255,255,.08)");
    root.setProperty("--sidebar-overlay-2", "rgba(255,255,255,.12)");
    root.setProperty("--sidebar-overlay-3", "rgba(255,255,255,.25)");
    root.setProperty("--sidebar-overlay-4", "rgba(255,255,255,.3)");
  }
}
