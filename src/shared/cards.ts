// Card field model shared by parsing, task submission and export.
//
// Every credential value is a slice of the text the user submitted, addressed by
// [start, end) offsets. Nothing here — and nothing upstream, including the AI
// fallback — ever re-types a credential: a single wrong character kills the
// account and would be misreported as a bad card.

export const RT_RE = /^1\/\/[A-Za-z0-9_-]+$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const TOTP_RE = /^[A-Z2-7]{16,32}$/;

export const RT_PREFIX_LEN = 12;

export const FIELD_NAMES = ["email", "password", "totp", "rt"] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** [start, end) offsets into the submitted text (UTF-16 code units, as JS strings index). */
export type Span = [start: number, end: number];
export type RecordSpans = Partial<Record<FieldName, Span>>;
export type CardFields = Record<FieldName, string | null>;

export type RecordIssue =
  | "rt_missing" // fatal
  | "rt_invalid" // fatal: slice does not match RT_RE
  | "span_invalid" // fatal: out of range, empty, inverted or crosses a line break
  | "duplicate_rt" // fatal: same RT as an earlier record
  | "email_invalid" // needs confirmation
  | "totp_invalid"; // needs confirmation

export const FATAL_ISSUES: ReadonlySet<RecordIssue> = new Set([
  "rt_missing",
  "rt_invalid",
  "span_invalid",
  "duplicate_rt",
]);

export const ISSUE_LABELS: Record<RecordIssue, string> = {
  rt_missing: "缺少 refresh token",
  rt_invalid: "refresh token 格式不合法",
  span_invalid: "字段位置无效",
  duplicate_rt: "与前面的卡密 RT 重复",
  email_invalid: "邮箱格式不合法",
  totp_invalid: "2FA 密钥格式不合法",
};

function spanOk(text: string, span: unknown): span is Span {
  if (!Array.isArray(span) || span.length !== 2) return false;
  const [s, e] = span;
  if (!Number.isInteger(s) || !Number.isInteger(e)) return false;
  if (s < 0 || e > text.length || s >= e) return false;
  const value = text.slice(s, e);
  return !value.includes("\n") && !value.includes("\r");
}

/**
 * Slice each field out of `text` and run the rule checks on the slices.
 * Values are trimmed of surrounding whitespace only; inner characters are untouched.
 */
export function sliceAndValidate(
  text: string,
  spans: RecordSpans,
): { fields: CardFields; issues: RecordIssue[] } {
  const fields: CardFields = { email: null, password: null, totp: null, rt: null };
  const issues: RecordIssue[] = [];
  for (const name of FIELD_NAMES) {
    const span = spans[name];
    if (span === undefined || span === null) continue;
    if (!spanOk(text, span)) {
      if (!issues.includes("span_invalid")) issues.push("span_invalid");
      continue;
    }
    const value = text.slice(span[0], span[1]).trim();
    if (value) fields[name] = value;
  }
  if (!fields.rt) {
    // An invalid rt span is already reported as span_invalid.
    if (spans.rt === undefined || spans.rt === null || spanOk(text, spans.rt)) issues.push("rt_missing");
  } else if (!RT_RE.test(fields.rt)) {
    issues.push("rt_invalid");
  }
  if (fields.email && !EMAIL_RE.test(fields.email)) issues.push("email_invalid");
  if (fields.totp && !TOTP_RE.test(fields.totp)) issues.push("totp_invalid");
  return { fields, issues };
}

export function isSubmittable(issues: readonly RecordIssue[]): boolean {
  return !issues.some((i) => FATAL_ISSUES.has(i));
}

export function needsConfirm(issues: readonly RecordIssue[]): boolean {
  return issues.some((i) => !FATAL_ISSUES.has(i));
}

/** Mark every record whose RT already appeared earlier. Mutates the issue lists. */
export function markDuplicates(records: { fields: CardFields; issues: RecordIssue[] }[]): number {
  const seen = new Set<string>();
  let dups = 0;
  for (const r of records) {
    const rt = r.fields.rt;
    if (!rt || !isSubmittable(r.issues)) continue;
    if (seen.has(rt)) {
      r.issues.push("duplicate_rt");
      dups++;
    } else {
      seen.add(rt);
    }
  }
  return dups;
}

/** Split text into lines with their absolute [start, end) offsets (line breaks excluded). */
export function splitLines(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      let end = i;
      if (end > start && text[end - 1] === "\r") end--;
      out.push({ start, end, text: text.slice(start, end) });
      start = i + 1;
    }
  }
  return out;
}

/**
 * The line kept for export. A record from a single line keeps that seller line verbatim
 * (only trimmed), so separators, leading empty fields and notes survive. A record assembled
 * from several lines is rebuilt as `email----password----totp----rt` from its slices.
 */
export function recordRaw(text: string, lines: readonly number[], fields: CardFields): string {
  const unique = [...new Set(lines)];
  if (unique.length === 1) {
    const line = splitLines(text)[unique[0]];
    if (line) return line.text.trim();
  }
  return FIELD_NAMES.map((n) => fields[n])
    .filter((v): v is string => !!v)
    .join("----");
}

/** Swap only the refresh token inside the original line (mirrors agy_check.py Card.render). */
export function renderCardLine(raw: string, originalRt: string, latestRt: string): string {
  if (!raw) return latestRt;
  if (originalRt && raw.includes(originalRt)) return raw.replace(originalRt, () => latestRt);
  return raw;
}

export function rtPrefix(rt: string): string {
  return rt.length > RT_PREFIX_LEN ? `${rt.slice(0, RT_PREFIX_LEN)}…` : rt;
}

/** "ab***" style mask; never reveals more than two characters. */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  return `${value.slice(0, value.length > 4 ? 2 : 1)}***`;
}

/** Sealed per-card payload (see worker/lib/crypto.ts sealSecret). */
export interface CardSecret {
  /** Export line, see recordRaw. */
  raw: string;
  /** RT as it appears in raw. */
  rt: string;
  /** Latest RT after a check; equals rt unless Google rotated it. */
  latestRt: string;
  email: string | null;
  password: string | null;
  totp: string | null;
}
