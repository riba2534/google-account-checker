import { type FormEvent, useState } from "react";
import type { AdminStatsResponse, AdminUserDTO, Page, UserDTO, UserResponse } from "../shared/types";
import { errorMessage, request, useResource } from "./api";
import { Badge, categoryText, dateText, Empty, Heading, Metrics, Notice, Pagination, useFilters } from "./components";

export function AdminOverview() {
  const { data, error, reload } = useResource<AdminStatsResponse>("/admin/stats");
  const maxTasks = Math.max(1, ...(data?.daily.map((day) => day.tasks) ?? []));
  return <>
    <Heading description="查看站内用户、任务和处理记录的汇总。">管理概览</Heading>
    <Notice message={error} reload={reload} busy={!data} />
    {data && <>
      <Metrics values={[
        { label: "用户数", count: data.users.total, detail: data.users.admins + " 位管理员 · " + data.users.banned + " 位已封禁" },
        { label: "任务数", count: data.tasks.total, detail: data.tasks.running + " 进行中 · " + data.tasks.done + " 已完成" },
        { label: "记录数", count: data.cards.total, detail: data.cards.pending + " 等待处理 · " + data.cards.failed + " 失败" },
      ]} />
      <div className="admin-columns">
        <section className="panel">
          <div className="panel-header"><h2>近 14 日任务数</h2><span className="muted">UTC</span></div>
          {data.daily.length ? <>
            <div className="chart" aria-hidden="true">
              {data.daily.map(({ date, tasks }) => <div className="chart-column" key={date} title={date + " · " + tasks + " 个任务"}>
                <div className="chart-track"><div className="chart-bar" style={{ height: (tasks / maxTasks * 100) + "%" }} /></div>
              </div>)}
            </div>
            <div className="chart-dates" aria-hidden="true"><span>{data.daily[0].date}</span><span>{data.daily.at(-1)?.date}</span></div>
            <details>
              <summary>查看每日数据</summary>
              <div className="table-scroll" tabIndex={0} role="region" aria-label="每日数据">
                <table>
                  <thead><tr><th scope="col">日期 (UTC)</th><th scope="col">任务</th><th scope="col">记录</th><th scope="col">通过</th></tr></thead>
                  <tbody>{data.daily.map((day) => <tr key={day.date}>
                    <th scope="row">{day.date}</th><td>{day.tasks}</td><td>{day.cards}</td><td>{day.ok}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </details>
          </> : <Empty title="暂无每日数据" />}
        </section>
        <section className="panel">
          <div className="panel-header"><h2>失败分类</h2></div>
          {Object.keys(data.categories).length ? <dl className="ledger">
            {Object.entries(data.categories).map(([category, count]) => <div key={category}>
              <dt>{categoryText(category as keyof AdminStatsResponse["categories"])}</dt><dd className="numeric">{count}</dd>
            </div>)}
          </dl> : <Empty title="暂无失败记录" />}
        </section>
      </div>
    </>}
  </>;
}

export function AdminUsers({ user }: { user: UserDTO }) {
  const filters = useFilters();
  const { data, error, reload } = useResource<Page<AdminUserDTO>>("/admin/users" + filters.query("q"));
  const [updating, setUpdating] = useState<number>();
  const [mutationError, setMutationError] = useState("");
  const [confirmation, setConfirmation] = useState("");

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    filters.update("q", String(new FormData(event.currentTarget).get("q") ?? "").trim());
  }

  async function updateStatus(target: AdminUserDTO) {
    const status = target.status === "active" ? "banned" : "active";
    if (status === "banned" && !window.confirm("封禁 " + target.username + " 并撤销其会话？")) return;
    setConfirmation("");
    setMutationError("");
    setUpdating(target.id);
    try {
      await request<UserResponse>("/admin/users/" + target.id + "/status", { body: { status } });
      setConfirmation(target.username + (status === "banned" ? " 已封禁。" : " 已解除封禁。"));
      reload();
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setUpdating(undefined);
    }
  }

  const q = filters.params.get("q") ?? "";
  return <>
    <Heading description="查找站内用户及其账号状态。">用户管理</Heading>
    <section className="panel">
      <div className="panel-header">
        <h2>用户列表</h2>
        <form className="filter-group" onSubmit={search}>
          <label className="inline-field">
            <span>用户名</span>
            <input key={q} name="q" type="search" defaultValue={q} maxLength={32} />
          </label>
          <button className="button button-secondary">搜索</button>
        </form>
      </div>
      <Notice message={mutationError} />
      {confirmation && <p className="notice notice-success" role="status">{confirmation}</p>}
      <Notice message={error} reload={reload} busy={!data} />
      {data && <>
        {data.items.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="用户列表">
          <table>
            <thead><tr>
              <th scope="col">用户名</th>
              <th scope="col">角色</th>
              <th scope="col">状态</th>
              <th scope="col">任务数</th>
              <th scope="col">记录数</th>
              <th scope="col">创建时间</th>
              <th scope="col">操作</th>
            </tr></thead>
            <tbody>{data.items.map((target) => <tr key={target.id}>
              <th scope="row">{target.username}{target.id === user.id && <span className="muted">（你）</span>}</th>
              <td>{target.role === "admin" ? "管理员" : "用户"}</td>
              <td><Badge status={target.status} /></td>
              <td className="numeric">{target.taskCount}</td>
              <td className="numeric">{target.cardCount}</td>
              <td>{dateText(target.createdAt)}</td>
              <td>{target.id !== user.id && <button
                className={"button button-secondary" + (target.status === "active" ? " button-danger" : "")}
                disabled={updating !== undefined}
                onClick={() => void updateStatus(target)}
              >{updating === target.id ? "处理中…" : target.status === "active" ? "封禁" : "解除封禁"}</button>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <Empty title="没有符合条件的用户" />}
        <Pagination data={data} onPage={(page) => filters.update("page", String(page))} />
      </>}
    </section>
  </>;
}
