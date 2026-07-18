import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_SESSION_COOKIE,
  AdminSessionStore,
  parseCookies,
  serializeSessionCookie,
} from "../lib/admin-session.mjs";

test("admin sessions are opaque, expiring, and revocable", () => {
  let now = 1_000_000;
  const sessions = new AdminSessionStore({ ttlMs: 60_000, now: () => now });
  const created = sessions.create("operator");

  assert.equal(created.token.length >= 40, true);
  assert.equal(created.csrfToken.length >= 40, true);
  assert.equal(sessions.get(created.token)?.username, "operator");
  assert.equal(JSON.stringify([...sessions.sessions]).includes(created.token), false);

  now += 60_001;
  assert.equal(sessions.get(created.token), null);

  const revoked = sessions.create("operator");
  assert.equal(sessions.delete(revoked.token), true);
  assert.equal(sessions.get(revoked.token), null);
});

test("admin cookie is HttpOnly, same-site, and optionally secure", () => {
  const cookie = serializeSessionCookie("opaque token", {
    maximumAgeSeconds: 3600,
    secure: true,
  });
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=opaque%20token`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=3600/);
  assert.match(cookie, /Secure/);

  const parsed = parseCookies(`other=1; ${ADMIN_SESSION_COOKIE}=opaque%20token`);
  assert.equal(parsed.get(ADMIN_SESSION_COOKIE), "opaque token");
});
