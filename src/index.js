/*
  Greenwich Poll Worker Flashcards: serves the game, keeps the deck of cards, and lets signed-in staff edit it.
  One Durable Object (SQLite) holds the deck, so a save is one write and every reader sees a whole version or the previous one,
  never half of a save. Sign-in, versions and restore follow Game of Strife's content library.

    GET  /                         the game (public)
    GET  /api/deck                 {version, content:{cards}}: the current deck, read by the game on load (public)
    GET  /edit                     the editor page (public; it shows a sign-in box until you are signed in)
    POST /api/auth/request         {email}  -> always {ok:true}; emails a sign-in link if the address is on an allowed domain
    POST /api/auth/verify          {token}  -> signs this browser in for 1 day (sets a cookie); the link works once
    GET  /api/auth/me              {email} when signed in, else 401
    POST /api/auth/logout
    GET  /api/edit/history         [{version, at, summary, by}] newest first       (signed in)
    GET  /api/edit/version/<n>     one old version                                  (signed in)
    POST /api/edit/save            {base, content, summary} -> {version}; 409 if base is stale   (signed in)
    POST /api/edit/restore         {version} -> {version} (a restore is itself a new version)    (signed in)

  Who may edit: anyone who can receive email at an address ending in exactly @greenwichct.gov (ALLOWED_DOMAINS), through an emailed
  one-time link. Opening the link is a button on the editor page, not the link itself, because mail scanners open links to check them
  and would otherwise use up the one-time token. A save from another website's page is also refused (the Origin check).
  The first read seeds the store from seed.json, the 52 approved cards. If the deck can't be read, the game plays the same 52 built in.
*/
import { DurableObject } from "cloudflare:workers";
import { validateContent, cleanContent } from "./validate.js";
import SEED from "../seed.json";
import { TOKEN_TTL_S, SESSION_TTL_S, MAX_PER_EMAIL_PER_HOUR, MAX_PER_HOUR, randomToken, sha256, allowedEmail, cookieOf, SESSION_COOKIE, sessionCookie, sendMail } from "./auth.js";

