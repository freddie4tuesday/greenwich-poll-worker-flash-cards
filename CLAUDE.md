# Poll Worker Flashcards

Phone flashcard game for poll worker training, built for the Greenwich (CT) Registrars of Voters from their Canva "Poll Worker Training Cards". Read `HANDOFF.md` first for history, decisions and the next build.

## Conventions (owner's standing rules)

- Single self-contained HTML files with embedded CSS and JavaScript. No build step, no framework, no server.
- Use the official logo PNGs in `brand/` exactly as supplied. Never redraw, retype, recolor, crop or stretch the logo. Scale proportionally only, and keep the clear space built into the PNG.
- Brand: green `#1f4433`, gold `#b99c35`. Lato for all text; Garamond (EB Garamond) only as a sparing accent. See `brand/BRAND_NOTES.md`.
- The card look must match the printed Canva cards (see "Card design" in HANDOFF.md).
- Back up and document rigorously. When something turns out wrong, say so and fix it.

## Layout

- `app/index.html` — current game (the claude.ai artifact version; runs standalone too, see HANDOFF.md).
- `data/cards.json` — the 52 cards: `{id, order, q, a}`.
- `data/deck.sample.json` — proposed single-file deck format for the builder tool, filled in with Greenwich data and both logos (a test fixture).
- `brand/` — approved logo PNGs and brand notes.
- `reference/canva-source.md` — where the cards came from and content issues found.

## Testing

Check every UI change at phone sizes (375×667, 390×844, 430×932) for the game, and at 1366×820 and 1024×768 for any editor or builder screen. Test light and dark mode, and `prefers-reduced-motion`.
