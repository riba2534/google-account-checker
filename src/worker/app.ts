import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";
import { HttpError, errorResponse } from "./lib/http";
import { csrfGuard, requireAdmin, requireUser } from "./lib/session";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { cardRoutes } from "./routes/cards";
import { parseRoutes } from "./routes/parse";
import { taskRoutes } from "./routes/tasks";

const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});
api.use("*", csrfGuard);

/** Apply middleware to a prefix and everything under it. */
function guard(prefix: string, ...mw: MiddlewareHandler<AppEnv>[]) {
  for (const m of mw) {
    api.use(prefix, m);
    api.use(`${prefix}/*`, m);
  }
}

// Everything except /api/auth requires a session; /api/admin also requires the admin role.
guard("/parse", requireUser);
guard("/tasks", requireUser);
guard("/cards", requireUser);
guard("/admin", requireUser, requireAdmin);

api.route("/auth", authRoutes);
api.route("/parse", parseRoutes);
api.route("/tasks", taskRoutes);
api.route("/cards", cardRoutes);
api.route("/admin", adminRoutes);

api.notFound((c) => errorResponse(c, "not_found", "接口不存在"));
api.onError((err, c) => {
  if (err instanceof HttpError) return errorResponse(c, err.code, err.message);
  console.error("unhandled", err);
  return errorResponse(c, "internal", "服务器内部错误");
});

export const app = new Hono<AppEnv>();
app.route("/api", api);
// Static assets are served before the Worker runs; this only sees misses outside /api.
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
