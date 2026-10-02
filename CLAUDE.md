# Poll Worker Flashcards

Phone flashcard game for poll worker training, built for the Greenwich (CT) Registrars of Voters from their Canva "Poll Worker Training Cards". Read `HANDOFF.md` first for history, decisions and the next build.

## Conventions (owner's standing rules)

- The game (`site/index.html`) and the editor (`site/edit.html`) are single self-contained HTML files with embedded CSS and JavaScript. No build step, no framework. The only server code is the small Worker in `src/` that stores the deck and signs staff in.
- Use the official logo PNGs in `brand/` exactly as supplied. Never redraw, retype, recolor, crop or stretch the logo. Scale proportionally only, and keep the clear space built into the PNG.
- Brand: green `#1f4433`, gold `#b99c35`. Lato for all text; Garamond (EB Garamond) only as a sparing accent. See `brand/BRAND_NOTES.md`.
- The card look must match the printed Canva cards (see "Card design" in HANDOFF.md).
- Back up and document rigorously. When something turns out wrong, say so and fix it.

## Layout

- `site/index.html` — the game. Loads the deck from `/api/deck`; falls back to the 52 built-in cards. `?preview` makes it play a deck sent by the editor.
- `site/edit.html` — the card editor at `/edit`: sign-in by emailed link (only @greenwichct.gov), edit, **Preview game**, **Publish changes**, History/restore.
- `src/` — the Worker: `index.js` (routes and the deck store), `auth.js` (emailed sign-in), `validate.js` (what a saved deck must look like).
- `seed.json` — the 52 approved cards the store starts with. `wrangler.jsonc` — Cloudflare config.
- `tests/` — `npm test` (API and sign-in) and `node tests/ui.mjs` (browser walk-through); both use a local copy only, never the live site.
- `data/cards.json` — the 52 cards: `{id, order, q, a}`.
- `data/deck.sample.json` — proposed single-file deck format for the builder tool, filled in with Greenwich data and both logos (a test fixture).
- `brand/` — approved logo PNGs and brand notes.
- `reference/canva-source.md` — where the cards came from and content issues found.

## Testing

Run both test commands before every deploy. Check every UI change at phone sizes (375×667, 390×844, 430×932) for the game, and at 1366×820 and 1024×768 for any editor or builder screen. Test light and dark mode, and `prefers-reduced-motion`.

## Secrets and addresses

- The Resend key is the Worker secret `RESEND_API_KEY` (`npx wrangler secret put RESEND_API_KEY`). The Cloudflare token is `CLOUDFLARE_API_TOKEN` in the environment. Never print, commit or document either.
- Only `greenwichct.gov` addresses may sign in (`ALLOWED_DOMAINS` in `wrangler.jsonc`: exact match, no subdomains).
- The hostname has its own specific route because `*.electionadminsuite.com/*` belongs to poll-worker-system, which creates its own addresses in the same zone. Never add a wildcard route.
- Merging to `main` deploys to the live site automatically (`.github/workflows/deploy.yml`), by the owner's standing request. Work on a branch, and merge to `main` only when the owner says so.
