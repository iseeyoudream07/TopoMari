import { createHash, randomBytes } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "topomari_admin";

function tokenHash(token) {
  return createHash("sha256").update(String(token), "utf8").digest("base64url");
}

export function parseCookies(header = "") {
  const cookies = new Map();
  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      cookies.set(name, rawValue);
    }
  }
  return cookies;
}

export function serializeSessionCookie(token, { maximumAgeSeconds, secure = false } = {}) {
  const maximumAge = Math.max(0, Math.floor(Number(maximumAgeSeconds) || 0));
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(String(token || ""))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maximumAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export class AdminSessionStore {
  constructor({ ttlMs = 7 * 24 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = Math.max(60_000, Number(ttlMs) || 7 * 24 * 60 * 60 * 1000);
    this.now = now;
    this.sessions = new Map();
  }

  create(username = "admin") {
    this.prune();
    const token = randomBytes(32).toString("base64url");
    const session = {
      username: String(username || "admin"),
      csrfToken: randomBytes(32).toString("base64url"),
      expiresAt: this.now() + this.ttlMs,
    };
    this.sessions.set(tokenHash(token), session);
    return { token, ...session };
  }

  get(token) {
    if (!token) return null;
    const key = tokenHash(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(key);
      return null;
    }
    return { ...session };
  }

  delete(token) {
    if (!token) return false;
    return this.sessions.delete(tokenHash(token));
  }

  prune() {
    const current = this.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= current) this.sessions.delete(key);
    }
  }
}
