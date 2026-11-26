import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/worker/app";
import { randomToken, sha256Hex } from "../../src/worker/lib/crypto";
import { SESSION_COOKIE } from "../../src/worker/lib/session";

async function createUser(username: string, role: "user" | "admin" = "user") {
  const now = Date.now();
  const user = await env.DB.prepare(`
    INSERT INTO users (username, password_hash, role, created_at) VALUES (?, 'unused', ?, ?) RETURNING id
  `).bind(username, role, now).first<{ id: number }>();
  if (!user) throw new Error("Fixture user missing");
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), user.id, now, now + 3_600_000).run();
  return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
}

async function createTask(id: string, userId: number, daysAgo = 0, status: "running" | "done" = "running") {
  const created = Date.now() - daysAgo * 86_400_000;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tasks (id, user_id, model, status, total, failed_count, created_at)
      VALUES (?, ?, 'fixture-model', ?, 2, 1, ?)`).bind(id, userId, status, created),
    env.DB.prepare(`INSERT INTO cards (task_id, user_id, idx, source, email, rt_prefix, secret, state, category, created_at)
      VALUES (?, ?, 0, 'rule', 'owner@example.invalid', 'fixture-prefix', 'fixture-ciphertext', 'failed', 'timeout', ?),
             (?, ?, 1, 'rule', null, 'fixture-prefix', 'fixture-ciphertext', 'queued', null, ?)`)
      .bind(id, userId, created, id, userId, created),
  ]);
}

function call(path: string, cookie: string, body?: unknown) {
  const headers = new Headers({ Cookie: cookie });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return exports.default.fetch(new Request("http://localhost/api" + path, {
    headers,
    ...(body !== undefined && { method: "POST", body: JSON.stringify(body) }),
  }));
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM users").run();
});

describe("task and record activity", () => {
  it("scopes listings and detail to the owner, returning only the activity fields", async () => {
    const owner = await createUser("activity_owner");
    const other = await createUser("activity_other");
    const admin = await createUser("activity_admin", "admin");
    await createTask("activity-visible", owner.id);
    await createTask("activity-hidden", other.id);

    const resp = await call("/tasks?pageSize=1", owner.cookie);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toMatchObject({
      total: 1,
      items: [{ id: "activity-visible", counts: { queued: 1, checking: 0, ok: 0, failed: 1 } }],
    });
    expect(await (await call("/tasks/activity-visible", owner.cookie)).json()).toMatchObject({
      task: { id: "activity-visible" }, categories: { timeout: 1 }, canExport: false,
    });
    expect((await call("/tasks/activity-hidden", owner.cookie)).status).toBe(404);
    expect((await call("/tasks/activity-visible/cards", admin.cookie)).status).toBe(404);
    expect((await call("/tasks/activity-visible/export?kind=failed", owner.cookie)).status).toBe(404);
    expect((await call("/cards?state=invalid", owner.cookie)).status).toBe(400);

    for (const path of ["/cards?state=failed", "/tasks/activity-visible/cards?category=timeout"]) {
      const response = await call(path, owner.cookie);
      const body = await response.json<{ items: object[]; total: number }>();
      expect(response.status).toBe(200);
      expect(body.total).toBe(1);
      expect(body.items).toEqual([{
        id: expect.any(Number),
        taskId: "activity-visible",
        idx: 0,
        state: "failed",
        category: "timeout",
        createdAt: expect.any(Number),
        checkedAt: null,
      }]);
    }
  });
});

describe("site administration", () => {
  it("lists site-wide task summaries and includes UTC days with zero activity", async () => {
    const admin = await createUser("stats_admin", "admin");
    const user = await createUser("stats_member");
    await createTask("stats-recent", user.id);
    await createTask("stats-old", user.id, 17, "done");

    expect(await (await call("/admin/tasks?status=done", admin.cookie)).json()).toMatchObject({
      total: 1, items: [{ id: "stats-old", owner: { username: "stats_member" } }],
    });
    const stats = await (await call("/admin/stats", admin.cookie)).json<{ daily: unknown[] }>();
    expect(stats).toMatchObject({
      users: { total: 2, banned: 0, admins: 1 },
      tasks: { total: 2, running: 1, done: 1 },
      cards: { total: 4, failed: 2, pending: 2, ok: 0 },
      categories: { timeout: 2 },
    });
    expect(stats.daily).toHaveLength(14);
    expect(stats.daily[0]).toMatchObject({ tasks: 0, cards: 0, ok: 0 });
    expect(stats.daily.at(-1)).toMatchObject({ tasks: 1, cards: 2, ok: 0 });
  });

  it("allows admins to search and change user status while revoking banned sessions", async () => {
    const admin = await createUser("moderation_admin", "admin");
    const user = await createUser("moderation_member");
    const path = `/admin/users/${user.id}/status`;
    expect(await (await call("/admin/users?q=MEMBER", admin.cookie)).json()).toMatchObject({
      total: 1, items: [{ username: "moderation_member", taskCount: 0, cardCount: 0 }],
    });
    expect((await call(path, user.cookie, { status: "banned" })).status).toBe(403);
    expect((await call(`/admin/users/${admin.id}/status`, admin.cookie, { status: "banned" })).status).toBe(400);
    expect(await (await call(path, admin.cookie, { status: "banned" })).json()).toMatchObject({
      user: { status: "banned" },
    });
    expect((await call("/tasks", user.cookie)).status).toBe(401);
    expect(await (await call(path, admin.cookie, { status: "active" })).json()).toMatchObject({
      user: { status: "active" },
    });
    expect((await call("/tasks", user.cookie)).status).toBe(401);
  });

  it("prevents moderation if the actor session is revoked before the write", async () => {
    const admin = await createUser("revoked_admin", "admin");
    const user = await createUser("revoked_target");
    const DB = {
      prepare: env.DB.prepare.bind(env.DB),
      async batch(statements: D1PreparedStatement[]) {
        await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(admin.id).run();
        return env.DB.batch(statements);
      },
    } as D1Database;
    const response = await app.request(`/api/admin/users/${user.id}/status`, {
      method: "POST",
      headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "banned" }),
    }, { ...env, DB });
    expect(response.status).toBe(404);
    expect((await call("/tasks", user.cookie)).status).toBe(200);
  });
});
