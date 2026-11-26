import type { CheckMessage } from "../shared/types";
import { app } from "./app";
import type { Env } from "./env";
import { handleQueue } from "./queue";

export default {
  fetch: app.fetch,
  queue: handleQueue,
} satisfies ExportedHandler<Env, CheckMessage>;
