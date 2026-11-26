// API contract shared by the Worker and the SPA. Timestamps are Unix epoch milliseconds.

import type { RecordIssue, RecordSpans } from "./cards";

// --- models -------------------------------------------------------------------

/** Gate model: a card passes only when this model really answers. */
export const DEFAULT_MODEL = "gemini-4-neon-medium";

/** Shown as suggestions in the model picker; any id matching MODEL_ID_RE is accepted. */
export const MODEL_SUGGESTIONS = [
  "gemini-4-neon-medium",
  "gemini-4-neon-low",
  "gemini-4-neon-high",
  "gemini-4-neon-xhigh",
  "gemini-4-carbon-medium",
  "gemini-4-argon-medium",
  "gemini-4-hydrogen-medium",
  "gemini-3.8-flash-medium",
  "gemini-3-flash",
  "claude-sonnet-5-5-medium",
  "claude-opus-5-5-medium",
  "gpt-oss-120b-medium",
] as const;

export const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

// --- limits -------------------------------------------------------------------

export const MAX_TEXT_LENGTH = 1_000_000;
export const MAX_CARDS_PER_TASK = 2000;
/** Lines beyond this many unparsed lines are not sent to the AI fallback. */
export const MAX_AI_LINES = 300;

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// --- errors -------------------------------------------------------------------

export type ErrorCode =
  | "unauthorized" // 401 not logged in / session expired
  | "forbidden" // 403 logged in but not allowed
  | "banned" // 403 account banned
  | "not_found" // 404
  | "invalid_input" // 400 validation failed
  | "confirmation_required" // 400 a submitted record has issues and was not confirmed
  | "conflict" // 409 e.g. username taken, task still running
  | "rate_limited" // 429
  | "ai_unavailable" // 502 AI parse failed entirely
  | "server_misconfigured" // 500 a required secret is missing
  | "internal"; // 500

export interface ApiError {
  error: { code: ErrorCode; message: string };
}

// --- users --------------------------------------------------------------------

export type Role = "user" | "admin";
export type UserStatus = "active" | "banned";

