# Tally

Shared expenses, simply counted. A private PWA for a small invited group.

- **Live:** https://tally-shared-expenses.vercel.app
- **Hosting:** Vercel, auto-deploys every push to `main`; other branches get preview links.
- **Login and data:** Firebase Auth (Google) and Firestore, project `family-money-3d5f7`.
- **Access:** only emails in the `members` array of `households/family` (Firestore console) can read or write. `firestore.rules` holds the rules.
- **Sign-in:** `vercel.json` proxies `/__/auth/*` to Firebase so Google sign-in stays on one domain (Firebase's documented fix for browsers that block third-party storage).
- **Backup:** More → Export CSV, whenever you like.
