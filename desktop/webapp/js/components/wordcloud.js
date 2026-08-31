// ============================================================================
// wordcloud.js — renders word-frequency lists as an accessible "tag cloud"
// (flex-wrap spans sized by frequency). A true packed SVG word cloud was
// intentionally avoided: this renders instantly, wraps responsively, stays
// keyboard/screen-reader friendly, and never relies on color alone (each
// word's count is printed, not just implied by size/color) — see 非機能
// requirement on accessibility.
//
// v2 adds ANL-03's 3-color positive/negative/neutral coding with an always
// visible legend, and ANL-07's manual sentiment correction (a "分類を修正"
// mode that turns clicking a word into cycling its sentiment instead of
// opening its source comments — wired up by the caller, see guestvoice.js).
// ============================================================================

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }

const SENTIMENT_LABEL = { positive: "ポジティブ", negative: "ネガティブ", neutral: "中性" };

// words: [{word, count, ratePer100, negCount, posCount, midCount, sentiment, sentimentIsOverridden}]
export function renderWordCloud(words, opts = {}) {
  const limit = opts.limit || 60;
  const editMode = !!opts.editMode;
  const top = words.slice(0, limit);
  if (!top.length) {
    return `<div class="empty-state"><div class="icon">☁️</div>該当するコメントがありません</div>`;
  }
  const maxCount = Math.max(...top.map((w) => w.count));
  const minSize = 0.82, maxSize = 2.1;
  const spans = top.map((w) => {
    const scale = maxCount ? w.count / maxCount : 0;
    const size = (minSize + scale * (maxSize - minSize)).toFixed(2);
    const title = editMode
      ? `分類: ${SENTIMENT_LABEL[w.sentiment]}${w.sentimentIsOverridden ? "（手動修正済み）" : ""} — クリックで変更`
      : `${w.count}件 / コメント100件あたり${w.ratePer100}件 / ${SENTIMENT_LABEL[w.sentiment]}`;
    return `<button type="button" class="wc-word ${w.sentiment}" style="font-size:${size}em" data-word="${esc(w.word)}" title="${title}">
      ${esc(w.word)}<span class="count">${w.count}</span>${w.sentimentIsOverridden ? '<span class="wc-override-mark" title="手動修正済み">✎</span>' : ""}
    </button>`;
  }).join("");
  return `<div class="wordcloud" data-wordcloud>${spans}</div>`;
}

export function renderSentimentLegend() {
  return `<div class="wc-legend" role="img" aria-label="ワードクラウドの色分け凡例">
    <span class="wc-legend-item"><span class="wc-swatch positive"></span>ポジティブ</span>
    <span class="wc-legend-item"><span class="wc-swatch negative"></span>ネガティブ</span>
    <span class="wc-legend-item"><span class="wc-swatch neutral"></span>中性</span>
  </div>
  <p class="muted" style="font-size:.76rem;margin:2px 0 10px">
    ※色は単語そのものの意味ではなく、「その単語を含むコメントの評価点」の内訳（低評価/中立/高評価のどれが多いか）で自動的に判定しています。
    そのため一般的にはネガティブな響きの語でも、高評価のコメントに多く出てくればポジティブ表示になることがあります。
  </p>`;
}

export function renderWordRanking(words, opts = {}) {
  const limit = opts.limit || 15;
  const top = words.slice(0, limit);
  if (!top.length) return `<div class="empty-state">頻出語がありません</div>`;
  return `<div class="wc-ranking">
    <p class="muted" style="font-size:.78rem;margin:0 0 6px">出現件数が多い順に上位${limit}件のみ表示しています。</p>
    <table><thead><tr><th>語</th><th>分類</th><th>件数</th><th>出現率(/100件)</th><th>内訳(低/中/高評価)</th></tr></thead><tbody>
    ${top.map((w) => `<tr>
      <td><button type="button" class="wc-word ${w.sentiment}" data-word="${esc(w.word)}" style="font-size:1em">${esc(w.word)}${w.sentimentIsOverridden ? '<span class="wc-override-mark">✎</span>' : ""}</button></td>
      <td><span class="sentiment-pill ${w.sentiment}">${SENTIMENT_LABEL[w.sentiment]}</span></td>
      <td>${w.count}</td>
      <td>${w.ratePer100}</td>
      <td><span class="rating-dot low">${w.negCount}</span> / <span class="rating-dot mid">${w.midCount}</span> / <span class="rating-dot high">${w.posCount}</span></td>
    </tr>`).join("")}
  </tbody></table>
  </div>`;
}
