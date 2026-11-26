import { Hono } from "hono";
import type {
  AdminStatsResponse, AdminUserDTO, FailCategory, Page, SetUserStatusRequest, UserDTO, UserResponse,
} from "../../shared/types";
import type { AppEnv } from "../env";
import { HttpError, pageParams, readJson } from "../lib/http";
import { failureCounts, listTasks } from "./tasks";

export const adminRoutes = new Hono<AppEnv>();

const USER_COLUMNS = `u.id, u.username, u.role, u.status, u.created_at AS createdAt, u.last_login_at AS lastLoginAt`;
const DAY_MS = 86_400_000;
const STATS_DAYS = 14;

adminRoutes.get("/users", async (c) => {
  const { DB } = c.env;
  const { page, pageSize, offset } = pageParams(c);
  const q = (c.req.query("q") ?? "").trim().slice(0, 32);
  const where = q ? "WHERE instr(lower(u.username), lower(?)) > 0" : "";
  const bindings = q ? [q] : [];
  const [users, counts] = await DB.batch<AdminUserDTO | { total: number }>([
    DB.prepare(`SELECT ${USER_COLUMNS},
        (SELECT count(*) FROM tasks WHERE user_id = u.id) AS taskCount,
        (SELECT count(*) FROM cards WHERE user_id = u.id) AS cardCount
      FROM users u ${where} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`)
      .bind(...bindings, pageSize, offset),
    DB.prepare(`SELECT count(*) AS total FROM users u ${where}`).bind(...bindings),
  ]);
  return c.json<Page<AdminUserDTO>>({
    items: users.results as AdminUserDTO[],
    total: (counts.results[0] as { total: number }).total,
    page,
    pageSize,
  });
});

adminRoutes.post("/users/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const { status } = (await readJson<SetUserStatusRequest | null>(c)) ?? {};
  if (!Number.isSafeInteger(id) || id < 1 || (status !== "active" && status !== "banned")) {
    throw new HttpError("invalid_input", "用户或状态无效");
  }
  const actorId = c.var.user.id;
  if (id === actorId && status === "banned") throw new HttpError("invalid_input", "不能封禁自己的账号");
  const { DB } = c.env;
  const statements = [
    DB.prepare(`UPDATE users SET status = ? WHERE id = ? AND EXISTS (
      SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND status = 'active'
    ) RETURNING id, username, role, status, created_at AS createdAt, last_login_at AS lastLoginAt`)
      .bind(status, id, actorId),
  ];
  if (status === "banned") {
    statements.push(DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS (
      SELECT 1 FROM users WHERE id = ? AND status = 'banned'
    )`).bind(id, id));
  }
  const [updated] = await DB.batch<UserDTO>(statements);
  const user = updated.results[0];
  if (!user) throw new HttpError("not_found", "用户不存在");
  return c.json<UserResponse>({ user });
});

adminRoutes.get("/tasks", async (c) => c.json(await listTasks(c, "admin")));

adminRoutes.get("/stats", async (c) => {
  const { DB } = c.env;
  const tomorrow = (Math.floor(Date.now() / DAY_MS) + 1) * DAY_MS;
  const start = tomorrow - STATS_DAYS * DAY_MS;
  const [users, tasks, cards, categories, daily] = await DB.batch([
    DB.prepare(`SELECT count(*) AS total, count(*) FILTER (WHERE status = 'banned') AS banned,
      count(*) FILTER (WHERE role = 'admin') AS admins FROM users`),
    DB.prepare(`SELECT count(*) AS total, count(*) FILTER (WHERE status = 'running') AS running,
      count(*) FILTER (WHERE status = 'done') AS done FROM tasks`),
    DB.prepare(`SELECT count(*) AS total, count(*) FILTER (WHERE state = 'ok') AS ok,
      count(*) FILTER (WHERE state = 'failed') AS failed,
      count(*) FILTER (WHERE state IN ('queued', 'checking')) AS pending FROM cards`),
    DB.prepare(`SELECT category, count(*) AS count FROM cards
      WHERE state = 'failed' AND category IS NOT NULL GROUP BY category`),
    DB.prepare(`SELECT day, sum(tasks) AS tasks, sum(cards) AS cards, sum(ok) AS ok FROM (
      SELECT created_at / ${DAY_MS} AS day, count(*) AS tasks, 0 AS cards, 0 AS ok
        FROM tasks WHERE created_at >= ? AND created_at < ? GROUP BY day
      UNION ALL
      SELECT created_at / ${DAY_MS} AS day, 0 AS tasks, count(*) AS cards,
        count(*) FILTER (WHERE state = 'ok') AS ok
        FROM cards WHERE created_at >= ? AND created_at < ? GROUP BY day
    ) GROUP BY day`).bind(start, tomorrow, start, tomorrow),
  ]);
  const byDay = new Map((daily.results as { day: number; tasks: number; cards: number; ok: number }[])
    .map(({ day, tasks, cards, ok }) => [day, { tasks, cards, ok }]));
  return c.json<AdminStatsResponse>({
    users: users.results[0] as AdminStatsResponse["users"],
    tasks: tasks.results[0] as AdminStatsResponse["tasks"],
    cards: cards.results[0] as AdminStatsResponse["cards"],
    categories: failureCounts(categories.results as { category: FailCategory; count: number }[]),
    daily: Array.from({ length: STATS_DAYS }, (_, i) => ({
      date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
      ...(byDay.get(start / DAY_MS + i) ?? { tasks: 0, cards: 0, ok: 0 }),
    })),
  });
});
