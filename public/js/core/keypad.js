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
