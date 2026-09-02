// ============================================================================
// guestvoice-bridge.js — v2.18: carries a one-shot "jump to Guest Voice with
// this item/period pre-filtered" request from Lobby's item-breakdown table
// to guestvoice.js's mount function.
//
// This is a separate module (rather than lobby.js importing straight from
// guestvoice.js) specifically to avoid a circular import: app.js imports
// both lobby.js and guestvoice.js, and guestvoice.js already imports
// allowedStoreIds from app.js — having lobby.js import guestvoice.js too
// closed that into a cycle (app -> lobby -> guestvoice -> app) that threw
// "Cannot access 'monthOffset' before initialization" at load time (a
// module-eval-order TDZ hazard, not a bug in monthOffset itself). Routing
// through this tiny bridge with no dependencies of its own keeps lobby.js
// and guestvoice.js from ever importing each other.
// ============================================================================

let pending = null;

export function setPendingJump(itemId, start, end) {
  pending = { itemId, start, end };
}

export function takePendingJump() {
  const p = pending;
  pending = null;
  return p;
}
