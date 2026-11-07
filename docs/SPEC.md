# Tally v2 — redesign spec

Source of truth for visuals: the approved "Family Expense Dashboard" Claude Design canvas (Final-* artboards + Final-system). Brand: indigo #2D2A86, ink #14162B, canvas #F5F4F0 with indigo wash, Plus Jakarta Sans, tabular figures. Green/amber/red only for money status. Matte cards; glass only for the floating tab bar and sheet backdrop.

Users: two invited brothers. One in Canada (Android, CAD, biweekly pay), one in India (iPhone, INR, monthly pay). Access = email in `households/family.members`.

## 1. Flows

1. **Launch** → splash (logo) while auth resolves. Never flash the wrong screen.
2. **Signed out** → Welcome: logo, "Tally", one-line pitch, 3 "how it works" points, "Sign in with Google". Sign-in errors show inline in plain words.
3. **Signed in, not a member** → "Not invited yet" with the signed-in email and Sign out.
4. **Member, no profile** → Setup (one screen): name (prefilled from Google), home currency (CAD/INR), monthly budget (optional), pay schedule (biweekly/monthly) and next payday (optional). Save → Home.
5. **Member with profile** → Home. Tabs: Home · Activity · (+) · Shared · Plan. Profile opens from the avatar on Home.
6. **Add/Edit** is a bottom sheet over the current tab. Device back / Esc / backdrop / close button closes it without saving.

Routes are hash based (`#/home`, `#/activity`, `#/shared`, `#/plan`, `#/profile`) so reload and back work.

## 2. Screens and acceptance criteria

### Welcome
- AC-W1 Shows logo, name, pitch, 3 points, one primary button. No tab bar.
- AC-W2 Button starts Google redirect sign-in; while redirecting the button shows a busy state and is disabled.

### Setup
- AC-S1 Name required (1–40 chars, trimmed). Currency required (default CAD). Budget optional (≥0, ≤ 10,000,000). Next payday optional date.
- AC-S2 Invalid input shows a message next to the field; nothing saves.
- AC-S3 After save the user lands on Home; Setup never shows again unless the profile is deleted.

### Home (dashboard)
- AC-H1 Header: date, greeting by time of day with first name, display-currency toggle (CAD/INR), avatar → Profile.
- AC-H2 Hero card: with a budget → "Safe to spend today", amount, ring = today's spend / today's allowance, line "This month: X of Y", status tag On track / Running ahead / Over budget. Without a budget → "Spent this month" and a "Set a budget" button to Profile.
- AC-H3 "Needs you" card shows the most urgent unpaid bill that is overdue or due within 7 days, with Mark paid. Hidden if none.
- AC-H4 "Today" list of today's entries (all members) with icon, title, meta, signed amount. Empty state invites tapping +.
- AC-H5 "This month" card: my personal total, shared total, top 3 categories with bars.

