/*
  Smoke test for the hosted editor. Starts the Worker locally (wrangler dev, a throwaway local store) and a stand-in mail service, then walks
  through sign-in, publishing, history and restore. It never touches the live site, live data, or the real Resend account.
  Run from the repository root: npm test
*/
import { spawn } from "node:child_process";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8799, MAILPORT = 8798, BASE = "http://127.0.0.1:" + PORT;
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => b += d); req.on("end", () => { mails.push(JSON.parse(b)); res.writeHead(200, { "content-type": "application/json" }); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(MAILPORT, "127.0.0.1", r));

const state = fs.mkdtempSync(path.join(os.tmpdir(), "fc-test-"));
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--persist-to", state,
  "--var", "RESEND_API_KEY:test-key", "--var", "RESEND_URL:http://127.0.0.1:" + MAILPORT + "/", "--var", "SESSION_TTL_SECONDS:3600"], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CLOUDFLARE_API_TOKEN: "", WRANGLER_SEND_METRICS: "false" } });
let log = ""; dev.stdout.on("data", (d) => log += d); dev.stderr.on("data", (d) => log += d);
const stop = () => { try { process.kill(-dev.pid, "SIGTERM"); } catch (_) {} mailSrv.close(); };   // the whole group: npx starts wrangler, which starts workerd
process.on("exit", stop);

let ok = false;
for (let i = 0; i < 120 && !ok; i++) { try { ok = (await fetch(BASE + "/api/deck")).ok; } catch (_) { await new Promise((r) => setTimeout(r, 500)); } }
if (!ok) { console.error(log); stop(); process.exit(1); }

let cookie = "";
const call = async (p, body, extra = {}) => {
  const r = await fetch(BASE + p, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  let data = null; try { data = await r.json(); } catch (_) {}
  return { status: r.status, data };
};
const waitMail = async (n) => { for (let i = 0; i < 40 && mails.length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); } };

try {
  await t("the game and the editor pages are served", async () => {
    const g = await fetch(BASE + "/"), e = await fetch(BASE + "/edit");
    assert.equal(g.status, 200); assert.match(await g.text(), /Poll worker flashcards/);
    assert.equal(e.status, 200); assert.match(await e.text(), /Edit the flashcards/);
  });
  await t("the favicon files are served and both pages link to them", async () => {
    for (const f of ["/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png"]) assert.equal((await fetch(BASE + f)).status, 200, f);
    for (const pg of ["/", "/edit"]) assert.match(await (await fetch(BASE + pg)).text(), /rel="icon" href="\/favicon\.svg"/);
  });
  await t("the public deck is held at the edge for a minute but rechecked by browsers", async () => {
    const r = await fetch(BASE + "/api/deck"); assert.match(r.headers.get("cache-control"), /max-age=0, must-revalidate/);   // browsers recheck; the edge holds the 60 seconds
  });
  let deck;
  await t("the deck is public and has the 52 approved cards", async () => {
    const r = await call("/api/deck"); assert.equal(r.status, 200); deck = r.data;
    assert.equal(deck.content.cards.length, 52); assert.equal(deck.version, 1);
  });
  await t("editing needs a sign-in", async () => {
    assert.equal((await call("/api/edit/history")).status, 401);
    assert.equal((await call("/api/edit/deck")).status, 401);
    assert.equal((await call("/api/edit/save", { base: 1, content: deck.content, summary: "x" })).status, 401);
  });
  await t("only exactly @greenwichct.gov addresses get a link, and the answer is always the same", async () => {
    const bad = ["someone@gmail.com", "x@greenwichct.gov.evil.com", "x@evilgreenwichct.gov", "x@sub.greenwichct.gov", "a@greenwichct.gov, b@gmail.com", "Name <a@greenwichct.gov>"];
    const answers = [];
    for (const e of bad) { const r = await call("/api/auth/request", { email: e }); assert.equal(r.status, 200); answers.push(JSON.stringify(r.data)); }
    const good = await call("/api/auth/request", { email: "Staff@GreenwichCT.gov" }); answers.push(JSON.stringify(good.data));
    assert.equal(new Set(answers).size, 1);
    await waitMail(1); await new Promise((r) => setTimeout(r, 400));
    assert.equal(mails.length, 1); assert.deepEqual(mails[0].to, ["staff@greenwichct.gov"]);
  });
  let token;
  await t("the link works once, and a wrong token is refused", async () => {
    token = /\/edit\?t=([\w-]+)/.exec(mails[0].text)[1];
    assert.equal((await call("/api/auth/verify", { token: "x".repeat(43) })).status, 401);
    const r = await call("/api/auth/verify", { token }); assert.equal(r.status, 200); assert.equal(r.data.email, "staff@greenwichct.gov");
    assert.equal((await call("/api/auth/me")).status, 200);
    const saved = cookie; cookie = "";
    assert.equal((await call("/api/auth/verify", { token })).status, 401);
    cookie = saved;
  });
  await t("a save from another website is refused", async () => {
    const r = await call("/api/edit/save", { base: 1, content: deck.content, summary: "x" }, { origin: "https://evil.example" });
    assert.equal(r.status, 403);
  });
  await t("a bad deck is refused with a reason", async () => {
    const cards = deck.content.cards.map((c) => ({ ...c }));
    cards[0].q = "x".repeat(201);
    const r = await call("/api/edit/save", { base: 1, content: { cards }, summary: "too long" });
    assert.equal(r.status, 422); assert.match(r.data.error, /question is over 200/);
    assert.equal((await call("/api/edit/save", { base: 1, content: { cards: [] }, summary: "empty" })).status, 422);
    const dup = deck.content.cards.map((c) => ({ ...c })); dup[1].id = dup[0].id;
    assert.equal((await call("/api/edit/save", { base: 1, content: { cards: dup }, summary: "dup" })).status, 422);
  });
  await t("a good edit publishes, becomes the public deck, and a stale save is refused", async () => {
    const cards = deck.content.cards.map((c) => ({ ...c })); cards[0].a = "Edited answer."; cards.push({ id: "c053", order: 53, q: "New question?", a: "New answer.", extra: "dropped" });
    const r = await call("/api/edit/save", { base: 1, content: { cards }, summary: "test edit" });
    assert.equal(r.status, 200); assert.equal(r.data.version, 2);
    const pub = await call("/api/edit/deck"); assert.equal(pub.data.version, 2); assert.equal(pub.data.content.cards.length, 53);   // the editor's copy is never cached
    assert.equal(pub.data.content.cards[0].a, "Edited answer."); assert.equal("extra" in pub.data.content.cards[52], false);
    assert.equal((await call("/api/edit/save", { base: 1, content: { cards }, summary: "stale" })).status, 409);
  });
  await t("history lists versions and restore brings back the original as a new version", async () => {
    const h = await call("/api/edit/history"); assert.equal(h.data.length, 2); assert.equal(h.data[0].by, "staff@greenwichct.gov");
    const r = await call("/api/edit/restore", { version: 1 }); assert.equal(r.status, 200); assert.equal(r.data.version, 3);
    const pub = await call("/api/edit/deck"); assert.equal(pub.data.content.cards.length, 52);
    assert.equal((await call("/api/edit/restore", { version: 99 })).status, 404);
  });
  await t("signing out ends the session", async () => {
    const old = cookie;
    assert.equal((await call("/api/auth/logout", {})).status, 200);
    cookie = old;   // the old session id must no longer work
    assert.equal((await call("/api/auth/me")).status, 401);
  });
} finally { stop(); }
console.log(failed ? failed + " test(s) failed" : "all tests passed");
process.exit(failed ? 1 : 0);
