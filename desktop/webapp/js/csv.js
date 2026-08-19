// ============================================================================
// csv.js — CSV import: encoding detection, RFC4180-ish parsing, preview,
// store-name/alias resolution, duplicate detection, row-level import.
// Implements IMP-01..06 and MAP-04.
// ============================================================================

export async function readFileSmart(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // BOM check
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.slice(3)), encoding: "UTF-8 (BOM)" };
  }

  // Try strict UTF-8 first
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "UTF-8" };
  } catch (e) {
    // fall through to Shift-JIS
  }

  try {
    const text = new TextDecoder("shift_jis", { fatal: true }).decode(bytes);
    return { text, encoding: "Shift-JIS" };
  } catch (e) {
    // last resort: lenient utf-8 (may show mojibake — surfaced to user in preview)
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { text, encoding: "不明（UTF-8として読み込み。文字化けの可能性）" };
  }
}

// Minimal RFC4180 parser: handles quoted fields, embedded commas/newlines, "" escapes.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
    return obj;
  });
  return { headers, rows: dataRows };
}

const ID_HEADER_CANDIDATES = ["回答ID", "ID", "id", "response_id"];
const DATE_HEADER_CANDIDATES = ["回答日", "日付", "date", "response_date"];
const STORE_HEADER_CANDIDATES = ["拠点名", "拠点", "店舗名", "store", "store_name"];

function pickHeader(headers, candidates) {
  return candidates.find((c) => headers.includes(c)) || null;
}

export function resolveStore(name, stores) {
  if (!name) return null;
  const trimmed = name.trim();
  let hit = stores.find((s) => s.name === trimmed);
  if (hit) return hit;
  hit = stores.find((s) => (s.aliases || []).includes(trimmed));
  if (hit) return hit;
  // loose match: strip common suffixes
  const bare = trimmed.replace(/(店|支店|営業所)$/,"");
  hit = stores.find((s) => s.name.replace(/(店|支店|営業所)$/, "") === bare);
  return hit || null;
}

function isValidDate(str) {
  if (!str) return false;
  const d = new Date(str);
  return !isNaN(d.getTime());
}

// Builds a preview summary without mutating the DB — used before commit.
export function buildPreview(parsed, itemMappings, stores) {
  const { headers, rows } = parsed;
  const idHeader = pickHeader(headers, ID_HEADER_CANDIDATES);
  const dateHeader = pickHeader(headers, DATE_HEADER_CANDIDATES);
  const storeHeader = pickHeader(headers, STORE_HEADER_CANDIDATES);

  const columnStatus = itemMappings.map((im) => ({
    item: im.name,
    ratingCol: im.ratingCol,
    commentCol: im.commentCol,
    ratingFound: headers.includes(im.ratingCol),
    commentFound: headers.includes(im.commentCol),
  }));

  const storeNamesInFile = new Set();
  const unmatchedStores = new Set();
  let minDate = null, maxDate = null;
  let missingIdCount = 0;
  let invalidDateCount = 0;

  rows.forEach((r) => {
    const storeRaw = storeHeader ? r[storeHeader] : "";
    if (storeRaw) {
      storeNamesInFile.add(storeRaw);
      if (!resolveStore(storeRaw, stores)) unmatchedStores.add(storeRaw);
    }
    const dateRaw = dateHeader ? r[dateHeader] : "";
    if (isValidDate(dateRaw)) {
      if (!minDate || dateRaw < minDate) minDate = dateRaw;
      if (!maxDate || dateRaw > maxDate) maxDate = dateRaw;
    } else {
      invalidDateCount++;
    }
    if (idHeader && !r[idHeader]) missingIdCount++;
    if (!idHeader) missingIdCount++;
  });

  return {
    totalRows: rows.length,
    idHeader, dateHeader, storeHeader,
    columnStatus,
    storeNamesInFile: [...storeNamesInFile],
    unmatchedStores: [...unmatchedStores],
    periodStart: minDate, periodEnd: maxDate,
    missingIdCount, invalidDateCount,
    hasIdColumn: !!idHeader,
  };
}

// Commits rows into flattened per-item records. Dedupe key = response ID.
// Rows without an ID cannot be deduped — they are imported but flagged.
export function importRows(parsed, itemMappings, stores, existingRecords, batchId) {
  const { headers, rows } = parsed;
  const idHeader = pickHeader(headers, ID_HEADER_CANDIDATES);
  const dateHeader = pickHeader(headers, DATE_HEADER_CANDIDATES);
  const storeHeader = pickHeader(headers, STORE_HEADER_CANDIDATES);

  const existingIds = new Set(existingRecords.filter((r) => r.responseId).map((r) => r.responseId));
  const seenThisBatch = new Set();

  const result = { success: 0, duplicate: 0, error: 0, excluded: 0, warnedNoId: 0, newRecords: [], errorRows: [] };

  rows.forEach((r, idx) => {
    const responseId = idHeader ? r[idHeader] : "";
    const dateRaw = dateHeader ? r[dateHeader] : "";
    const storeRaw = storeHeader ? r[storeHeader] : "";
    const store = resolveStore(storeRaw, stores);

    if (!store || !isValidDate(dateRaw)) {
      result.error++;
      result.errorRows.push({ row: idx + 2, reason: !store ? `拠点未一致: ${storeRaw}` : `日付不正: ${dateRaw}` });
      return;
    }

    if (responseId) {
      if (existingIds.has(responseId) || seenThisBatch.has(responseId)) {
        result.duplicate++;
        return;
      }
      seenThisBatch.add(responseId);
    } else {
      result.warnedNoId++;
    }

    const effectiveId = responseId || `NOID-${batchId}-${idx}`;

    let anyData = false;
    const itemRecords = [];
    itemMappings.forEach((im) => {
      const ratingRaw = r[im.ratingCol];
      const commentRaw = r[im.commentCol];
      const hasRating = ratingRaw !== undefined && ratingRaw !== "" && !isNaN(Number(ratingRaw));
      const hasComment = commentRaw !== undefined && commentRaw.trim() !== "";
      if (!hasRating && !hasComment) return;
      anyData = true;
      itemRecords.push({
        id: `${effectiveId}_${im.id}`,
        responseId: effectiveId,
        hasExplicitId: !!responseId,
        date: dateRaw,
        storeId: store.id,
        itemId: im.id,
        rating: hasRating ? Number(ratingRaw) : null,
        comment: hasComment ? commentRaw.trim() : "",
        batchId,
      });
    });

    if (!anyData) {
      result.excluded++;
      return;
    }
    result.success++;
    result.newRecords.push(...itemRecords);
  });

  return result;
}
