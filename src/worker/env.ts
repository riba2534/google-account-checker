import type { CheckMessage, Role, UserStatus } from "../shared/types";

export interface Env {
  DB: D1Database;
  CHECK_QUEUE: Queue<CheckMessage>;
  ASSETS: Fetcher;

  // vars (wrangler.jsonc)
  DEEPSEEK_BASE_URL: string;
  DEEPSEEK_MODEL: string;

  // secrets (`wrangler secret put`, or .dev.vars locally) — never commit values
  DEEPSEEK_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  CARD_ENCRYPTION_KEY?: string;
  /** Comma-separated usernames reserved for administrator registration. */
  ADMIN_USERNAMES?: string;
  /** Separate invite code for creating accounts with reserved usernames. */
  ADMIN_BOOTSTRAP_CODE?: string;
  /** When non-empty, registration requires this code. */
  INVITE_CODE?: string;
}

export interface SessionUser {
  id: number;
  username: string;
  role: Role;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
  /** SHA-256 hex id of the current session row. */
  sessionId: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
