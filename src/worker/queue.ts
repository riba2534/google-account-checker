import type { CheckMessage } from "../shared/types";
import type { Env } from "./env";

// Stub — implemented by the checker sub-item.
export async function handleQueue(batch: MessageBatch<CheckMessage>, _env: Env, _ctx: ExecutionContext): Promise<void> {
  batch.retryAll();
}
