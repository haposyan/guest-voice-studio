// ============================================================================
// backup.js — encrypted local backup export/import (§7 バックアップ, §11
// ホスティング要確認事項: "複数PC間のリアルタイム同期は初期版の対象外。
// 別PCへ移す場合は暗号化バックアップのエクスポート／インポートを使用する").
// AES-256-GCM via the browser's native Web Crypto API — no external crypto
// library needed, works identically inside WebView2 and a plain browser.
// ============================================================================

const PBKDF2_ITERATIONS = 210000;

async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toB64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptBackup(stateObj, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(stateObj));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const envelope = {
    format: "guest-voice-studio-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    salt: toB64(salt),
    iv: toB64(iv),
    cipher: toB64(new Uint8Array(cipher)),
  };
  return JSON.stringify(envelope, null, 2);
}

export async function decryptBackup(fileText, passphrase) {
  const envelope = JSON.parse(fileText);
  if (envelope.format !== "guest-voice-studio-backup") throw new Error("不明なバックアップ形式です");
  const salt = fromB64(envelope.salt);
  const iv = fromB64(envelope.iv);
  const key = await deriveKey(passphrase, salt);
  const cipherBytes = fromB64(envelope.cipher);
  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
  } catch (e) {
    throw new Error("復号に失敗しました。パスフレーズが正しいかご確認ください。");
  }
  return JSON.parse(new TextDecoder().decode(plainBuf));
}
