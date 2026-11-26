// Cookie sessions. The browser holds a random token; D1 stores only its SHA-256.

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Role, UserDTO, UserStatus } from "../../shared/types";
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

/** Create a session only if the verified password and active status still match. */
export async function startSession(
  c: Context<AppEnv>,
  userId: number,
  passwordHash: string,
  loginAttemptKey?: string,
): Promise<number | null> {
  const token = randomToken();
  const now = Date.now();
  const db = c.env.DB;
  const statements = [
    db.prepare(
      "UPDATE users SET last_login_at = max(coalesce(last_login_at, 0), ?) WHERE id = ? AND status = 'active' AND password_hash = ?",
    ).bind(now, userId, passwordHash),
    db.prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at)
       SELECT ?, id, ?, ? FROM users WHERE id = ? AND status = 'active' AND password_hash = ?`,
    ).bind(await sha256Hex(token), now, now + SESSION_TTL_MS, userId, passwordHash),
  ];
  if (loginAttemptKey) {
    statements.push(db.prepare(
      `DELETE FROM login_attempts WHERE key = ?
       AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active' AND password_hash = ?)`,
    ).bind(loginAttemptKey, userId, passwordHash));
  }
  const [, inserted] = await db.batch(statements);
  if (inserted.meta.changes !== 1) return null;
  setCookie(c, SESSION_COOKIE, token, cookieOptions(c, SESSION_TTL_MS / 1000));
  return now;
}

/** Delete the current session (if any) and clear the cookie. */
export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && token.length <= 128) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c, 0));
}

export interface UserRow {
  id: number;
  username: string;
  role: Role;
  status: UserStatus;
  created_at: number;
  last_login_at: number | null;
}

export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

interface SessionRow extends UserRow {
  session_id: string;
  expires_at: number;
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
  return { ...toUserDTO(row), sessionId: row.session_id };
}

/** 401 unless logged in; 403 `banned` (and sessions revoked) for banned users. Sets c.var.user. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadSessionUser(c);
  if (!user) return errorResponse(c, "unauthorized", "请先登录");
  if (user.status === "banned") {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (
      SELECT 1 FROM users WHERE id = ? AND status = 'banned'
    )`).bind(user.id, user.id).run();
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c, 0));
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
