// ============================================================================
// wordcloud.js — renders word-frequency lists as an accessible "tag cloud"
// (flex-wrap spans sized by frequency). A true packed SVG word cloud was
// intentionally avoided: this renders instantly, wraps responsively, stays
// keyboard/screen-reader friendly, and never relies on color alone (each
// word's count is printed, not just implied by size/color) — see 非機能
// requirement on accessibility.
// ============================================================================

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

// words: [{word, count, ratePer100, negCount, posCount, midCount}]
// onPick(word) is invoked via a global handler name set on window (simplest
// wiring for dynamically-injected innerHTML without a virtual DOM).
export function renderWordCloud(words, opts = {}) {
  const limit = opts.limit || 60;
  const top = words.slice(0, limit);
  if (!top.length) {
    return `<div class="empty-state"><div class="icon">☁️</div>該当するコメントがありません</div>`;
  }
  const maxCount = Math.max(...top.map((w) => w.count));
  const minSize = 0.82, maxSize = 2.1;
  const spans = top.map((w) => {
    const scale = maxCount ? w.count / maxCount : 0;
    const size = (minSize + scale * (maxSize - minSize)).toFixed(2);
    let cls = "";
    if (w.negCount > w.posCount && w.negCount > 0) cls = "negative";
    else if (w.posCount > w.negCount && w.posCount > 0) cls = "positive";
    return `<button type="button" class="wc-word ${cls}" style="font-size:${size}em" data-word="${esc(w.word)}" title="${w.count}件 / コメント100件あたり${w.ratePer100}件">
      ${esc(w.word)}<span class="count">${w.count}</span>
    </button>`;
  }).join("");
  return `<div class="wordcloud" data-wordcloud>${spans}</div>`;
}

export function renderWordRanking(words, opts = {}) {
  const limit = opts.limit || 15;
  const top = words.slice(0, limit);
  if (!top.length) return `<div class="empty-state">頻出語がありません</div>`;
  return `<table><thead><tr><th>語</th><th>件数</th><th>出現率(/100件)</th><th>内訳(低/中/高評価)</th></tr></thead><tbody>
    ${top.map((w) => `<tr>
      <td><button type="button" class="wc-word" data-word="${esc(w.word)}" style="font-size:1em">${esc(w.word)}</button></td>
      <td>${w.count}</td>
      <td>${w.ratePer100}</td>
      <td><span class="rating-dot low">${w.negCount}</span> / <span class="rating-dot mid">${w.midCount}</span> / <span class="rating-dot high">${w.posCount}</span></td>
    </tr>`).join("")}
  </tbody></table>`;
}
