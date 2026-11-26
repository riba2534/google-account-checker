import { Hono, type Context } from "hono";
import { FAIL_CATEGORIES, STATE_LABELS, type CardActivityDTO, type FailCategory, type Page } from "../../shared/types";
import type { AppEnv } from "../env";
import { HttpError, pageParams } from "../lib/http";

export const cardRoutes = new Hono<AppEnv>();

export async function listCardActivity(c: Context<AppEnv>, taskId?: string): Promise<Page<CardActivityDTO>> {
  const { page, pageSize, offset } = pageParams(c, taskId === undefined ? 20 : 50);
  const state = c.req.query("state");
  const category = c.req.query("category");
  if (state !== undefined && !Object.hasOwn(STATE_LABELS, state)) {
    throw new HttpError("invalid_input", "记录状态无效");
  }
  if (category !== undefined && !FAIL_CATEGORIES.includes(category as FailCategory)) {
    throw new HttpError("invalid_input", "原因分类无效");
  }
  const conditions = ["user_id = ?"];
  const bindings: (number | string)[] = [c.var.user.id];
  if (taskId !== undefined) {
    conditions.push("task_id = ?");
    bindings.push(taskId);
  }
  if (state) {
    conditions.push("state = ?");
    bindings.push(state);
  }
  if (category) {
    conditions.push("category = ?");
    bindings.push(category);
  }
  const where = conditions.join(" AND ");
  const order = taskId === undefined ? "created_at DESC, id DESC" : "idx ASC";
  const { DB } = c.env;
  const [rows, counts] = await DB.batch<CardActivityDTO | { total: number }>([
    DB.prepare(`SELECT id, task_id AS taskId, idx, state, category, created_at AS createdAt, checked_at AS checkedAt
      FROM cards WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...bindings, pageSize, offset),
    DB.prepare(`SELECT count(*) AS total FROM cards WHERE ${where}`).bind(...bindings),
  ]);
  return { items: rows.results as CardActivityDTO[], total: (counts.results[0] as { total: number }).total, page, pageSize };
}

cardRoutes.get("/", async (c) => c.json(await listCardActivity(c)));
