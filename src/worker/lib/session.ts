// Cookie sessions. The browser holds a random token; D1 stores only its SHA-256.

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Role, UserStatus } from "../../shared/types";
import type { AppEnv, SessionUser } from "../env";
import { randomToken, sha256Hex } from "./crypto";
import { errorResponse } from "./http";

export const SESSION_COOKIE = "agc_session";
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;
/** Extend the session once less than this much lifetime remains. */
const SESSION_RENEW_BELOW_MS = 7 * 24 * 3600 * 1000;

function cookieOptions(c: Context, maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

/** Create a session row and set the cookie. */
export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), userId, now, now + SESSION_TTL_MS)
    .run();
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c, SESSION_TTL_MS / 1000));
}

/** Delete the current session (if any) and clear the cookie. */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Drop every session of a user, e.g. after a ban or a password change. */
export async function revokeUserSessions(db: D1Database, userId: number, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").bind(userId, exceptSessionId).run();
  } else {
    await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  }
}

interface SessionRow {
  session_id: string;
  expires_at: number;
  id: number;
  username: string;
  role: Role;
  status: UserStatus;
  created_at: number;
  last_login_at: number | null;
}

/** Resolve the cookie to a user, or null. Expired sessions are deleted on sight. */
export async function loadSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 128) return null;
  const sid = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at, u.id, u.username, u.role, u.status, u.created_at, u.last_login_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  )
    .bind(sid)
    .first<SessionRow>();
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at <= now) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    return null;
  }
  if (row.expires_at - now < SESSION_RENEW_BELOW_MS) {
    await c.env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(now + SESSION_TTL_MS, sid).run();
    setCookie(c, SESSION_COOKIE, token, cookieOptions(c, SESSION_TTL_MS / 1000));
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    sessionId: row.session_id,
  };
}

/** 401 unless logged in; 403 `banned` (and sessions revoked) for banned users. Sets c.var.user. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadSessionUser(c);
  if (!user) return errorResponse(c, "unauthorized", "请先登录");
  if (user.status === "banned") {
    await revokeUserSessions(c.env.DB, user.id);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return errorResponse(c, "banned", "账号已被封禁");
  }
  c.set("user", user);
  await next();
};

/** Use after requireUser. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.var.user?.role !== "admin") return errorResponse(c, "forbidden", "需要管理员权限");
  await next();
};

/**
 * CSRF guard for state-changing /api requests: the Origin header, when sent, must match
 * the request origin, and bodies must be JSON (HTML forms cannot send application/json).
 * SameSite=Lax already keeps the cookie off cross-site POSTs; this is defense in depth.
 */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) {
    return errorResponse(c, "forbidden", "跨站请求被拒绝");
  }
  const type = c.req.header("Content-Type") ?? "";
  const hasBody = c.req.header("Content-Length") !== "0" && (method === "POST" || method === "PUT" || method === "PATCH");
  if (hasBody && type && !type.toLowerCase().startsWith("application/json")) {
    return errorResponse(c, "invalid_input", "请求体必须是 application/json");
  }
  await next();
};
