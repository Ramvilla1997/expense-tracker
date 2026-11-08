// @ts-check
const MAX_WHOLE_DIGITS = 9;
const MAX_DECIMALS = 2;

/**
 * Applies one keypad key to the amount text and returns the new text.
 * Keys: '0'-'9', '.', 'back'. Invalid keys leave the text unchanged.
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
export function applyKey(text, key) {
  if (key === 'back') return text.slice(0, -1);
  if (key === '.') {
    if (text.includes('.')) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  if (!/^\d$/.test(key)) return text;

  const [whole, fraction] = text.split('.');
  if (fraction !== undefined) {
    return fraction.length >= MAX_DECIMALS ? text : `${text}${key}`;
  }
  if (whole === '0') return key;
  if (whole.length >= MAX_WHOLE_DIGITS) return text;
  return `${text}${key}`;
}

/** Maps a physical keyboard key to a keypad key, or null. @param {string} key */
export function keyFromKeyboard(key) {
  if (/^\d$/.test(key)) return key;
  if (key === '.' || key === ',') return '.';
  if (key === 'Backspace') return 'back';
  return null;
}

/**
 * Cleans text typed into the native amount field: keeps digits and one decimal point
 * (a comma counts as a point), applies the same limits as the keys, and says why a character was dropped.
 * @param {string} raw
 * @returns {{text: string, message: string}}
 */
export function cleanAmount(raw) {
  let text = '';
  let message = '';
  for (const ch of raw) {
    if (ch === ',') continue; // thousands separator, added back for display
    const key = keyFromKeyboard(ch);
    if (!key || key === 'back') continue;
    const next = applyKey(text, key);
    if (next === text && !message) message = limitMessage(text, key);
    text = next;
  }
  return { text, message };
}

/**
 * Why a refused key was refused, so the person is told instead of seeing nothing happen.
 * Returns '' when the key was not refused (or was a deletion).
 * @param {string} text
 * @param {string} key
 * @returns {string}
 */
export function limitMessage(text, key) {
  if (key === '.' && text.includes('.')) return 'Only one decimal point.';
  if (!/^\d$/.test(key)) return '';
  const [whole, fraction] = text.split('.');
  if (fraction !== undefined && fraction.length >= MAX_DECIMALS) return 'Two decimal places at most.';
  if (fraction === undefined && whole !== '0' && whole.length >= MAX_WHOLE_DIGITS) return 'That is the largest amount Tally can record.';
  return '';
}
