/*
  Browser check of the game and the editor against a local Worker and a stand-in mail service (never the live site).
  Covers: the game loads the saved deck, the menu's "Edit cards" opens the editor, sign-in through the emailed link, editing a card,
  the Preview button playing an UNPUBLISHED edit, and publishing. Saves screenshots to the folder named by SHOTS (default: tests/shots).
  Run from the repository root: node tests/ui.mjs
*/
import { spawn } from "node:child_process";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = 8797, MAILPORT = 8796, BASE = "http://127.0.0.1:" + PORT, SHOTS = process.env.SHOTS || "tests/shots";
fs.mkdirSync(SHOTS, { recursive: true });
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => b += d); req.on("end", () => { mails.push(JSON.parse(b)); res.writeHead(200, { "content-type": "application/json" }); res.end("{}"); }); });
await new Promise((r) => mailSrv.listen(MAILPORT, "127.0.0.1", r));
const state = fs.mkdtempSync(path.join(os.tmpdir(), "fc-ui-"));
const dev = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--persist-to", state, "--var", "RESEND_API_KEY:test-key", "--var", "DECK_CACHE_SECONDS:0", "--var", "RESEND_URL:http://127.0.0.1:" + MAILPORT + "/"],
  { detached: true, stdio: "ignore", env: { ...process.env, CLOUDFLARE_API_TOKEN: "", WRANGLER_SEND_METRICS: "false" } });
const stop = () => { try { process.kill(-dev.pid, "SIGTERM"); } catch (_) {} mailSrv.close(); };   // the whole group: npx starts wrangler, which starts workerd
process.on("exit", stop);
let up = false;
for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(BASE + "/api/deck")).ok; } catch (_) { await new Promise((r) => setTimeout(r, 500)); } }
assert.ok(up, "the local Worker did not start");

const exe = process.env.PLAYWRIGHT_BROWSERS_PATH ? fs.readdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH).filter((d) => d.startsWith("chromium")).map((d) => path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, d, "chrome-linux", "chrome")).find((p) => fs.existsSync(p)) : undefined;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = 0;
const t = async (name, fn) => { try { await fn(); console.log("ok   " + name); } catch (e) { failed++; console.log("FAIL " + name + "\n     " + e.message); } };
try {
  // The game on a phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const g = await phone.newPage();
  const errors = []; g.on("pageerror", (e) => errors.push(e.message));
  await t("the game loads the saved deck and shows a question", async () => {
    await g.goto(BASE + "/"); await g.waitForSelector("#card:not([hidden])");
    assert.ok((await g.textContent("#fq")).length > 5); await g.screenshot({ path: SHOTS + "/game-phone.png" });
  });
  await t("the menu's Edit cards opens the editor sign-in", async () => {
    await g.click("#menuBtn"); await g.click("#mManage"); await g.waitForURL("**/edit"); await g.waitForSelector("#signin:not([hidden])");
    await g.screenshot({ path: SHOTS + "/signin-phone.png" });
  });
  await t("a wrong domain gets the same message and no email", async () => {
    await g.fill("#email", "someone@gmail.com"); await g.click("#reqBtn"); await g.waitForFunction(() => document.getElementById("reqMsg").textContent.includes("sign-in link is on its way"));
    await new Promise((r) => setTimeout(r, 400)); assert.equal(mails.length, 0);
  });

  // The editor on a desktop
  const desk = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const p = await desk.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept(d.type() === "prompt" ? "UI test edit" : undefined));
  await p.goto(BASE + "/edit");
  await p.fill("#email", "ui.tester@greenwichct.gov"); await p.click("#reqBtn");
  for (let i = 0; i < 40 && !mails.length; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(mails.length, 1);
  const link = /https?:\/\/\S+\/edit\?t=[\w-]+/.exec(mails[0].text)[0].replace(/^https?:\/\/[^/]+/, BASE);
  await t("the emailed link needs a button press, then opens the editor", async () => {
    await p.goto(link); await p.waitForSelector("#verify:not([hidden])"); await p.click("#verifyBtn"); await p.waitForSelector("#app:not([hidden])");
    assert.match(await p.textContent("#meta"), /52 cards/); await p.screenshot({ path: SHOTS + "/editor-desktop.png" });
  });
  await t("editing a card shows it as unpublished, and Preview plays the unpublished edit", async () => {
    await p.click("#list li:first-child button"); await p.fill("#detail textarea >> nth=0", "Edited question for the preview?");
    await p.click("#detail .btn.primary"); await p.waitForSelector(".chg");
    assert.match(await p.textContent("#pill"), /Not published/);
    await p.click("#previewBtn"); const f = p.frameLocator("#previewFrame");
    await f.locator("#card:not([hidden])").waitFor(); await p.waitForTimeout(500);
    assert.match(await f.locator("#fq").textContent(), /Edited question for the preview\?/);
    await p.screenshot({ path: SHOTS + "/preview-desktop.png" }); await p.click("#previewClose");
  });
  await t("the public deck is unchanged until Publish, then changes", async () => {
    assert.ok(!(await (await fetch(BASE + "/api/deck")).text()).includes("Edited question for the preview"));
    await p.click("#publishBtn"); await p.waitForFunction(() => document.getElementById("pill").textContent.includes("All changes published"));
    assert.ok((await (await fetch(BASE + "/api/deck")).text()).includes("Edited question for the preview"));
  });
  await t("the history shows both versions", async () => {
    await p.click("#historyBtn"); await p.waitForSelector("#histList li"); assert.equal(await p.locator("#histList li").count(), 2);
    await p.screenshot({ path: SHOTS + "/history-desktop.png" }); await p.click("#histClose");
  });
  // The editor on a phone and a tablet
  for (const [w, h, name] of [[390, 844, "phone"], [1024, 768, "tablet"]]) {
    await t("the signed-in editor fits a " + name, async () => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addCookies((await desk.cookies()));
      const q = await ctx.newPage(); await q.goto(BASE + "/edit"); await q.waitForSelector("#app:not([hidden])");
      await q.click("#list li:nth-child(3) button"); await q.waitForSelector("#detail textarea");
      assert.ok(await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "page scrolls sideways");
      await q.screenshot({ path: SHOTS + "/editor-" + name + ".png" }); await ctx.close();
    });
  }
  await t("no script errors on any page", async () => assert.deepEqual(errors, []));
} finally { await browser.close(); stop(); }
console.log(failed ? failed + " check(s) failed" : "all checks passed");
process.exit(failed ? 1 : 0);
