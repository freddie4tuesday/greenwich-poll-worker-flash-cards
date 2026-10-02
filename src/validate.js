/*
  What a saved deck must look like (build 1 of the hosted editor). The editor page checks the same things so a person sees the problem
  before pressing Publish; this is the check that counts, because anyone signed in could send anything.
  Limits match the game's fit routine: a question over 200 or an answer over 400 characters would shrink below half size on a phone.
*/
export const MAX_CARDS = 300;   // the deck has 52; 300 leaves room to grow while keeping a saved version near 100 KB
export const MAXQ = 200;
export const MAXA = 400;

export function validateContent(content) {
  const errors = [];
  if (!content || typeof content !== "object" || !Array.isArray(content.cards)) return ["The deck must be a list of cards."];
  const cards = content.cards;
  if (cards.length < 1) return ["The deck needs at least one card."];
  if (cards.length > MAX_CARDS) return ["The deck can hold at most " + MAX_CARDS + " cards."];
  const ids = new Set(), orders = new Set();
  cards.forEach((c, i) => {
    const n = "Card " + (i + 1) + ": ";
    if (!c || typeof c !== "object") { errors.push(n + "isn't a card."); return; }
    if (typeof c.id !== "string" || !/^c[0-9a-z]{3,12}$/.test(c.id)) errors.push(n + "has no valid id.");
    else if (ids.has(c.id)) errors.push(n + "repeats the id " + c.id + ".");
    else ids.add(c.id);
    if (!Number.isInteger(c.order) || c.order < 1) errors.push(n + "has no valid position.");
    else if (orders.has(c.order)) errors.push(n + "shares its position with another card.");
    else orders.add(c.order);
    if (typeof c.q !== "string" || !c.q.trim()) errors.push(n + "needs a question.");
    else if (c.q.length > MAXQ) errors.push(n + "the question is over " + MAXQ + " characters.");
    if (typeof c.a !== "string" || !c.a.trim()) errors.push(n + "needs an answer.");
    else if (c.a.length > MAXA) errors.push(n + "the answer is over " + MAXA + " characters.");
  });
  return errors;
}

/* Keep only the known fields, trimmed, so a save can't smuggle extra data into the store. */
export function cleanContent(content) {
  return { cards: content.cards.map((c) => ({ id: c.id, order: c.order, q: c.q.trim(), a: c.a.trim() })) };
}
