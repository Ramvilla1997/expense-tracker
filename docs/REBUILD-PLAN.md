# Tally rebuild plan

Status: for Ram to approve. Nothing built yet.
Inputs: the trust spec (Nov 9), the Dashboard design (canvas, "Dashboard" page), decisions from Nov 8–9.

## Decisions already made
- Only Ram uses the app. Shared, settle-up and "who paid" are removed.
- Every number is calculated from entries. Nothing is typed in except facts: amounts paid, a statement balance, the bank balance at month start.
- Debt balance = last statement balance − payments since that date. Paying drops it at once. Typing a new statement resets it and brings in the interest. (The code already does this. Phani didn't move most likely because the $500 was added through + without picking the debt, so it was saved as ordinary spending. Slice 3 removes that trap.)
- Month formula: Started with + Pay − Bills − Debt payments − Spending − Savings = Left.
- Home is the Dashboard: one main number (spare till next payday), In hand, Month end, four tiles, next two items due, one + button.
- INR items show ₹ first, with CAD small.

## Build slices (each one: tests pass, PR, merge only when Ram says so)

| # | Slice | Done when |
|---|---|---|
| 1 | **Calculation core.** Pure functions: in hand, spare till payday, month end, % paid, next due, debt balances. Unit tests using November's real figures. | Tests prove $1,321.60 / $622.52 / $570.35 from the sample month |
| 2 | **Month inputs.** Paydays and pay amount, month start balance, each debt's plan for the month (min / custom / full / skip). New fields + `firestore.rules`. | Plan saved and read back; rules deployed by Ram |
| 3 | **One add flow.** + does Spend / Bill / Debt payment / Pay / Savings. Debt payment asks "which debt?". CAD / INR toggle. | Spec check 4: a debt payment from + lowers that debt's balance |
| 4 | **Home dashboard.** Built from the design. | Spec check 6: one main number, readable in 5 seconds |
| 5 | **Bills and Debts screens.** Simple lists, tick to pay, ₹ first. | Spec checks 1 and 5 |
| 6 | **Activity.** One list, swipe to edit or delete, undo after every save and delete. | Spec check 3 |
| 7 | **Remove Shared and old screens.** Shared tab, settle-up, daily allowance, Plan tab, old Home. Delete dead code and old tests. | No "shared" left in the UI; all tests green |

Checks 1–6 from the spec become Playwright tests and must all pass before the last merge. `tests/blackbox/` is not touched.

## Answers (Nov 9)
1. Old shared entries count fully as Ram's.
2. Two paycheques a month; dates can move. Each month holds two expected paydays Ram can edit; a paycheque counts as received when he adds it.
3. Month start: carries over last month's Left, with a bank check to correct it (decided by Claude, Ram can change).
4. Rules deploy: no Firebase access from the sandbox. Ram publishes via the Firebase console, or sets up a one-time key for an automatic deploy.

## Progress
- Slice 1 done locally: `public/js/core/month.js` + `tests/unit/month.test.js` (15 tests, November figures). Not committed.
