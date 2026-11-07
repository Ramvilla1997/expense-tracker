// @ts-check
// Line icons drawn on a 24px grid; decorative unless a label is passed by the caller.
const PATHS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  activity: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shared: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c1-3 3.5-5 6-5s5 2 6 5M12 20c.8-2.4 2.5-4 4-4 2.5 0 4.6 2 5.5 4"/>',
  plan: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M4 7l11-3v3"/><circle cx="16" cy="13.5" r="1.2"/>',
  cloudOff: '<path d="M3 3l18 18M8 8a5 5 0 0 0-1 9.9h10M15.5 9.5A5 5 0 0 1 20 14.5"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  // Categories
  Food: '<path d="M3 4h2l2.4 11h10.2L20 8H6.3"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  Transport: '<path d="M4 20V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15M3 20h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  Shopping: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  Bills: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/>',
  Home: '<path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5"/>',
  Health: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  Fun: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
  Travel: '<path d="M2.5 13.5l19-7.5-6.5 15-3-6.5z"/>',
  Family: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9.5" r="2.2"/><path d="M3.5 20c.8-3.4 3-5.5 5.5-5.5s4.7 2.1 5.5 5.5M15 15c2.6-.6 4.9.9 5.5 4"/>',
  Other: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  Salary: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  Transfer: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
};

/**
 * @param {string} name
 * @param {{size?: number, stroke?: number, label?: string}} [options]
 */
export function icon(name, { size = 20, stroke = 2, label } = {}) {
  const body = PATHS[/** @type {keyof typeof PATHS} */ (name)] ?? PATHS.Other;
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${body}</svg>`;
}
