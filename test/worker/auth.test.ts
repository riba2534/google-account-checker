import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../../src/worker/app";
import type { Env } from "../../src/worker/env";
import { sha256Hex } from "../../src/worker/lib/crypto";

function auth(path: string, options: { body?: object; cookie?: string; bindings?: Partial<Env> } = {}) {
  const { body, cookie, bindings } = options;
  const headers = new Headers();
  if (cookie) headers.set("Cookie", cookie);
  if (body) headers.set("Content-Type", "application/json");
  return app.request(`https://account-checker.test/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }, { ...env, ...bindings });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  expect(header).toMatch(/agc_session=[\w-]+/);
  expect(header).toMatch(/HttpOnly/i);
  expect(header).toMatch(/Secure/i);
  expect(header).toMatch(/SameSite=Lax/i);
  return header!.split(";")[0];
}

const PASSWORD = "site-local-password";

describe("site authentication", () => {
  it("registers case-insensitive accounts, stores only the session digest, and supports logout", async () => {
    const body = { username: "SessionUser", password: PASSWORD };
    const registered = await auth("register", { body });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toEqual({
      user: {
        id: expect.any(Number),
        username: body.username,
        role: "user",
        status: "active",
        createdAt: expect.any(Number),
        lastLoginAt: expect.any(Number),
      },
    });
    const cookie = sessionCookie(registered);
    const digest = await sha256Hex(cookie.split("=")[1]);
    const session = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?").bind(digest).first();
    expect(session).toEqual({ id: digest });
    expect((await auth("me", { cookie })).status).toBe(200);
    expect((await auth("register", { body: { ...body, username: "sessionuser" } })).status).toBe(409);

    const loggedOut = await auth("logout", { body: {}, cookie });
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
    expect((await auth("logout", { body: {} })).status).toBe(200);
    expect((await auth("me", { cookie })).status).toBe(401);
  });

  it("requires the separate code for reserved admins and leaves pre-existing accounts at their role", async () => {
    const bindings = {
      ADMIN_USERNAMES: "rootadmin, firstadmin",
      INVITE_CODE: "test-ordinary-invite",
      ADMIN_BOOTSTRAP_CODE: "test-admin-invite",
    };
    const body = { username: "RootAdmin", password: PASSWORD };
    expect(await (await auth("config", { bindings })).json()).toEqual({ inviteRequired: true });
    expect((await auth("register", { body })).status).toBe(403);
    expect((await auth("register", { body: { ...body, inviteCode: bindings.INVITE_CODE }, bindings })).status).toBe(403);
    expect((await auth("register", {
      body: { ...body, inviteCode: bindings.INVITE_CODE },
      bindings: { ...bindings, ADMIN_BOOTSTRAP_CODE: bindings.INVITE_CODE },
    })).status).toBe(403);

    const registered = await auth("register", {
      body: { ...body, inviteCode: bindings.ADMIN_BOOTSTRAP_CODE },
      bindings,
    });
    expect(registered.status).toBe(201);
    expect(await registered.json()).toMatchObject({ user: { role: "admin" } });
    const alreadyOwned = { username: "FirstAdmin", password: PASSWORD };
    expect((await auth("register", { body: alreadyOwned })).status).toBe(201);
    const login = await auth("login", { body: alreadyOwned, bindings });
    expect(await login.json()).toMatchObject({ user: { role: "user" } });
  });

  it("changes the password and revokes other sessions", async () => {
    const body = { username: "RotatePassword", password: PASSWORD };
    const cookie = sessionCookie(await auth("register", { body }));
    const other = sessionCookie(await auth("login", { body: { ...body, username: "rotatepassword" } }));
    const newPassword = "site-local-new-password";

    expect((await auth("password", {
      body: { currentPassword: "incorrect", newPassword },
      cookie,
    })).status).toBe(400);
    expect((await auth("me", { cookie: other })).status).toBe(200);
    expect((await auth("password", {
      body: { currentPassword: PASSWORD, newPassword },
      cookie,
    })).status).toBe(200);

    expect((await auth("me", { cookie })).status).toBe(200);
    expect((await auth("me", { cookie: other })).status).toBe(401);
    expect((await auth("login", { body })).status).toBe(401);
    expect((await auth("login", { body: { ...body, password: newPassword } })).status).toBe(200);
  });

  it("shares the login attempt limit across username casing and resets expired windows", async () => {
    const username = "LimitedUser";
    const body = { username, password: PASSWORD };
    expect((await auth("register", { body })).status).toBe(201);
    for (let i = 0; i < 10; i++) {
      const response = await auth("login", { body: { username, password: "incorrect" } });
      expect(response.status).toBe(401);
    }
    const rateLimited = await auth("login", { body: { ...body, username: username.toUpperCase() } });
    expect(rateLimited.status).toBe(429);
    await env.DB.prepare("UPDATE login_attempts SET window_start = ? WHERE key = ?")
      .bind(Date.now() - 16 * 60_000, `u:${username.toLowerCase()}`).run();
    expect((await auth("login", { body })).status).toBe(200);
    expect(await env.DB.prepare("SELECT failures FROM login_attempts WHERE key = ?")
      .bind(`u:${username.toLowerCase()}`).first()).toBeNull();
  });

  it("reveals a ban only after verifying the password", async () => {
    const body = { username: "BannedLogin", password: PASSWORD };
    expect((await auth("register", { body })).status).toBe(201);
    await env.DB.prepare("UPDATE users SET status = 'banned' WHERE username = ?").bind(body.username).run();

    expect((await auth("login", { body: { ...body, password: "incorrect" } })).status).toBe(401);
    const attempt = await auth("login", { body });
    expect(attempt.status).toBe(403);
    expect(attempt.headers.get("set-cookie")).toBeNull();
  });
});
