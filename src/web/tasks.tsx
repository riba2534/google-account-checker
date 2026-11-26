import { Link, useParams } from "react-router";
import { CATEGORY_INFO, STATE_LABELS } from "../shared/types";
import type { CardActivityDTO, Page, TaskDTO, TaskDetailResponse } from "../shared/types";
import { useResource } from "./api";
import { Badge, categoryText, dateText, Empty, Heading, Metrics, Notice, Pagination, taskLabels, useFilters } from "./components";

const stateOptions = Object.entries(STATE_LABELS);
const taskOptions = Object.entries(taskLabels);
const categoryOptions = Object.entries(CATEGORY_INFO);

export function TaskList({ admin = false }: { admin?: boolean }) {
  const filters = useFilters();
  const { data, error, reload } = useResource<Page<TaskDTO>>((admin ? "/admin/tasks" : "/tasks") + filters.query(...(admin ? ["status"] : [])));
  return <>
    <Heading description={admin ? "查看全站任务的进度和所属用户。" : "查看你自己的任务与处理进度。"}>
      {admin ? "全站任务" : "我的任务"}
    </Heading>
    <section className="panel">
      <div className="panel-header">
        <h2>任务列表</h2>
        {admin && <label className="inline-field">
          <span>状态</span>
          <select value={filters.params.get("status") ?? ""} onChange={(event) => filters.update("status", event.target.value)}>
            <option value="">全部</option>
            {taskOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
      </div>
      <Notice message={error} reload={reload} busy={!data} />
      {data && <>
        {data.items.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="任务列表">
          <table>
            <thead><tr>
              <th scope="col">任务</th>
              {admin && <th scope="col">所属用户</th>}
              <th scope="col">模型</th>
              <th scope="col">状态</th>
              <th scope="col">已处理 / 总数</th>
              <th scope="col">创建时间</th>
            </tr></thead>
            <tbody>{data.items.map((task) => <tr key={task.id}>
              <th scope="row">{admin ? <code>{task.id}</code> : <Link to={"/tasks/" + encodeURIComponent(task.id)}><code>{task.id}</code></Link>}</th>
              {admin && <td>{task.owner?.username ?? "—"}</td>}
              <td><code>{task.model}</code></td>
              <td><Badge status={task.status} /></td>
              <td className="numeric">{task.counts.ok + task.counts.failed} / {task.total}</td>
              <td>{dateText(task.createdAt)}</td>
            </tr>)}</tbody>
          </table>
        </div> : <Empty title="没有符合条件的任务" />}
        <Pagination data={data} onPage={(page) => filters.update("page", String(page))} />
      </>}
    </section>
  </>;
}

function ActivityList({ taskId, poll }: { taskId?: string; poll?: boolean }) {
  const filters = useFilters();
  const path = taskId ? "/tasks/" + encodeURIComponent(taskId) + "/cards" : "/cards";
  const { data, error, reload } = useResource<Page<CardActivityDTO>>(path + filters.query(...(taskId ? ["state", "category"] : ["state"])), poll);

  return <section className="panel">
    <div className="panel-header">
      <h2>处理记录</h2>
      <div className="filter-group">
        <label className="inline-field">
          <span>状态</span>
          <select value={filters.params.get("state") ?? ""} onChange={(event) => filters.update("state", event.target.value)}>
            <option value="">全部</option>
            {stateOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {taskId && <label className="inline-field">
          <span>分类</span>
          <select value={filters.params.get("category") ?? ""} onChange={(event) => filters.update("category", event.target.value)}>
            <option value="">全部</option>
            {categoryOptions.map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>}
      </div>
    </div>
    <Notice message={error} reload={reload} busy={!data} />
    {data && <>
      {data.items.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="处理记录">
        <table>
          <thead><tr>
            {!taskId && <th scope="col">所属任务</th>}
            <th scope="col">序号</th>
            <th scope="col">状态</th>
            <th scope="col">失败原因</th>
            <th scope="col">创建时间</th>
            <th scope="col">完成时间</th>
          </tr></thead>
          <tbody>{data.items.map((activity) => <tr key={activity.id}>
            {!taskId && <th scope="row"><Link to={"/tasks/" + encodeURIComponent(activity.taskId)}><code>{activity.taskId}</code></Link></th>}
            <td className="numeric">{activity.idx + 1}</td>
            <td><Badge status={activity.state} /></td>
            <td>{categoryText(activity.category)}</td>
            <td>{dateText(activity.createdAt)}</td>
            <td>{dateText(activity.checkedAt)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <Empty title="没有符合条件的记录" />}
      <Pagination data={data} onPage={(page) => filters.update("page", String(page))} />
    </>}
  </section>;
}

export function ActivityPage() {
  return <>
    <Heading description="按状态查找你所有任务的处理记录。">任务记录</Heading>
    <ActivityList />
  </>;
}

const isRunning = ({ task }: TaskDetailResponse) => task.status === "running";

export function TaskDetail() {
  const { id = "" } = useParams();
  const { data, error, reload } = useResource<TaskDetailResponse>("/tasks/" + encodeURIComponent(id), isRunning);
  const task = data?.task;
  const processed = task ? task.counts.ok + task.counts.failed : 0;
  return <>
    <Heading back={<Link className="back-link" to="/tasks">← 我的任务</Link>}>任务详情</Heading>
    <Notice message={error} reload={reload} busy={!task} />
    {task && <>
      <section className="panel progress-panel">
        <div className="progress-title">
          <h2><code>{task.id}</code></h2>
          <Badge status={task.status} />
        </div>
        <dl className="summary-details">
          <div><dt>模型</dt><dd><code>{task.model}</code></dd></div>
          <div><dt>创建</dt><dd>{dateText(task.createdAt)}</dd></div>
          <div><dt>完成</dt><dd>{dateText(task.finishedAt)}</dd></div>
        </dl>
        <div className="progress-row">
          <label htmlFor="task-progress">处理进度</label>
          <span>{processed} / {task.total}</span>
        </div>
        <progress id="task-progress" value={processed} max={Math.max(1, task.total)} />
      </section>
      <Metrics values={stateOptions.map(([state, label]) => ({ label, count: task.counts[state as keyof typeof task.counts] }))} />
      <ActivityList taskId={task.id} poll={task.status === "running"} />
    </>}
  </>;
}
