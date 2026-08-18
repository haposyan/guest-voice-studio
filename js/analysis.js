// ============================================================================
// analysis.js — filtering, aggregation, and period-comparison logic.
// Kept deliberately separate from any rendering code (non-functional
// requirement: "集計ロジックと表示ロジックを分離し...テストする").
// ============================================================================

import { db } from "./db.js";

export function pad2(n) { return String(n).padStart(2, "0"); }
export function toISODate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

export function periodPreset(name, ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth();
  if (name === "thisMonth") {
    return { start: toISODate(new Date(y, m, 1)), end: toISODate(ref) };
  }
  if (name === "lastMonth") {
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    return { start: toISODate(start), end: toISODate(end) };
  }
  if (name === "lastYearSameMonth") {
    const start = new Date(y - 1, m, 1);
    const end = new Date(y - 1, m + 1, 0);
    return { start: toISODate(start), end: toISODate(end) };
  }
  return { start: null, end: null };
}

export function ratingBandOf(rating, bands) {
  if (rating == null) return null;
  if (bands.low.includes(rating)) return "low";
  if (bands.high.includes(rating)) return "high";
  return "mid";
}

// filters: { storeIds:[]|null(=all), itemIds:[]|null, start, end, band: 'all'|'low'|'mid'|'high'|number, commentFilter: 'all'|'only'|'none' }
export function filterRecords(records, filters, bands) {
  return records.filter((r) => {
    if (filters.storeIds && filters.storeIds.length && !filters.storeIds.includes(r.storeId)) return false;
    if (filters.itemIds && filters.itemIds.length && !filters.itemIds.includes(r.itemId)) return false;
    if (filters.start && r.date < filters.start) return false;
    if (filters.end && r.date > filters.end) return false;
    if (filters.band && filters.band !== "all") {
      if (typeof filters.band === "number") {
        if (r.rating !== filters.band) return false;
      } else {
        if (ratingBandOf(r.rating, bands) !== filters.band) return false;
      }
    }
    if (filters.commentFilter === "only" && !r.comment) return false;
    if (filters.commentFilter === "none" && r.comment) return false;
    return true;
  });
}

export function uniqueResponses(records) {
  const map = new Map();
  records.forEach((r) => {
    const key = r.responseId + "|" + r.storeId;
    if (!map.has(key)) map.set(key, { responseId: r.responseId, storeId: r.storeId, date: r.date, hasExplicitId: r.hasExplicitId });
  });
  return [...map.values()];
}

export function computeMetrics(records, bands) {
  const responses = uniqueResponses(records);
  const rated = records.filter((r) => r.rating != null);
  const commented = records.filter((r) => r.comment);
  const avg = rated.length ? rated.reduce((s, r) => s + r.rating, 0) / rated.length : null;
  const sorted = rated.map((r) => r.rating).sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
    : null;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  rated.forEach((r) => { distribution[r.rating] = (distribution[r.rating] || 0) + 1; });
  const lowCount = rated.filter((r) => bands.low.includes(r.rating)).length;
  const lowRate = rated.length ? +(lowCount / rated.length * 100).toFixed(1) : null;
  const fillRate = records.length ? +(commented.length / records.length * 100).toFixed(1) : 0;

  return {
    responseCount: responses.length,
    recordCount: records.length,
    ratedCount: rated.length,
    commentCount: commented.length,
    fillRate,
    avg: avg != null ? +avg.toFixed(2) : null,
    median,
    distribution,
    lowRate,
    lowCount,
  };
}

export function itemBreakdown(records, itemMappings, bands) {
  return itemMappings.map((im) => {
    const itemRecords = records.filter((r) => r.itemId === im.id);
    return { item: im, metrics: computeMetrics(itemRecords, bands) };
  });
}

export function storeBreakdown(records, stores, bands) {
  return stores.map((s) => {
    const storeRecords = records.filter((r) => r.storeId === s.id);
    return { store: s, metrics: computeMetrics(storeRecords, bands) };
  });
}

export function delta(a, b) {
  if (a == null || b == null) return null;
  return +(a - b).toFixed(2);
}

// Compare two word-frequency lists (from tokenizer.computeWordFrequencies)
export function compareThemes(wordsA, wordsB, commentCountA, commentCountB) {
  const mapB = new Map(wordsB.map((w) => [w.word, w]));
  const mapA = new Map(wordsA.map((w) => [w.word, w]));
  const all = new Set([...mapA.keys(), ...mapB.keys()]);
  const rows = [];
  all.forEach((word) => {
    const a = mapA.get(word);
    const b = mapB.get(word);
    const rateA = a ? a.ratePer100 : 0;
    const rateB = b ? b.ratePer100 : 0;
    let status;
    if (a && !b) status = "new";
    else if (!a && b) status = "disappeared";
    else if (rateA > rateB) status = "increasing";
    else if (rateA < rateB) status = "decreasing";
    else status = "flat";
    rows.push({ word, countA: a?.count || 0, countB: b?.count || 0, rateA, rateB, diff: +(rateA - rateB).toFixed(1), status });
  });
  rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
  return rows;
}

export function isLowSample(n, threshold = 5) { return n < threshold; }
