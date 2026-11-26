import { Hono, type Context } from "hono";
import type { FailCategory, Page, TaskDTO, TaskDetailResponse, TaskStatus } from "../../shared/types";
import type { AppEnv } from "../env";
import { HttpError, pageParams } from "../lib/http";
import { listCardActivity } from "./cards";

export const taskRoutes = new Hono<AppEnv>();

interface TaskRow {
  id: string;
  model: string;
  status: TaskStatus;
  total: number;
  ok_count: number;
  failed_count: number;
  queued: number;
  checking: number;
  created_at: number;
  finished_at: number | null;
  user_id: number;
  username: string;
}

const TASK_COLUMNS = `
  t.id, t.model, t.status, t.total, t.ok_count, t.failed_count, t.created_at, t.finished_at, t.user_id, u.username,
  (SELECT count(*) FROM cards WHERE task_id = t.id AND state = 'queued') AS queued,
  (SELECT count(*) FROM cards WHERE task_id = t.id AND state = 'checking') AS checking
`;

function toTask(row: TaskRow, includeOwner: boolean): TaskDTO {
  return {
    id: row.id,
    model: row.model,
    status: row.status,
    total: row.total,
    counts: { queued: row.queued, checking: row.checking, ok: row.ok_count, failed: row.failed_count },
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    ...(includeOwner && { owner: { id: row.user_id, username: row.username } }),
  };
}

export async function listTasks(c: Context<AppEnv>, scope: "owner" | "admin"): Promise<Page<TaskDTO>> {
  const { page, pageSize, offset } = pageParams(c);
  const { DB } = c.env;
  const status = c.req.query("status");
  if (status !== undefined && status !== "running" && status !== "done") {
    throw new HttpError("invalid_input", "任务状态无效");
  }
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];
  if (scope === "owner") {
    conditions.push("t.user_id = ?");
    bindings.push(c.var.user.id);
  }
  if (status) {
    conditions.push("t.status = ?");
    bindings.push(status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows, counts] = await DB.batch<TaskRow | { total: number }>([
    DB.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t JOIN users u ON u.id = t.user_id
      ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, offset),
    DB.prepare(`SELECT count(*) AS total FROM tasks t ${where}`).bind(...bindings),
  ]);
  return {
    items: (rows.results as TaskRow[]).map((row) => toTask(row, scope === "admin")),
    total: counts.results[0].total,
    page,
    pageSize,
  };
}

export function failureCounts(rows: { category: FailCategory; count: number }[]) {
  return Object.fromEntries(rows.map(({ category, count }) => [category, count])) as Partial<Record<FailCategory, number>>;
}

taskRoutes.get("/", async (c) => c.json(await listTasks(c, "owner")));

taskRoutes.get("/:id", async (c) => {
  const { DB } = c.env;
  const id = c.req.param("id");
  const userId = c.var.user.id;
  const [task, grouped] = await DB.batch<TaskRow | { category: FailCategory; count: number }>([
    DB.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t JOIN users u ON u.id = t.user_id
      WHERE t.id = ? AND t.user_id = ?`).bind(id, userId),
    DB.prepare(`SELECT category, count(*) AS count FROM cards
      WHERE task_id = ? AND user_id = ? AND state = 'failed' AND category IS NOT NULL GROUP BY category`).bind(id, userId),
  ]);
  const row = task.results[0] as TaskRow | undefined;
  if (!row) throw new HttpError("not_found", "任务不存在");
  return c.json<TaskDetailResponse>({
    task: toTask(row, false),
    categories: failureCounts(grouped.results as { category: FailCategory; count: number }[]),
    canExport: false,
  });
});

taskRoutes.get("/:id/cards", async (c) => {
  const id = c.req.param("id");
  const owned = await c.env.DB.prepare("SELECT id FROM tasks WHERE id = ? AND user_id = ?")
    .bind(id, c.var.user.id).first();
  if (!owned) throw new HttpError("not_found", "任务不存在");
  return c.json(await listCardActivity(c, id));
});