const MAX_VERSIONS = 500;   // about 20 KB each for 52 cards, so 10 MB at most; older ones are dropped past this
const MAX_SUMMARY = 200;
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra } });
const OK_BODY = { ok: true, message: "If that address can be used here, a sign-in link is on its way. It works once and expires in 15 minutes." };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const stub = env.DECK.get(env.DECK.idFromName("deck"));
    const ttl = (name, dflt) => Number(env[name]) > 0 ? Number(env[name]) : dflt;   // tests shorten these; live uses the defaults

    const page = async (file, headers) => {
      const r = await env.ASSETS.fetch(new Request(new URL(file, url), request));
      const h = new Headers(r.headers); for (const k in headers) h.set(k, headers[k]);
      return new Response(r.body, { status: r.status, headers: h });
    };
    if (p === "/" || p === "/index.html") return page("/index.html", { "cache-control": "no-cache" });
    if (p === "/edit" || p === "/edit/") return page("/edit.html", { "cache-control": "no-store", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" });
    if (p === "/api/deck") return request.method === "GET" ? json(await stub.getContent()) : json({ error: "use GET" }, 405);

    const posting = () => {
      // A script on some other website could otherwise act through a signed-in visitor's browser. A browser always sends Origin on a
      // POST; refuse one that isn't this site. This is a second layer beside SameSite=Strict on the cookie.
      const origin = request.headers.get("origin");
      return !(origin && origin !== url.origin);
    };
    const readBody = async () => {
      if (Number(request.headers.get("content-length") || 0) > 300000) return { err: json({ error: "That is too large to save." }, 413) };
      try { return { body: await request.json() }; } catch (e) { return { err: json({ error: "That wasn't readable. Reload the page and try again." }, 400) }; }
    };

    if (p.startsWith("/api/auth/")) {
      const what = p.slice("/api/auth/".length);
      if (what === "me") {
        const who = await stub.whoIs(await sha256(cookieOf(request, SESSION_COOKIE)));
        return who ? json({ email: who }) : json({ error: "Not signed in." }, 401);
      }
      if (request.method !== "POST") return json({ error: "use POST" }, 405);
      if (!posting()) return json({ error: "Sign-in is only possible from the editor page." }, 403);
      if (what === "logout") {
        await stub.endSession(await sha256(cookieOf(request, SESSION_COOKIE)));
        return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
      }
      const r = await readBody(); if (r.err) return r.err;
      if (what === "request") {
        // The same answer every time, whether or not the address is allowed or a mail went out, so this can't be used to
        // find out who is allowed. The work happens after the answer is sent.
        const email = allowedEmail(r.body && r.body.email, env.ALLOWED_DOMAINS);
        if (email) ctx.waitUntil((async () => {
          const token = randomToken();
          const ok = await stub.newToken(await sha256(token), email, ttl("TOKEN_TTL_SECONDS", TOKEN_TTL_S), MAX_PER_EMAIL_PER_HOUR, MAX_PER_HOUR);
          if (ok) await sendMail(env, email, url.origin + "/edit?t=" + token);
        })());
        return json(OK_BODY);
      }
      if (what === "verify") {
        const token = r.body && typeof r.body.token === "string" ? r.body.token : "";
        const sid = randomToken();
        const email = token.length >= 20 && token.length <= 100 ? await stub.useToken(await sha256(token), await sha256(sid), ttl("SESSION_TTL_SECONDS", SESSION_TTL_S)) : null;
        if (!email) return json({ error: "That link has expired or was already used. Ask for a new one." }, 401);
        return json({ ok: true, email }, 200, { "set-cookie": sessionCookie(sid, ttl("SESSION_TTL_SECONDS", SESSION_TTL_S)) });
      }
      return json({ error: "not found" }, 404);
    }

    if (p.startsWith("/api/edit/")) {
      const who = await stub.whoIs(await sha256(cookieOf(request, SESSION_COOKIE)));
      if (!who) return json({ error: "Not signed in. Reload the page and ask for a new sign-in link." }, 401);
      const what = p.slice("/api/edit/".length);
      if (request.method === "GET") {
        if (what === "history") return json(await stub.history());
        const m = /^version\/(\d{1,9})$/.exec(what);
        if (m) { const v = await stub.version(Number(m[1])); return v ? json(v) : json({ error: "There is no such version." }, 404); }
        return json({ error: "not found" }, 404);
      }
      if (request.method !== "POST" || (what !== "save" && what !== "restore")) return json({ error: "not found" }, 404);
      if (!posting()) return json({ error: "Editing is only possible from the editor page." }, 403);
      const r = await readBody(); if (r.err) return r.err;
      const x = await (what === "save" ? stub.save(r.body, who) : stub.restore(r.body, who));
      return json(x.body, x.status);
    }
    // Anything else is a file in site/ (the logo); a path with no file there gets the assets service's own "not found".
    if (request.method === "GET" && p === "/logo-white.png") return env.ASSETS.fetch(request);
    return json({ error: "not found" }, 404);
  },
};

