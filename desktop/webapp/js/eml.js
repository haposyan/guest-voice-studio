// ============================================================================
// eml.js — builds a standards-compliant .eml (RFC 5322 / MIME) file with a
// PDF attachment, entirely in JS (no server, no external library). This is
// the MAIL-05 fallback path: "Outlookの自動連携が利用できない場合は、PDF
// 添付済みのEMLファイル生成...へフォールバックする". Opening the resulting
// .eml with the OS default handler (desktop shell's openPath) hands it to
// Outlook (or Windows Mail) as a new message — this doubles as the MAIL-04
// "launch a draft" path when Outlook is the default handler.
// ============================================================================

function foldBase64(base64) {
  // RFC 2045 caps encoded-body lines at 76 chars.
  const lines = [];
  for (let i = 0; i < base64.length; i += 76) lines.push(base64.slice(i, i + 76));
  return lines.join("\r\n");
}

function encodeHeaderUtf8(text) {
  // RFC 2047 "encoded-word" so Japanese subject/names survive plain MIME readers.
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(text)))}?=`;
}

export function buildEml({ to, cc, subject, bodyText, attachmentBase64, attachmentName }) {
  const boundary = "----GuestVoiceStudio_" + Date.now().toString(36);
  const bodyBase64 = foldBase64(btoa(unescape(encodeURIComponent(bodyText))));
  const parts = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${encodeHeaderUtf8(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `This is a MIME-formatted message.`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    bodyBase64,
    ``,
  ];
  if (attachmentBase64) {
    parts.push(
      `--${boundary}`,
      `Content-Type: application/pdf; name="${attachmentName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${attachmentName}"`,
      ``,
      foldBase64(attachmentBase64),
      ``,
    );
  }
  parts.push(`--${boundary}--`, ``);
  return parts.filter((l) => l !== null).join("\r\n");
}
