import { exports } from "cloudflare:workers";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { hashPassword } from "../../src/worker/lib/crypto";
import { SESSION_COOKIE } from "../../src/worker/lib/session";
import { randomToken, sha256Hex } from "../../src/worker/lib/crypto";

const BASE = "http://localhost";
const call = (path: string, init?: RequestInit) => exports.default.fetch(new Request(BASE + path, init));

async function sessionFor(username: string, role: "user" | "admin", status = "active") {
  const now = Date.now();
  const user = await env.DB.prepare(
    "INSERT INTO users (username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
  )
    .bind(username, await hashPassword("irrelevant-pw"), role, status, now)
    .first<{ id: number }>();
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), user!.id, now, now + 3600_000)
    .run();
  return `${SESSION_COOKIE}=${token}`;
}

describe("central route guards", () => {
  const protectedPaths = ["/api/parse", "/api/tasks", "/api/tasks/abc", "/api/tasks/abc/cards", "/api/cards", "/api/admin/stats", "/api/admin"];
  it.each(protectedPaths)("%s requires a session", async (p) => {
    const res = await call(p);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
  it("admin routes reject plain users", async () => {
    const cookie = await sessionFor("guard_user", "user");
    const res = await call("/api/admin/stats", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
  });
  it("banned users are rejected and their sessions revoked", async () => {
    const cookie = await sessionFor("guard_banned", "user", "banned");
    const res = await call("/api/tasks", { headers: { Cookie: cookie } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "banned" } });
    expect((await call("/api/tasks", { headers: { Cookie: cookie } })).status).toBe(401);
  });
  it("cross-site POSTs are refused", async () => {
    const res = await call("/api/auth/login", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
  it("unknown api paths are json 404 and responses are not cached", async () => {
    const res = await call("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
