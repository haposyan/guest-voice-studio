// ============================================================================
// tokenizer.js — lightweight Japanese "word" extraction for the word cloud
// and frequency ranking (ANL-01 / ANL-03).
//
// KNOWN LIMITATION (see README §要確認事項): this is NOT a real morphological
// analyzer. No dictionary-based tokenizer (kuromoji.js / Sudachi / MeCab) is
// bundled because the environment this prototype was built in has no
// Node/npm access to fetch one, and the spec explicitly forbids sending
// comment text to external services. Instead we extract:
//   - runs of Kanji/Katakana (2+ chars) as candidate nouns — these carry most
//     of the meaningful "themes" in Japanese customer feedback (スタッフ,
//     清掃, 駐車場, 対応, 料理 ...)
//   - alphanumeric tokens as-is
// Hiragana-only runs (mostly particles/verb conjugations) are dropped, since
// they rarely carry theme information and would otherwise dominate the cloud
// with grammatical noise.
// Recommended upgrade path: swap `extractWords()` for a call into a real
// morphological analyzer once the team can vet an offline dictionary bundle.
// ============================================================================

const KANJI = "\\u4E00-\\u9FFF\\u3005";
const KATAKANA = "\\u30A0-\\u30FF\\uFF66-\\uFF9D";
const LATIN_NUM = "A-Za-z0-9";

const WORD_RE = new RegExp(`[${KANJI}${KATAKANA}]{2,}|[${LATIN_NUM}]{2,}`, "g");

export function extractWords(text) {
  if (!text) return [];
  const matches = text.match(WORD_RE) || [];
  return matches;
}

export function tokenizeComment(text, stopwords) {
  const stop = stopwords instanceof Set ? stopwords : new Set(stopwords || []);
  return extractWords(text).filter((w) => !stop.has(w) && w.length >= 2);
}

// Build a merged stopword set from common + per-store + per-item lists.
export function buildStopwordSet(excludedWords, storeId, itemId) {
  const set = new Set(excludedWords.common || []);
  (excludedWords.byStore?.[storeId] || []).forEach((w) => set.add(w));
  (excludedWords.byItem?.[itemId] || []).forEach((w) => set.add(w));
  return set;
}

// records: array of {comment, rating, storeId, itemId, ...}
// returns [{word, count, ratePer100, negCount, posCount, midCount}]
export function computeWordFrequencies(records, excludedWords, ratingBands) {
  const freq = new Map();
  let commentCount = 0;
  records.forEach((rec) => {
    if (!rec.comment) return;
    commentCount++;
    const stop = buildStopwordSet(excludedWords, rec.storeId, rec.itemId);
    const words = tokenizeComment(rec.comment, stop);
    const uniqueInComment = new Set(words);
    uniqueInComment.forEach((w) => {
      const entry = freq.get(w) || { word: w, count: 0, negCount: 0, posCount: 0, midCount: 0, recordIds: [] };
      entry.count++;
      entry.recordIds.push(rec.id);
      if (rec.rating != null) {
        if (ratingBands.low.includes(rec.rating)) entry.negCount++;
        else if (ratingBands.high.includes(rec.rating)) entry.posCount++;
        else entry.midCount++;
      }
      freq.set(w, entry);
    });
  });
  const list = [...freq.values()].map((e) => ({
    ...e,
    ratePer100: commentCount ? +(e.count / commentCount * 100).toFixed(1) : 0,
  }));
  list.sort((a, b) => b.count - a.count);
  return { words: list, commentCount };
}
