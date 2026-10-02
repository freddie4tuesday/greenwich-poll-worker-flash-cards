# Handoff: Poll Worker Flashcards

Moved from a claude.ai chat on 2026-10-02.

## What exists

`app/index.html`, about 300 KB, mostly the embedded white logo.

It is published as a claude.ai artifact: https://claude.ai/artifact/7MKNnnawN5hiy2rJU5afw1
Viewers there need a Claude account.

### Game (phone-first)

- One-screen layout with no page scroll. The card is sized as large as fits: `width: min(100cqw, 100cqh * 240/336)` inside a size container.
- **Turning the card:** tapping the card turns it over in 3D (`rotateY(180deg)`, 0.7 s).
- **Grading:** two thumb-sized "ballot oval" buttons at the bottom, *I knew it* and *Review again*.
  - After the card is turned over, the player can also swipe: right means knew it, left means review again. The swipe commits past 28% of the card width, and a "Knew it" or "Review" stamp fades in while dragging.
  - Keyboard: Space or Enter turns the card, K or → means knew it, R or ← means review again.
- **Review queue:** a card marked *Review again* goes back into the queue 3 to 5 cards later. A round ends when every card has been cleared.
- **Summary screen:** shows how many cards were known on the first try, lists every card that needed review, and has a *Study missed cards* button. It ends with the closing thank-you and the signatures (Mary Hegarty, Fred DeCaro III).
- **⋯ menu:** *Shuffle and restart*, *Restart in card order*, and *Manage cards* (owner and editors only).
- **Long text:** an automatic fit routine (`fitIn()`) shrinks the type until it fits its band, down to 50% at the smallest.
- **Reduced motion:** with `prefers-reduced-motion` set, the 3D turn and the slide animations become fades.

### Card design (matches the printed Canva cards)

- Card ratio is 240×336, the Canva page size.
- **Question side:** solid green, the question in white, "Tap to turn over," and the white logo in the bottom band (25% of the card height).
- **Answer side:** a green question band (31% of the height), a white answer panel (fills the rest), and a green logo band (27%) with the white logo at 88% of the band width.
- Text sizes are in container units (`cqw`) of each card face.

### Editor (desktop and tablet first; claude.ai only)

- **Layout:** two panes at widths of 820 px and up.
  - The left pane has search across questions and answers, *Add card*, and the numbered list.
  - The right pane has the question and answer fields (200 and 400 character limits), a live preview of the answer side, *Save changes* and *Cancel*, and a separate row with *Move up*, *Move down* and *Delete card*. Delete needs two clicks.
- **Keys:** Ctrl+S or ⌘S saves the card, Esc closes the editor.
- **Unsaved changes:** a warning appears first, and repeating the action discards the changes.
- **Narrow screens:** the editor shows one pane at a time.
- **Storage:** the deck lives in the claude.ai artifact database, collection `cards`, with document ids `c001`…`c052` and fields `{q, a, order}`. Rules: `{path:"", read:"view", write:"admin"}`, so anyone signed in can read and only the owner and editors can write. The page also declares the `user` capability, which hides *Manage cards* for everyone else.
- **Fallback:** the page has the original 52 cards built in (`const CARDS` in the script). It uses them when `window.claude` is missing (standalone or self-hosted), when the database is unavailable or empty, or when nothing loads within 5 seconds.
- **Outside claude.ai:** `window.claude` exists only inside the claude.ai viewer. Outside it, the game plays the built-in cards and the editor never appears.

## Decisions made

1. Use the official logo PNGs, not a recreation. An earlier build redrew the wordmark in Cinzel with an SVG cupola; that broke the brand guide and was removed.
2. Clean up the card text taken from Canva: add the missing spaces ("The voter.Everything", "onproviding", "themcomplete", "replacedwith", "sleeve.Please", "office.We") and change "Your may leave" to "You may leave". The Canva file itself was not changed.
3. Hosting without Claude accounts: the plan is GitHub Pages (a free, public repo). SharePoint isn't needed. Google Sites "Embed code" can also run the file, but it may hit a size limit (not verified).
4. Editing for offices without the claude.ai artifact: the owner chose a **builder tool** over a hosted backend. Each office loads their logo, brand and cards in a single-file builder, edits them, and exports a finished game file to upload to their own GitHub Pages. The owner hosts no data.
5. The builder's save format is a **single JSON file** that includes the logos as data URIs, not CSV. The owner asked whether CSV was needed and leaned toward JSON only; confirm whether to offer CSV import at all.

## Next build: the deck builder

The builder has not been started. Proposed spec:

- **Builder file:** a single HTML file, `builder.html`, that runs entirely in the browser and never uploads anything.
- **Import:** a deck JSON file (format below), or a game HTML the builder exported earlier.
  - The exported game must embed its deck as `<script type="application/json" id="deck">…</script>`, so the game file doubles as the save file.
  - The current game hard-codes `const CARDS = [...]` and the logo `src` attributes. Refactor it to read everything from the embedded deck JSON.