### Add / Edit sheet
- AC-A1 Segments Expense / Income. Big amount display in the entry's currency, custom keypad (0–9, ".", delete). Physical keyboard digits, ".", Backspace and Enter also work.
- AC-A2 Amount rules: max 2 decimals, max 9 integer digits, no leading zeros ("0" then "5" → "5"), single ".". Zero/empty → Save disabled.
- AC-A3 Category chips with icons (Food, Transport, Shopping, Bills, Home, Health, Fun, Travel, Family, Other); income categories (Salary, Transfer, Other).
- AC-A4 Date (default today, no future dates beyond today), Personal/Shared toggle (expenses only), optional note ≤120 chars.
- AC-A5 Save writes the entry with currency = my home currency (edit keeps the entry's original currency), closes sheet, toast "Saved". Double-tap Save never creates two entries.
- AC-A6 Edit: tapping my own entry opens the sheet prefilled; Delete (soft) with Undo toast. Another person's entry opens read-only details.

### Activity
- AC-AC1 Month switcher (‹ Month Year ›); cannot go past current month.
- AC-AC2 Filter chips: All, Personal, Shared, Income.
- AC-AC3 Entries grouped by day, newest first, day header with day total (expenses only, display currency).
- AC-AC4 Shows who added shared entries (You / brother's first name).
- AC-AC5 Empty state per filter.

### Shared
- AC-SH1 Month switcher; total shared spend for the month in display currency.
- AC-SH2 Per-person totals with a bar and colour each, and the difference in words ("Vamsi paid CAD 40 more").
- AC-SH3 List of shared entries for the month.

### Plan
- AC-P1 Budget card: budget, spent, remaining, days left, per-day allowance.
- AC-P2 Next payday from schedule + anchor date (biweekly: anchor + 14n; monthly: same day each month, clamped to month end). Hidden if not set.
- AC-P3 Bills: add (name, amount, due day 1–31, Personal/Shared), list sorted by next due date with status tag (Paid, Due in N days, Due today, Overdue N days, Upcoming), Mark paid/unpaid for the current month, delete with Undo.
- AC-P4 Due day beyond month length clamps to the last day (e.g. 31 → 30 Nov).

### Profile
- AC-PR1 Avatar initial, name (editable), email (read-only).
- AC-PR2 "Show amounts in" CAD / INR — saved per person; Home toggle stays in sync.
- AC-PR3 Home currency, monthly budget, pay schedule, next payday — editable, validated as Setup.
- AC-PR4 Rate line: "1 CAD = 61.20 INR · ECB rate of <date>" or "using saved rate" offline.
- AC-PR5 Export CSV (all my household's active entries, original currency + converted column), Sign out, app version.

## 3. Money and currency rules
- Amounts stored as integer minor units (cents / paise) with `currency` CAD|INR. Legacy entries without currency are CAD.
- Conversion: minor × rate, rounded to nearest minor unit. Rate CAD→INR fetched from `https://api.frankfurter.dev/v1/latest?base=CAD&symbols=INR`, cached in localStorage with its date; refreshed if older than 12 h; fallback constant if never fetched (shown as "approximate").
- Display: CAD `CAD 1,234.50` (en-CA grouping); INR `₹1,23,456.00` (en-IN grouping). Expenses shown as −, income as + in green.
- Budget is stored in the owner's home currency and converted for display.
- Safe to spend today (current user, display currency): B = budget; P = my expenses this month before today (personal + shared I paid); T = my expenses today; D = days left in month including today. allowance = max(0, (B − P) / D); safe = allowance − T. Negative safe → "Over today's amount by X" amber.
- Month status: spent S vs pro-rata B × day/daysInMonth: S ≤ pro-rata → On track; S ≤ B → Running ahead (amber); S > B → Over budget (red).

## 4. Data model (Firestore, under `households/family`)
- `members: string[]` (existing).
- `profiles/{email}`: name, homeCurrency, displayCurrency, monthlyBudget (minor), payFrequency ('biweekly'|'monthly'|null), payAnchor (YYYY-MM-DD|null), updatedAt.
- `entries/{id}`: type ('expense'|'income'), amount (minor int > 0), currency, category, note, scope ('mine'|'shared'), by (email), date (YYYY-MM-DD), deleted, createdAt, updatedAt.
- `bills/{id}`: name, amount, currency, dueDay (1–31), scope, by, paidMonths (YYYY-MM[]), deleted, createdAt.

## 5. Non-functional
- No browser tap highlight; visible focus ring for keyboard only (`:focus-visible`).
- Touch targets ≥ 44 px; text contrast ≥ 4.5:1; every icon-only button labelled; sheet traps focus and returns it on close.
- Works 320–1440 px wide (content column max 520 px, centred on desktop); iOS safe areas respected.
- Reduce Motion disables animation; Reduce Transparency makes glass solid.
- All user text escaped before rendering (no HTML injection via names/notes).
- Offline: banner "Offline — changes will sync"; Firestore cache keeps working.
- Updates reach phones on next open (network-first service worker).

## 6. Test plan (release gate: all green, zero open defects)
1. Static: `tsc --checkJs --noEmit` on all modules.
2. Unit (Vitest): money parsing/format/convert, keypad, dates, budget/safe-to-spend, month status, grouping/filtering, shared split, bills due/status, next payday, CSV, validation, escaping.
3. UI (Playwright, mock backend, 390×844 and 1280×800): every flow in §1 and every AC in §2.
4. Accessibility: axe-core on every screen, zero serious/critical violations.
5. Black-box: independent QA agent derives cases from this spec only and runs them against the build.
6. Regression: full suite re-run after every fix.
7. Live smoke after deploy: sign-in, setup/home, add, edit, delete+undo, currency toggle, plan bill, profile, sign-out. Roll back on any failure.

## 7. Decisions from the QA/UX review (v2.1) — these override earlier sections
Lifecycle and offline
- D1 Membership/profile: "Not invited" only on a server `permission-denied`/missing email; network failure → "Can't reach Tally" with Retry (cached data used when available). Setup only when the server (not cache) confirms there is no profile.
- D2 Writes never block the UI: client-generated IDs + `setDoc` (idempotent), sheet closes on local commit, failures surface as a toast. Pending entries show a small "Syncing" mark.
- D3 Service worker caches the app shell, the Firebase SDK (gstatic) and fonts; shell fetch has a 3 s network timeout then cache. Splash shows "Still connecting… Retry" after 8 s.
- D4 Sign-out terminates Firestore and clears its on-device cache.
- D5 Install hint: dismissible "Add Tally to your Home Screen" card when not running standalone; instructions in Profile.

Money, time and currency
- D6 Every date key comes from local calendar fields (never UTC). Entries keep the creator's local date. Activity month switcher spans earliest → latest of (current month, newest entry). No query limit.
- D7 Home currency is chosen explicitly in Setup (preselected INR when the device time zone is Asia/Kolkata/Calcutta, else CAD). The Add sheet lets the entry currency be switched per entry. Changing home currency converts the budget at the current rate.
- D8 Conversion rule: convert each entry at the current rate (Math.round), then sum. One rate per device from ECB; both phones agree once both have today's rate. Known limitation: past entries are shown at today's rate.
- D9 Budget counts my personal expenses + 50% of every shared expense (whoever paid) — the same split the Shared tab uses. Budget unset or 0 = "no budget". Ring ratio capped 0..1, no division by zero. When the month is over budget, the hero says "Over budget by X" instead of a per-day amount.
- D10 Month status: on track unless spent > 110% of pro-rata (from day 3); over when spent > budget.
- D11 Bills: `startMonth` recorded; an unpaid previous month (on/after startMonth) shows as Overdue. Mark paid uses arrayUnion/arrayRemove and offers "Add as expense" in its toast. "Needs you" covers my bills + shared bills.
- D12 Shared tab: 50/50 split; with exactly two people shows "Vamsi owes you CAD 20" / "You owe…" / "All square". More members → per-person totals only.

Multi-user, security, privacy
- D13 Edit sheet closes with a message if the entry is deleted elsewhere. Order: date desc, then clientCreatedAt desc.
- D14 Emails compared lower-cased. Missing profile → name from email.
- D15 Firestore rules hardened: household doc read-only; `by == auth email` on create/update/delete; schema/type/size checks; no hard deletes; a profile writable only by its owner. Verified with the console Rules Playground + live deny checks.
- D16 Security headers (CSP, frame-ancestors, referrer, permissions) in vercel.json.
- D17 Shared and Profile say plainly that household members can see all entries.
- D18 CSV: UTF-8 BOM, formula guard, shared via the share sheet when available.

Accessibility and visuals
- D19 Tokens: amber text #8F5300, green #0B7A53, red #B42318 (all ≥ 4.5:1 on white and canvas). The FAB is never styled as an active tab. Every tappable element has a pressed style; no tap highlight. Tab bar near-opaque (96% white).
- D20 Keypad: amount is a live region; delete labelled; segments use aria-pressed; targets ≥ 48 px; inputs ≥ 16 px. Undo toast stays 8 s, pauses while focused/hovered, role=status.
- D21 Long names truncate with ellipsis; amount text auto-shrinks to fit at 320 px.
- D22 Discard confirmation when closing the sheet with a typed amount. Sheet open pushes a history entry so Back closes it.

Out of scope for v2 (documented): refunds, bill frequencies other than monthly, pay-period budgets, per-entry rate snapshots, real-device automation (WebKit/iOS cannot be installed in this build environment; final sign-in check on the brothers' phones).
