import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "../../shared/types";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  unauthorized: 401,
  forbidden: 403,
  banned: 403,
  not_found: 404,
  invalid_input: 400,
  confirmation_required: 400,
  conflict: 409,
  rate_limited: 429,
  ai_unavailable: 502,
  server_misconfigured: 500,
  internal: 500,
};

/** Thrown anywhere in a handler; app.onError turns it into the ApiError JSON shape. */
export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
  get status(): ContentfulStatusCode {
    return STATUS[this.code];
  }
}

export function errorResponse(c: Context, code: ErrorCode, message: string) {
  return c.json({ error: { code, message } }, STATUS[code]);
}

/** Parse a JSON body or throw invalid_input. */
export async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError("invalid_input", "请求体不是合法的 JSON");
  }
}

/** ?page=&pageSize= with sane bounds. */
export function pageParams(c: Context, defaultSize = 20, maxSize = 200) {
  const page = Math.max(1, Number.parseInt(c.req.query("page") ?? "1", 10) || 1);
  const raw = Number.parseInt(c.req.query("pageSize") ?? String(defaultSize), 10) || defaultSize;
  const pageSize = Math.min(maxSize, Math.max(1, raw));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function requireSecret(value: string | undefined, name: string): string {
  if (!value) throw new HttpError("server_misconfigured", `服务端未配置 ${name}`);
  return value;
}
