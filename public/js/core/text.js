// @ts-check
/** @type {Record<string, string>} */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for safe insertion into HTML. @param {unknown} value */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** First name from a display name, falling back to the email's local part. */
/** @param {string|undefined|null} name @param {string} email */
export function firstName(name, email) {
  const fromName = (name ?? '').trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const local = (email ?? '').split('@')[0] ?? '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'Someone';
}

/** @param {string} name @param {string} email */
export function initial(name, email) {
  return firstName(name, email).charAt(0).toUpperCase() || '?';
}

/** RFC 4180 CSV cell; also neutralises spreadsheet formula injection. @param {unknown} value */
export function csvCell(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {unknown[][]} rows */
export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
