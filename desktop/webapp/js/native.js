// ============================================================================
// native.js — thin wrapper around the WebView2 host bridge (see
// desktop/MainWindow.xaml.cs). Every call degrades gracefully when running
// outside the desktop shell (plain browser, e.g. during development/testing)
// so the exact same webapp/ folder works both ways.
// ============================================================================

export const isDesktop = !!(window.__NATIVE__ && window.__NATIVE__.isDesktop && window.chrome?.webview);

export const nativeInfo = window.__NATIVE__ || { isDesktop: false, dataDir: null, reportsDir: null, backupsDir: null, bridgeLogPath: null, appVersion: "browser-dev", appVersionDate: "-" };

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

// v2.12: real-machine testing showed native calls can go completely silent —
// no success, no error, nothing — with symptoms consistent with the host
// process being blocked (e.g. by corporate antivirus/EDR silently denying
// file writes or child-process launches from this unsigned exe) at a level
// .NET's own try/catch never sees, so the C# side's own Reply() never fires
// either. Previously that left the JS Promise pending forever — the button
// just "didn't respond" with no way to tell hang-from-block-from-bug. Every
// call now times out on its own after 5s so the caller always gets an
// answer, even if that answer is "timeout".
function callNative(type, payload = {}) {
  if (!isDesktop) return Promise.resolve({ ok: false, error: "not-desktop" });
  const requestId = "req" + (++reqCounter) + "_" + Date.now();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        resolve({ ok: false, error: "timeout", timedOut: true });
      }
    }, 5000);
    pending.set(requestId, (data) => { clearTimeout(timer); resolve(data); });
    window.chrome.webview.postMessage(JSON.stringify({ type, requestId, ...payload }));
  });
}

export function openPath(path) { return callNative("openPath", { path }); }
export function revealInExplorer(path) { return callNative("revealInExplorer", { path }); }

// v2.12: every call site used to fire-and-forget revealInExplorer() with no
// await, so when a real-machine report came in as "this button does
// nothing" we had no way to tell success from a silent failure — the JS
// side never looked at the reply either way. This awaits it and surfaces
// whatever actually happened via toast (imported lazily to avoid a
// hard dependency for callers that don't need it — ui.js has no imports of
// its own, so this is safe, not circular).
export async function revealInExplorerToast(path) {
  const { toast } = await import("./components/ui.js");
  const result = await revealInExplorer(path);
  if (result.ok) return result;
  if (result.timedOut) toast("応答がありませんでした（セキュリティソフトがブロックしている可能性があります）", "bad");
  else if (result.error === "not-found") toast("フォルダ・ファイルが見つかりませんでした: " + (path || ""), "bad");
  else toast("開けませんでした: " + (result.error || "不明なエラー"), "bad");
  return result;
}
export function pickSaveFile(suggestedName, filter, initialDirectory) { return callNative("pickSaveFile", { suggestedName, filter, initialDirectory }); }
export function pickFolder(title) { return callNative("pickFolder", { title }); }
export function requestUninstall() { return callNative("requestUninstall", {}); }
export function requestRelocateData(newDataDir) { return callNative("requestRelocateData", { newDataDir }); }
export function getZoom() { return callNative("getZoom", {}); }
export function setZoom(factor) { return callNative("setZoom", { factor }); }
export function stepZoom(direction) { return callNative("stepZoom", { direction }); }
export function pickOpenFile(filter) { return callNative("pickOpenFile", { filter }); }
export function printToPdf(path) { return callNative("printToPdf", { path }); }
export function printToPdfBlob() { return callNative("printToPdfBlob", {}); }
export function prepareDownload(path) { return callNative("prepareDownload", { path }); }

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

// v2.14: like downloadBlob, but on desktop routes the actual disk write
// through WebView2's own download manager at an exact path we choose,
// instead of our own File.WriteAllBytes — see the _pendingDownloadPath
// comment in MainWindow.xaml.cs for why. On desktop this needs the
// destination path prepared on the C# side (prepareDownload) *before* the
// click that starts the download, so this is async even though downloadBlob
// itself is fire-and-forget.
export async function saveBlobToPath(path, blob) {
  if (isDesktop) {
    await prepareDownload(path);
  }
  const filename = path.split(/[\\/]/).pop() || "download";
  downloadBlob(filename, blob);
}
