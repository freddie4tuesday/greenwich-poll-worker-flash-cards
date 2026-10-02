/*
  Sign-in for the card editor (copied from Game of Strife's content library, which took it from Ballotship's inject editor): an emailed one-time link ("magic link"), for people whose address is on
  an allowed domain. Pure helpers; the storage is in index.js (the Library object), so a token or a session lives with
  the content and is checked in one place.

  Why a link and not a password: nobody has to remember or share a secret, and access follows the mailbox.
  Tokens and session ids are random 256-bit values; only their SHA-256 is stored, so a copy of the store can't be used
  to sign in.
*/
export const TOKEN_TTL_S = 15 * 60;          // a link works for 15 minutes, once
export const SESSION_TTL_S = 24 * 60 * 60;   // a sign-in lasts 1 day (copied from Game of Strife, where it was decided with the owner), then a new link is needed
export const MAX_PER_EMAIL_PER_HOUR = 5;     // links sent to one address per hour; stops someone mailing a colleague nonstop
export const MAX_PER_HOUR = 60;              // links sent in total per hour; stops the library being used to send mail

export function b64url(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/* The address to send to, or null if it isn't usable. The domain must be EXACTLY one of the allowed ones: not a
   subdomain, and not a look-alike such as readyfortuesday.com.evil.com or evilreadyfortuesday.com. Only plain
   addresses pass (no display names, no lists with commas or spaces, no quoted local parts), so what we send to is
   exactly what was checked. */
export function allowedEmail(input, allowedDomains) {
  if (typeof input !== "string") return null;
  const e = input.trim().toLowerCase();
  if (e.length > 254 || !/^[a-z0-9._%+'-]{1,64}@[a-z0-9.-]+$/.test(e)) return null;
  const at = e.lastIndexOf("@"), domain = e.slice(at + 1);
  const ok = String(allowedDomains || "").toLowerCase().split(",").map((d) => d.trim()).filter(Boolean);
  return ok.includes(domain) ? e : null;
}

export function cookieOf(request, name) {
  const h = request.headers.get("cookie") || "";
  for (const part of h.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return "";
}
export const SESSION_COOKIE = "gf_session";
export function sessionCookie(value, maxAge) {
  // HttpOnly: the page's own scripts can't read it. Secure: only over https (localhost counts as secure to browsers).
  // SameSite=Strict: another website can't make the browser send it.
  return SESSION_COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + maxAge;
}

export function mailFor(link) {
  const text = "Here is your link to sign in to the Greenwich Poll Worker Flashcards card editor:\n\n" + link +
    "\n\nIt works once and expires in 15 minutes. It signs you in on the browser where you open it, for one day.\n" +
    "If you didn't ask for this, you can ignore this email; nothing happens unless the link is opened.\n";
  const html = "<p>Here is your link to sign in to the Greenwich Poll Worker Flashcards card editor:</p><p><a href=\"" + link + "\">Sign in to the card editor</a></p>" +
    "<p>It works once and expires in 15 minutes. It signs you in on the browser where you open it, for one day.</p>" +
    "<p>If you didn't ask for this, you can ignore this email; nothing happens unless the link is opened.</p>";
  return { subject: "Your Poll Worker Flashcards editor sign-in link", text, html };
}

/* Send through Resend. Returns true when Resend accepted it. A failure is logged and reported to nobody: the page
   says the same thing whether or not an email went, so it can't be used to learn which addresses are allowed. */
export async function sendMail(env, to, link) {
  const m = mailFor(link);
  try {
    const r = await fetch(env.RESEND_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + env.RESEND_API_KEY },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject: m.subject, text: m.text, html: m.html }),
    });
    if (!r.ok) console.error("sign-in email refused by Resend: " + r.status + " " + (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) { console.error("sign-in email failed: " + e.message); return false; }
}
