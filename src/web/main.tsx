import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router";
import type { UserDTO, UserResponse } from "../shared/types";
import { AdminOverview, AdminUsers } from "./admin";
import { errorMessage, RequestError, request, SESSION_ENDED } from "./api";
import { AccountPage, AuthForm, Brand } from "./auth";
import { Heading, Notice } from "./components";
import { ActivityPage, TaskDetail, TaskList } from "./tasks";
import "./styles.css";

const userNav = [
  { path: "/tasks", label: "我的任务", mark: "▤" },
  { path: "/cards", label: "任务记录", mark: "▦" },
  { path: "/account", label: "我的账号", mark: "◉" },
];
const adminNav = [
  { path: "/admin", label: "管理概览", mark: "◫", end: true },
  { path: "/admin/users", label: "用户管理", mark: "◎" },
  { path: "/admin/tasks", label: "全站任务", mark: "☷" },
];

function NavItems({ items }: { items: { path: string; label: string; mark: string; end?: boolean }[] }) {
  return items.map(({ path, label, mark, end }) => <NavLink className="nav-item" key={path} to={path} end={end}>
    <span className="nav-mark" aria-hidden="true">{mark}</span>
    <span>{label}</span>
  </NavLink>);
}

function DashboardLayout({ user, onLogout }: { user: UserDTO; onLogout: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await request<{ ok: true }>("/auth/logout", { body: {} });
      onLogout();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="workspace">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <header className="topbar">
      <Link className="home-link" to="/tasks" aria-label="Account Checker 首页"><Brand /></Link>
      <div className="identity">
        <Link to="/account" className="identity-link">
          <span className="avatar" aria-hidden="true">{user.username[0]?.toUpperCase()}</span>
          <span className="identity-name">{user.username}</span>
        </Link>
        <button className="button button-secondary" onClick={() => void logout()} disabled={busy}>{busy ? "正在退出…" : "退出登录"}</button>
      </div>
    </header>
    <aside className="sidebar">
      <nav aria-label="工作台">
        <h2>工作台</h2>
        <div className="nav-items"><NavItems items={userNav} /></div>
      </nav>
      {user.role === "admin" && <nav aria-label="站点管理">
        <h2>站点管理</h2>
        <div className="nav-items"><NavItems items={adminNav} /></div>
      </nav>}
    </aside>
    <main id="main-content" tabIndex={-1} className="content">
      <Notice message={error} />
      <Outlet />
    </main>
  </div>;
}

function RequireSession({ user, onLogout }: { user: UserDTO | null; onLogout: () => void }) {
  const { pathname, search, hash } = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ next: pathname + search + hash }} />;
  return <DashboardLayout user={user} onLogout={onLogout} />;
}

function MissingPage() {
  return <>
    <Heading>页面不存在</Heading>
    <Link className="back-link" to="/tasks">← 返回我的任务</Link>
  </>;
}

function App() {
  const [session, setSession] = useState<UserDTO | null>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    function endSession() { setSession(null); }
    window.addEventListener(SESSION_ENDED, endSession);
    request<UserResponse>("/auth/me", { signal: controller.signal }).then(
      ({ user }) => { if (!controller.signal.aborted) setSession(user); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof RequestError && (error.status === 401 || error.status === 403)) setSession(null);
        else setError(errorMessage(error));
      },
    );
    return () => {
      window.removeEventListener(SESSION_ENDED, endSession);
      controller.abort();
    };
  }, [attempt]);

  if (session === undefined) return <main className="app-loading">
    <Brand />
    <Notice message={error} busy={!error} reload={() => { setError(""); setAttempt((n) => n + 1); }} />
  </main>;

  return <Routes>
    <Route path="/login" element={<AuthForm user={session} onUser={setSession} />} />
    <Route path="/register" element={<AuthForm register user={session} onUser={setSession} />} />
    <Route element={<RequireSession user={session} onLogout={() => setSession(null)} />}>
      <Route index element={<Navigate to="/tasks" replace />} />
      <Route path="/tasks" element={<TaskList />} />
      <Route path="/tasks/:id" element={<TaskDetail />} />
      <Route path="/cards" element={<ActivityPage />} />
      {session && <Route path="/account" element={<AccountPage user={session} />} />}
      {session?.role === "admin" && <>
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/users" element={<AdminUsers user={session} />} />
        <Route path="/admin/tasks" element={<TaskList admin />} />
      </>}
      <Route path="*" element={<MissingPage />} />
    </Route>
  </Routes>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>,
);
