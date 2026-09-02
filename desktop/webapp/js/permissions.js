// ============================================================================
// permissions.js — v2.19: allowedStoreIds()/can() used to live in app.js,
// which every screen already imported other things from — but every screen
// ALSO gets imported BY app.js (it's the router), so that made a circular
// import: app.js -> screens/*.js -> app.js. That's normally harmless (see
// below) but the Lobby dashboard went completely blank for a real user
// right after v2.18 added new top-level `let` state to lobby.js, with a
// "Cannot access 'monthOffset' before initialization" error reproduced
// during testing — a TDZ hazard that's only possible when the module
// graph has a cycle back through the entry module. Moving these two
// trivial, db-only functions here (a leaf module with no imports of its
// own) breaks that cycle for every screen at once, rather than trying to
// reason precisely about which future top-level `let` would be safe.
// ============================================================================

import { db } from "./db.js";

export function allowedStoreIds() {
  return [db.LOCAL_STORE_ID];
}

// No roles anymore — every local action is allowed. Kept (rather than
// deleted) so screens ported from an earlier multi-role version don't need
// every call site rewritten.
export function can() {
  return true;
}