export class Deck extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS versions (version INTEGER PRIMARY KEY, at INTEGER NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL, edited_by TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, email TEXT NOT NULL, made INTEGER NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL)");
    if (this.sql.exec("SELECT COUNT(*) AS n FROM versions").one().n === 0) {
      this.sql.exec("INSERT INTO versions (version, at, summary, content) VALUES (1, ?, ?, ?)", Date.now(), "Starting deck (the 52 approved cards)", JSON.stringify(SEED));
    }
  }
  _open(r) { return { version: r.version, at: r.at, summary: r.summary, content: JSON.parse(r.content) }; }
  _latest() { return this._open(this.sql.exec("SELECT version, at, summary, content FROM versions ORDER BY version DESC LIMIT 1").one()); }
  getContent() { const l = this._latest(); return { version: l.version, content: l.content }; }
  history() { return [...this.sql.exec("SELECT version, at, summary, edited_by FROM versions ORDER BY version DESC")].map((r) => ({ version: r.version, at: r.at, summary: r.summary, by: r.edited_by || null })); }
  version(n) { const r = [...this.sql.exec("SELECT version, at, summary, content FROM versions WHERE version = ?", n)][0]; return r ? this._open(r) : null; }
  _sweep() { const now = Date.now(); this.sql.exec("DELETE FROM tokens WHERE expires < ? AND made < ?", now, now - 3600 * 1000); this.sql.exec("DELETE FROM sessions WHERE expires < ?", now); }
  /* Make a one-time link token for this address, unless too many were made in the last hour (returns false then). */
  newToken(hash, email, ttlS, perEmail, perHour) {
    this._sweep(); const now = Date.now(), hourAgo = now - 3600 * 1000;
    if (this.sql.exec("SELECT COUNT(*) AS n FROM tokens WHERE email = ? AND made > ?", email, hourAgo).one().n >= perEmail) return false;
    if (this.sql.exec("SELECT COUNT(*) AS n FROM tokens WHERE made > ?", hourAgo).one().n >= perHour) return false;
    this.sql.exec("INSERT INTO tokens (hash, email, made, expires) VALUES (?, ?, ?, ?)", hash, email, now, now + ttlS * 1000);
    return true;
  }
  /* Spend a token: once, and before it expires. Returns the address, or null. Starts a session for it. */
  useToken(hash, sessionHash, sessionTtlS) {
    const now = Date.now(), r = [...this.sql.exec("SELECT email, expires, used FROM tokens WHERE hash = ?", hash)][0];
    if (!r || r.used || r.expires < now) return null;
    this.sql.exec("UPDATE tokens SET used = 1 WHERE hash = ?", hash);
    this.sql.exec("INSERT INTO sessions (hash, email, expires) VALUES (?, ?, ?)", sessionHash, r.email, now + sessionTtlS * 1000);
    return r.email;
  }
  whoIs(hash) { const r = [...this.sql.exec("SELECT email, expires FROM sessions WHERE hash = ?", hash)][0]; return r && r.expires > Date.now() ? r.email : null; }
  endSession(hash) { this.sql.exec("DELETE FROM sessions WHERE hash = ?", hash); }
  _write(content, summary, by) {
    const next = this._latest().version + 1;
    this.sql.exec("INSERT INTO versions (version, at, summary, content, edited_by) VALUES (?, ?, ?, ?, ?)", next, Date.now(), summary, JSON.stringify(content), by || null);
    this.sql.exec("DELETE FROM versions WHERE version <= ?", next - MAX_VERSIONS);
    return next;
  }
  save(b, by) {
    if (!b || typeof b !== "object") return { status: 400, body: { error: "Nothing to save." } };
    const cur = this._latest();
    if (b.base !== cur.version) return { status: 409, body: { error: "Someone else published while you were editing (now version " + cur.version + "). Reload the page to see their changes, then make yours again.", version: cur.version } };
    const errors = validateContent(b.content);
    if (errors.length) return { status: 422, body: { error: "Not saved. " + errors[0], errors } };
    const summary = String(b.summary || "Edited").replace(/[\u0000-\u001f]/g, " ").slice(0, MAX_SUMMARY) || "Edited";
    return { status: 200, body: { version: this._write(cleanContent(b.content), summary, by) } };
  }
  restore(b, by) {
    const old = b && this.version(Number(b.version));
    if (!old) return { status: 404, body: { error: "There is no such version to restore." } };
    const errors = validateContent(old.content);
    if (errors.length) return { status: 422, body: { error: "That version no longer passes the checks: " + errors[0] } };
    return { status: 200, body: { version: this._write(old.content, "Restored version " + old.version, by) } };
  }
}
