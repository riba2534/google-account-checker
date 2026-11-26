import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { CATEGORY_INFO, STATE_LABELS } from "../shared/types";
import type { FailCategory, Page, TaskStatus, UserStatus } from "../shared/types";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const numberFormat = new Intl.NumberFormat("zh-CN");

export function dateText(value: number | null) {
  return value === null ? "—" : dateFormat.format(value);
}

export function categoryText(category: FailCategory | null) {
  return category ? CATEGORY_INFO[category]?.label ?? category : "—";
}

export const taskLabels: Record<TaskStatus, string> = { running: "进行中", done: "已完成" };
const statusLabels: Record<UserStatus, string> = { active: "正常", banned: "已封禁" };
const labels = { ...STATE_LABELS, ...taskLabels, ...statusLabels };

export function Badge({ status }: { status: keyof typeof labels }) {
  return <span className={"badge badge-" + status}>{labels[status]}</span>;
}

export function Heading({ children, description, back }: { children: ReactNode; description?: string; back?: ReactNode }) {
  return <header className="page-heading">
    {back}
    <h1>{children}</h1>
    {description && <p>{description}</p>}
  </header>;
}

export function Notice({ message, reload, busy }: { message?: string; reload?: () => void; busy?: boolean }) {
  if (message) return <div className="notice notice-error" role="alert">
    <span>{message}</span>
    {reload && <button className="button button-secondary" onClick={reload}>重试</button>}
  </div>;
  if (busy) return <p className="notice" role="status">正在加载…</p>;
  return null;
}

export function Empty({ title }: { title: string }) {
  return <div className="empty">
    <span className="empty-mark" aria-hidden="true">▤</span>
    <p>{title}</p>
  </div>;
}

export function Metrics({ values }: { values: { label: string; count: number; detail?: string }[] }) {
  return <dl className="metrics">
    {values.map(({ label, count, detail }) => <div className="metric" key={label}>
      <dt>{label}</dt>
      <dd>{numberFormat.format(count)}</dd>
      {detail && <dd className="metric-detail">{detail}</dd>}
    </div>)}
  </dl>;
}

export function useFilters() {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("page"));
  const page = Number.isSafeInteger(raw) && raw > 0 ? raw : 1;

  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== "page") next.delete("page");
    setParams(next);
  }

  function query(...filters: string[]) {
    const query = new URLSearchParams({ page: String(page) });
    for (const name of filters) {
      const value = params.get(name);
      if (value) query.set(name, value);
    }
    return "?" + query.toString();
  }

  return { params, page, update, query };
}

export function Pagination({ data, onPage }: { data: Page<unknown>; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <footer className="pagination">
    <span>共 {numberFormat.format(data.total)} 条</span>
    {(pages > 1 || data.page > 1) && <nav aria-label="分页">
      <button className="button button-secondary" disabled={data.page <= 1} onClick={() => onPage(Math.min(data.page - 1, pages))}>上一页</button>
      <span>{data.page} / {pages}</span>
      <button className="button button-secondary" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>下一页</button>
    </nav>}
  </footer>;
}
