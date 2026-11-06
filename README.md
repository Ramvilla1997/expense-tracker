# Family money

A small installable app for two people to track shared and personal money.

- **App code:** this public repo, hosted free on GitHub Pages. It contains no data and no secrets.
- **Data:** a separate **private** repo you create (for example `family-money-data`). The app writes one JSON file per person (`data/<name>.json`) and one shared file (`data/shared.json`). Every change is a commit, so the history is your audit trail and undo.
- **Cost:** $0. No servers, no cloud accounts beyond GitHub.

## One-time setup

1. **Data repo:** on GitHub, create a private repo, e.g. `family-money-data`. Leave it empty.
2. **Token:** GitHub → Settings → Developer settings → Fine-grained tokens → Generate.
   - Repository access: *Only select repositories* → `family-money-data`.
   - Permissions: *Contents → Read and write*. Nothing else.
   - Expiry: 1 year. Put a calendar reminder to rotate it.
3. **Publish the app:** in this repo, Settings → Pages → Deploy from a branch → `main` / `(root)`.
4. **Install on each phone:** open `https://ramvilla1997.github.io/expense-tracker/`.
   - iPhone: Share → Add to Home Screen.
   - Android: menu → Install app.
5. Open the app, fill in **Set up** (your name, the data repo name, the token, and your monthly budget).

Each brother repeats steps 4–5 on his own phone, with his own name and his own token.

## Restore or move everything

All data is plain JSON in your private repo. To restore on a new setup, copy the `data/` folder back into a new private repo. To read it without the app, open the JSON files directly.

## Known limits (v1)

- CAD only. The India side (INR) comes next.
- Family and Plan screens are not built yet.
- The token is stored on the phone. If a phone is lost, revoke the token in GitHub.
- "Paid from home fund" writes two commits. If the second one fails, the app says so. Check Activity before retrying.
- No PIN. Anyone who opens the app on an unlocked phone can see the data.
- Entries are not encrypted in the repo. The repo is private, so only you and anyone you add as a collaborator can read it.

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app: screens, styles, and GitHub read/write |
| `sw.js` | Caches the app shell so it opens offline |
| `manifest.json`, `icon.svg` | Home-screen install |