- **Editing:** cards (add, edit, reorder, delete, search), office name, game title, the two brand colors, the closing message and signatures, and both logos.
  - Reuse the current editor's two-pane layout and live preview.
- **Logo handling:** on import, scale large logos down proportionally to at most 1200 px wide.
  - Warn when the on-dark logo or the chosen colors would show poorly on the card bands.
  - Never alter the logo artwork itself.
- **Export:** a ready-to-upload `index.html` with the deck embedded, plus the deck `.json`.
- **Help:** short GitHub Pages upload steps inside the tool (create a public repo, upload `index.html`, then Settings → Pages → Deploy from branch `main` / root).

### Proposed deck format (`data/deck.sample.json` is a filled-in example)

```json
{
  "format": "flashcard-deck",
  "version": 1,
  "office": { "name": "…", "gameTitle": "…" },
  "brand": { "primary": "#1f4433", "accent": "#b99c35", "fontBody": "Lato", "fontAccent": "EB Garamond" },
  "logos": { "onDark": "data:image/png;base64,…", "onLight": "data:image/png;base64,…" },
  "closing": { "message": "…", "signatures": ["…", "…"] },
  "cards": [ { "id": "c001", "order": 1, "q": "…", "a": "…" } ]
}
```

The importer should check `format` and `version`, reject anything malformed with a clear message, and keep card ids stable across edits.

## Open items

- **Zero tape and results tape cards:** identical answers on purpose. The owner confirmed on 2026-10-02 that this is correct.
- **Card length:** some answers sit near the fit limit at phone size. The editor warns when the type would drop below 70% of the normal size.
- **Earlier download:** the copy of the game handed out before the editor was added has only the built-in cards.
- **Possible SharePoint embedding:** the site owner can allow `github.io` under Site settings → HTML Field Security.

## Hosting and the hosted editor (added 2026-10-02)

Live at https://greenwichflashcards.electionadminsuite.com as one Cloudflare Worker (`wrangler.jsonc`). No staging copy; the owner chose live only.

- **Game:** `/`. Loads the deck from `/api/deck` (public). If that fails or takes 5 s, it plays the 52 built-in cards.
- **Editor:** three-dots menu, **Edit cards**, goes to `/edit`. Sign-in is an emailed one-time link (15 minutes, once; the session lasts 1 day). Only addresses ending exactly `@greenwichct.gov` get a link, and the page gives the same answer for every address. Copied from Game of Strife's content library.
- **Editing flow:** card edits stay in the browser until **Publish changes**. **Preview game** opens the real game in a phone-sized window playing the working copy, published or not. Every publish is a numbered version; **History** restores any of them (a restore is a new version).
- **Cache (2026-10-02):** `/api/deck` is cached for 60 seconds (edge and browser), so most page loads don't read the store; `DECK_CACHE_SECONDS` in the Worker vars changes it (0 = off, as in the tests). Cost: a publish can take up to a minute to reach players. The editor reads `/api/edit/deck` (signed in, never cached) so its version number is always real and a save is never refused because of a stale copy.
- **Store:** one Durable Object (SQLite), seeded from `seed.json`, up to 500 versions. Limits: 300 cards, question 200 and answer 400 characters.
- **What is not built:** logos, colors, closing message and signatures are still fixed in `site/index.html`; only the cards are editable. The "deck builder" idea above is not needed for Greenwich and is parked.
- **Deploy:** done from a Claude session with a Cloudflare token the owner pastes in the chat (they rotate it afterward). A GitHub Actions auto-deploy was tried on 2026-10-02 and removed the same day, because it needed a token stored in GitHub, which the owner does not want.
- **Deploy steps:** `npm test`, `node tests/ui.mjs`, then `CLOUDFLARE_API_TOKEN=… npx wrangler deploy`. Rollback: `npx wrangler rollback`, or redeploy an earlier commit. The saved deck lives in the store, so a code rollback does not undo card edits (use History).
- **Sign-in email:** needs the Worker secret `RESEND_API_KEY`; sends from greenwichflashcards-no-reply@electionadminsuite.com (that address must be allowed by the Resend domain already verified for electionadminsuite.com).
- **Favicon (2026-10-02):** `site/favicon.svg` (a gold check on a white card on a green square, drawn new in the brand colors, no logo artwork) plus `favicon-32.png` and `apple-touch-icon.png` made from it. The owner chose this over a cropped cupola, which would break the never-crop-the-logo rule and is unreadable at 16 px.
- **Decision:** the zero tape and results tape answers are identical on purpose; the owner confirmed they are correct.
- This replaces the GitHub Pages plan in Decision 3 for the Greenwich copy. The claude.ai artifact copy still exists, but its in-page editor is no longer in this code.
