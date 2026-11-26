import { type FormEvent, useState } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_RE } from "../shared/types";
import type { AuthConfigResponse, RegisterRequest, UserDTO, UserResponse } from "../shared/types";
import { errorMessage, request, useResource } from "./api";
import { Badge, dateText, Heading, Notice } from "./components";

export function Brand() {
  return <div className="brand"><span className="brand-mark" aria-hidden="true" />Account Checker</div>;
}

function passwordField({ label, name, current = false }: { label: string; name: string; current?: boolean }) {
  return <label className="field">
    <span>{label}</span>
    <input type="password" name={name} autoComplete={current ? "current-password" : "new-password"} required maxLength={PASSWORD_MAX}
      minLength={current ? undefined : PASSWORD_MIN} />
  </label>;
}

export function AuthForm({ register = false, user, onUser }: {
  register?: boolean;
  user: UserDTO | null;
  onUser: (user: UserDTO) => void;
}) {
  const { state } = useLocation();
  const next = typeof state?.next === "string" && /^\/(tasks|cards|account|admin)(\/|\?|#|$)/.test(state.next) ? state.next : "/tasks";
  if (user) return <Navigate to={next} replace />;
  return <main className="auth-layout">
    <div className="auth-intro">
      <Brand />
      <div>
        <p className="auth-title">任务工作台</p>
        <p className="auth-description">查看任务进度和处理记录，管理你的站内账号。</p>
      </div>
      <div className="auth-art" aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
    <section className="auth-content" aria-labelledby="auth-heading">
      <div className="auth-panel">
        <h1 id="auth-heading">{register ? "创建账号" : "登录"}</h1>
        {register ? <RegisterForm onUser={onUser} /> : <CredentialsForm onUser={onUser} />}
        <p className="auth-link">
          {register ? "已有账号？" : "还没有账号？"}
          <Link to={register ? "/login" : "/register"} state={{ next }}>{register ? "去登录" : "注册"}</Link>
        </p>
      </div>
    </section>
  </main>;
}

function RegisterForm({ onUser }: { onUser: (user: UserDTO) => void }) {
  const { data, error, reload } = useResource<AuthConfigResponse>("/auth/config");
  if (!data) return <Notice message={error} reload={reload} busy={!error} />;
  return <CredentialsForm onUser={onUser} registration={data} />;
}

function CredentialsForm({ onUser, registration }: { onUser: (user: UserDTO) => void; registration?: AuthConfigResponse }) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const fields = new FormData(event.currentTarget);
    const body: RegisterRequest = {
      username: String(fields.get("username")).trim(),
      password: String(fields.get("password")),
    };
    if (registration && !USERNAME_RE.test(body.username)) {
      setError("请输入符合格式的站内用户名。");
      return;
    }
    if (registration?.inviteRequired) body.inviteCode = String(fields.get("inviteCode"));
    setSubmitting(true);
    try {
      const { user } = await request<UserResponse>(registration ? "/auth/register" : "/auth/login", { body });
      onUser(user);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="form-stack">
    <label className="field">
      <span>站内用户名</span>
      <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required
        maxLength={32} minLength={registration ? 3 : undefined} aria-describedby={registration ? "username-hint" : undefined} />
      {registration && <small id="username-hint">3–32 个字符，可用英文字母、数字、点、下划线和连字符。</small>}
    </label>
    {passwordField({ label: "密码", name: "password", current: !registration })}
    {registration && <p className="form-hint">密码须为 {PASSWORD_MIN}–{PASSWORD_MAX} 个字符。</p>}
    {registration?.inviteRequired && <label className="field">
      <span>邀请码</span>
      <input name="inviteCode" required autoComplete="off" />
    </label>}
    <Notice message={error} />
    <button className="button button-primary" disabled={submitting}>{submitting ? "正在提交…" : registration ? "注册" : "登录"}</button>
  </form>;
}

export function AccountPage({ user }: { user: UserDTO }) {
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setError("");
    setChanged(false);
    if (fields.get("newPassword") !== fields.get("repeatPassword")) {
      setError("两次输入的新密码不同。");
      return;
    }
    setSubmitting(true);
    try {
      await request<{ ok: true }>("/auth/password", { body: {
        currentPassword: String(fields.get("currentPassword")),
        newPassword: String(fields.get("newPassword")),
      } });
      form.reset();
      setChanged(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return <>
    <Heading description="查看个人资料和更新站内密码。">我的账号</Heading>
    <div className="account-columns">
      <section className="panel">
        <div className="panel-header"><h2>账号信息</h2><Badge status={user.status} /></div>
        <dl className="ledger">
          <div><dt>用户名</dt><dd>{user.username}</dd></div>
          <div><dt>角色</dt><dd>{user.role === "admin" ? "管理员" : "用户"}</dd></div>
          <div><dt>注册时间</dt><dd>{dateText(user.createdAt)}</dd></div>
          <div><dt>上次登录</dt><dd>{dateText(user.lastLoginAt)}</dd></div>
        </dl>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>修改密码</h2></div>
        <form onSubmit={(event) => void submit(event)} className="form-stack panel-form">
          {passwordField({ label: "当前密码", name: "currentPassword", current: true })}
          {passwordField({ label: "新密码", name: "newPassword" })}
          {passwordField({ label: "确认新密码", name: "repeatPassword" })}
          <p className="form-hint">密码须为 {PASSWORD_MIN}–{PASSWORD_MAX} 个字符。修改后，其他设备需要重新登录。</p>
          <Notice message={error} />
          {changed && <p className="notice notice-success" role="status">密码已更新。</p>}
          <button className="button button-primary" disabled={submitting}>{submitting ? "正在保存…" : "保存密码"}</button>
        </form>
      </section>
    </div>
  </>;
}