export interface UserDTO {
  id: number;
  username: string;
  role: Role;
  status: UserStatus;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface RegisterRequest {
  username: string;
  password: string;
  inviteCode?: string;
}
export interface LoginRequest {
  username: string;
  password: string;
}
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
export interface UserResponse {
  user: UserDTO;
}
/** GET /api/auth/config — public, lets the register page know whether to ask for an invite code. */
export interface AuthConfigResponse {
  inviteRequired: boolean;
}

// --- parsing ------------------------------------------------------------------

export type RecordSource = "rule" | "ai";

export interface ParsePreview {
  email: string | null;
  /** e.g. "Pa***" — never the full password. */
  passwordMasked: string | null;
  totpMasked: string | null;
  /** First RT_PREFIX_LEN characters of the refresh token plus "…". */
  rtPrefix: string | null;
}

export interface ParsedRecordDTO {
  /** Position in the records array; stable for one parse response. */
  id: number;
  source: RecordSource;
  /** 0-based line numbers this record was built from (several for AI multi-line records). */
  lines: number[];
  /** Offsets into the submitted text. The client sends them back unchanged on submit. */
  spans: RecordSpans;
  preview: ParsePreview;
  issues: RecordIssue[];
  /** false when a fatal issue (missing/invalid RT, duplicate) prevents submitting the record. */
  submittable: boolean;
  /** true when non-fatal issues exist; the user must tick the row before it can be submitted. */
  needsConfirm: boolean;
}

export interface ParseRequest {
  text: string;
}

export interface ParseResponse {
  records: ParsedRecordDTO[];
  /** Non-empty, non-comment lines that produced no record (shown red as "未识别"). */
  unmatchedLines: number[];
  stats: { lines: number; rule: number; ai: number; unmatched: number };
  /** Set when the AI fallback was needed but failed or is not configured. */
  aiError?: string;
}

// --- tasks --------------------------------------------------------------------

export type TaskStatus = "running" | "done";
export type CardState = "queued" | "checking" | "ok" | "failed";

export interface SubmitRecord {
  spans: RecordSpans;
  lines: number[];
  source: RecordSource;
  /** User ticked a needsConfirm row. */
  confirmed: boolean;
}

export interface CreateTaskRequest {
  /** Exactly the text that was parsed; spans index into it. */
  text: string;
  model: string;
  records: SubmitRecord[];
}

export interface TaskCounts {
  queued: number;
  checking: number;
  ok: number;
  failed: number;
}

export interface TaskDTO {
  id: string;
  model: string;
  status: TaskStatus;
  total: number;
  counts: TaskCounts;
  createdAt: number;
  finishedAt: number | null;
  /** Present on admin listings and when an admin views someone else's task. */
  owner?: { id: number; username: string };
}

export interface CreateTaskResponse {
  task: TaskDTO;
  /** Records dropped because their RT repeated an earlier record. */
  duplicates: number;
}

export interface TaskDetailResponse {
  task: TaskDTO;
  /** Failed cards grouped by category. */
  categories: Partial<Record<FailCategory, number>>;
  /** Only the owner may export. */
  canExport: boolean;
}

export interface ModelInfo {
  id: string;
  displayName: string | null;
  remainingFraction: number | null;
  resetTime: string | null;
}

export interface CardDTO {
  id: number;
  taskId: string;
  idx: number;
  source: RecordSource;
  email: string | null;
  rtPrefix: string;
  hasPassword: boolean;
  hasTotp: boolean;
  state: CardState;
  category: FailCategory | null;
  reason: string | null;
  tier: string | null;
  /** Models this account can see, from fetchAvailableModels; null when not reached. */
  models: ModelInfo[] | null;
  /** Remaining quota fraction of the gate model. */
  quota: number | null;
  quotaReset: string | null;
  rtChanged: boolean;
  latencyMs: number | null;
  checkedAt: number | null;
  createdAt: number;
}

export type CardActivityDTO = Pick<
  CardDTO,
  "id" | "taskId" | "idx" | "state" | "category" | "createdAt" | "checkedAt"
>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type ExportKind = "ok" | "failed";

// --- admin --------------------------------------------------------------------

export interface AdminUserDTO extends UserDTO {
  taskCount: number;
  cardCount: number;
}

export interface SetUserStatusRequest {
  status: UserStatus;
}

export interface AdminStatsResponse {
  users: { total: number; banned: number; admins: number };
  tasks: { total: number; running: number; done: number };
  cards: { total: number; ok: number; failed: number; pending: number };
  categories: Partial<Record<FailCategory, number>>;
  /** Last 14 days, oldest first, UTC dates "YYYY-MM-DD". */
  daily: { date: string; tasks: number; cards: number; ok: number }[];
}

// --- queue --------------------------------------------------------------------

/** One message per card. Credentials never travel through the queue. */
export interface CheckMessage {
  cardId: number;
  taskId: string;
}

// --- failure categories --------------------------------------------------------

export const FAIL_CATEGORIES = [
  "invalid_grant",
  "validation_required",
  "tos_violation",
  "restricted_age",
  "quota_exhausted",
  "missing_project",
  "rate_limit",
  "capacity",
  "timeout",
  "network",
  "unauthorized",
  "forbidden",
  "neon_unavailable",
  "model_not_found",
  "upstream_error",
  "error",
  "exception",
] as const;
export type FailCategory = (typeof FAIL_CATEGORIES)[number];

/** Categories caused by test pacing or transient upstream state, not by a bad account. */
export const RETRYABLE_CATEGORIES: ReadonlySet<FailCategory> = new Set([
  "timeout",
  "network",
  "rate_limit",
  "capacity",
  "upstream_error",
]);

export const CATEGORY_INFO: Record<FailCategory, { label: string; hint: string }> = {
  invalid_grant: { label: "RT 失效", hint: "refresh token 已过期或被吊销，卡密作废" },
  validation_required: { label: "需要验证", hint: "Google 要求人工验证账号，带密码和 2FA 登录完成验证后可恢复" },
  tos_violation: { label: "TOS 封禁", hint: "账号因违反服务条款被封，基本无法恢复" },
  restricted_age: { label: "年龄限制", hint: "账号受年龄限制，无法使用" },
  quota_exhausted: { label: "配额用尽", hint: "校验模型配额为 0，等配额重置后再测" },
  missing_project: { label: "无 Project", hint: "拿不到 project，偶发，可重测" },
  rate_limit: { label: "限流", hint: "429 限流，属于测试节奏问题，降并发重测" },
  capacity: { label: "容量不足", hint: "上游容量不足，稍后重测" },
  timeout: { label: "超时", hint: "请求超时，稍后重测" },
  network: { label: "网络错误", hint: "连接中断，重测即可" },
  unauthorized: { label: "未授权", hint: "401，多数不可用" },
  forbidden: { label: "禁止访问", hint: "403，多数不可用" },
  neon_unavailable: { label: "Neon 不可用", hint: "neon 对该账号返回 404，实测多为瞬时，重测往往恢复" },
  model_not_found: { label: "模型不存在", hint: "所选模型对该账号返回 404，检查模型名" },
  upstream_error: { label: "上游错误", hint: "Google 返回 5xx，稍后重测" },
  error: { label: "其他错误", hint: "未归类的错误，查看原因详情" },
  exception: { label: "程序异常", hint: "校验过程异常，可重测" },
};

export const STATE_LABELS: Record<CardState, string> = {
  queued: "排队中",
  checking: "校验中",
  ok: "可用",
  failed: "不可用",
};
