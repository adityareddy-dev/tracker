# tracker

A single-page personal tracker. The page is public, the data isn't. `data.json` is encrypted in the browser with a passphrase before it is written here, and the page shows nothing until the passphrase is entered.

Files. `index.html` is the whole app. `data.json` is the encrypted state, written by the page through the GitHub API. `seed.mjs` encrypts a local `progress.json` into `data.json` the first time (`TRACKER_PASS='...' node seed.mjs`).

To update from any device, open the page, unlock, tap Edit, change tasks, tap Save to GitHub. A fine-grained token with Contents read and write on this repo only is stored in that browser. To store it without typing, open the page once as `.../tracker/#token=<token>`; the fragment is saved locally and stripped from the address bar.

From a terminal, `cli.mjs` does the same edits without the browser: `node cli.mjs show`, `next`, `task "<match>" --status done`, `add <category> "<name>"`, `journal <category> "<entry>"`, `milestone "<match>" --done`. It reads the passphrase from `TRACKER_PASS` or the macOS keychain item `tracker-passphrase` and pushes with the `gh` token. Run it with no arguments for the full list.

Sections. Next up (what is moving, blocked, or due soon), readiness across the criteria being built, milestones with countdowns, one section per workstream, and a dated journal for the evidence log. Copy summary produces a plain text status you can paste anywhere.
