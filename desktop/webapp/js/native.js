// ============================================================================
// native.js — thin wrapper around the WebView2 host bridge (see
// desktop/MainWindow.xaml.cs). Every call degrades gracefully when running
// outside the desktop shell (plain browser, e.g. during development/testing)
// so the exact same webapp/ folder works both ways.
// ============================================================================

export const isDesktop = !!(window.__NATIVE__ && window.__NATIVE__.isDesktop && window.chrome?.webview);

export const nativeInfo = window.__NATIVE__ || { isDesktop: false, dataDir: null, reportsDir: null, backupsDir: null, appVersion: "browser-dev", appVersionDate: "-" };

const pending = new Map();
let reqCounter = 0;

if (isDesktop) {
  window.chrome.webview.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
    const resolver = pending.get(data.requestId);
    if (resolver) {
      pending.delete(data.requestId);
      resolver(data);
    }
  });
}

function callNative(type, payload = {}) {
  if (!isDesktop) return Promise.resolve({ ok: false, error: "not-desktop" });
  const requestId = "req" + (++reqCounter) + "_" + Date.now();
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    window.chrome.webview.postMessage(JSON.stringify({ type, requestId, ...payload }));
  });
}

export function openPath(path) { return callNative("openPath", { path }); }
export function revealInExplorer(path) { return callNative("revealInExplorer", { path }); }
export function pickSaveFile(suggestedName, filter, initialDirectory) { return callNative("pickSaveFile", { suggestedName, filter, initialDirectory }); }
export function pickFolder(title) { return callNative("pickFolder", { title }); }
export function requestUninstall() { return callNative("requestUninstall", {}); }
export function requestRelocateData(newDataDir) { return callNative("requestRelocateData", { newDataDir }); }
export function getZoom() { return callNative("getZoom", {}); }
export function setZoom(factor) { return callNative("setZoom", { factor }); }
export function stepZoom(direction) { return callNative("stepZoom", { direction }); }
export function pickOpenFile(filter) { return callNative("pickOpenFile", { filter }); }
export function printToPdf(path) { return callNative("printToPdf", { path }); }

// Joins a folder and a filename with a single backslash, regardless of
// whether the folder was typed/stored with a trailing one. Used by the
// direct-save flows (PDF report, Word usage guide) that write straight to a
// configured/default folder instead of going through a Save As dialog — see
// reportstudio.js handlePrint() and settings.js downloadUsageGuide() for why
// (WebView2-hosted SaveFileDialog proved unreliable across several rounds of
// real-machine testing: it could open non-topmost, behind the app window,
// with no visible way for the user to interact with it).
export function joinPath(dir, filename) {
  return dir.replace(/[\\/]+$/, "") + "\\" + filename;
}
export function readFileBytes(path) { return callNative("readFileBytes", { path }); }
export function writeFileBytes(path, base64) { return callNative("writeFileBytes", { path, base64 }); }

// ---- Browser-side helpers shared by both modes ----

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

// Downloads a Blob via a normal browser download (works identically inside
// WebView2, which shows its own native Save dialog / download flyout).
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
