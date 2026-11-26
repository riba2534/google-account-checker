import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_RE,
  type AuthConfigResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type UserResponse,
} from "../../shared/types";
import type { AppEnv } from "../env";
import { hashPassword, PBKDF2_ITERATIONS, timingSafeEqual, verifyPassword } from "../lib/crypto";
import { errorResponse, HttpError, readJson } from "../lib/http";
import { endSession, requireUser, startSession, toUserDTO, type UserRow } from "../lib/session";

const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;
// Exercise the same KDF for unknown usernames. These are fixed dummy bytes, not a password.
const DUMMY_PASSWORD_HASH = `pbkdf2_sha256$${PBKDF2_ITERATIONS}$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`;
const LOGIN_ERROR = "用户名或密码错误";

const authBodyLimit = bodyLimit({
  maxSize: 4_096,
  onError: (c) => errorResponse(c, "invalid_input", "请求体过大"),
});

export const authRoutes = new Hono<AppEnv>();
authRoutes.get("/config", (c) => c.json<AuthConfigResponse>({ inviteRequired: Boolean(c.env.INVITE_CODE) }));

function isUsername(value: unknown): value is string {
  return typeof value === "string" && USERNAME_RE.test(value);
}

function isPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

async function matchesCode(value: string | undefined, expected: string): Promise<boolean> {
  if (typeof value !== "string") return false;
  const enc = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(value)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash));
}

interface CredentialRow extends UserRow {
  password_hash: string;
}

authRoutes.post("/register", authBodyLimit, async (c) => {
  const body = await readJson<Partial<RegisterRequest> | null>(c);
  const username = body?.username;
  const password = body?.password;
  if (!isUsername(username) || !isPassword(password)) {
    throw new HttpError("invalid_input", "用户名或密码格式不符合要求");
  }

  const reserved = (c.env.ADMIN_USERNAMES ?? "").split(",").some(
    (name) => name.trim().toLowerCase() === username.toLowerCase(),
  );
  const invite = c.env.INVITE_CODE;
  const bootstrap = c.env.ADMIN_BOOTSTRAP_CODE;
  if (reserved) {
    if (!invite || !bootstrap || invite === bootstrap || !(await matchesCode(body?.inviteCode, bootstrap))) {
      throw new HttpError("forbidden", "无法使用此用户名和邀请码注册");
    }
  } else if (invite && !(await matchesCode(body?.inviteCode, invite))) {
    throw new HttpError("forbidden", "无法使用此用户名和邀请码注册");
  }

  const passwordHash = await hashPassword(password);
  const row = await c.env.DB.prepare(
    `INSERT INTO users (username, password_hash, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (username) DO NOTHING
     RETURNING id, username, role, status, created_at, last_login_at`,
  ).bind(username, passwordHash, reserved ? "admin" : "user", Date.now()).first<UserRow>();
  if (!row) throw new HttpError("conflict", "用户名已被注册");

  const lastLoginAt = await startSession(c, row.id, passwordHash);
  if (lastLoginAt === null) throw new HttpError("forbidden", "无法创建会话");
  return c.json<UserResponse>({ user: toUserDTO({ ...row, last_login_at: lastLoginAt }) }, 201);
});

authRoutes.post("/login", authBodyLimit, async (c) => {
  const body = await readJson<Partial<LoginRequest> | null>(c);
  const username = body?.username;
  const password = body?.password;
  if (!isUsername(username) || typeof password !== "string" || password.length > PASSWORD_MAX) {
    throw new HttpError("unauthorized", LOGIN_ERROR);
  }

  // Reserve a slot before verifying the password so concurrent requests share one limit.
  const key = `u:${username.toLowerCase()}`;
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  const attempt = await c.env.DB.prepare(
    `INSERT INTO login_attempts (key, failures, window_start) VALUES (?, 1, ?)
     ON CONFLICT (key) DO UPDATE SET
       failures = CASE WHEN window_start <= ? THEN 1 ELSE failures + 1 END,
       window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END
     WHERE window_start <= ? OR failures < ?
     RETURNING failures`,
  ).bind(key, now, cutoff, cutoff, cutoff, LOGIN_LIMIT).first();
  if (!attempt) throw new HttpError("rate_limited", "登录尝试过多，请稍后再试");

  const row = await c.env.DB.prepare(
    `SELECT id, username, role, status, created_at, last_login_at, password_hash FROM users WHERE username = ?`,
  ).bind(username).first<CredentialRow>();
  const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!row || !valid) throw new HttpError("unauthorized", LOGIN_ERROR);
  if (row.status === "banned") throw new HttpError("banned", "账号已被封禁");

  const lastLoginAt = await startSession(c, row.id, row.password_hash, key);
  if (lastLoginAt === null) throw new HttpError("unauthorized", LOGIN_ERROR);
  return c.json<UserResponse>({ user: toUserDTO({ ...row, last_login_at: lastLoginAt }) });
});

authRoutes.post("/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

authRoutes.get("/me", requireUser, (c) => {
  const { id, username, role, status, createdAt, lastLoginAt } = c.var.user;
  return c.json<UserResponse>({ user: { id, username, role, status, createdAt, lastLoginAt } });
});

authRoutes.post("/password", authBodyLimit, requireUser, async (c) => {
  const body = await readJson<Partial<ChangePasswordRequest> | null>(c);
  const current = body?.currentPassword;
  const next = body?.newPassword;
  if (typeof current !== "string" || current.length > PASSWORD_MAX || !isPassword(next)) {
    throw new HttpError("invalid_input", "密码格式不符合要求");
  }

  const user = c.var.user;
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    throw new HttpError("invalid_input", "当前密码错误");
  }

  const passwordHash = await hashPassword(next);
  const db = c.env.DB;
  const [updated] = await db.batch([
    db.prepare(
      `UPDATE users SET password_hash = ?
       WHERE id = ? AND password_hash = ? AND status = 'active'
         AND EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?)`,
    ).bind(passwordHash, user.id, row.password_hash, user.sessionId, user.id, Date.now()),
    db.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND id != ?
         AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`,
    ).bind(user.id, user.sessionId, user.id, passwordHash),
  ]);
  if (updated.meta.changes !== 1) {
    throw new HttpError("conflict", "账号状态已变化，请重新登录后再试");
  }
  return c.json({ ok: true });
});
