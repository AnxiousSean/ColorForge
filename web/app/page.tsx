"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, Task, Approval } from "./lib/api";

export default function Dashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [task, setTask] = useState<Task | null>(null);
  const [graph, setGraph] = useState<{ assets: number; assetEdges: number; exNodes: number; exEdges: number } | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [err, setErr] = useState("");

  // Create-task form.
  const [objective, setObjective] = useState("");
  const [scope, setScope] = useState("");

  const onAuthError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      window.location.href = "/login";
      return true;
    }
    return false;
  };

  const refreshTasks = useCallback(async () => {
    try {
      const { tasks } = await api.listTasks();
      setTasks(tasks || []);
    } catch (e) {
      if (!onAuthError(e)) setErr(String(e));
    }
  }, []);

  const refreshSelected = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const [t, g, a] = await Promise.all([
        api.getTask(id),
        api.getGraph(id),
        api.listApprovals(id),
      ]);
      setTask(t.task);
      setGraph({
        assets: g.asset_graph.nodes?.length || 0,
        assetEdges: g.asset_graph.edges?.length || 0,
        exNodes: g.exploration_graph.nodes?.length || 0,
        exEdges: g.exploration_graph.edges?.length || 0,
      });
      setApprovals(a.approvals || []);
    } catch (e) {
      if (!onAuthError(e)) setErr(String(e));
    }
  }, []);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  useEffect(() => {
    if (!selected) return;
    refreshSelected(selected);
    const t = setInterval(() => refreshSelected(selected), 3000);
    return () => clearInterval(t);
  }, [selected, refreshSelected]);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      const t = await api.createTask(objective, scope);
      setObjective("");
      setScope("");
      await refreshTasks();
      setSelected(t.id);
    } catch (e) {
      if (!onAuthError(e)) setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function decide(id: string, decision: "approve" | "deny") {
    try {
      await api.decide(id, decision, decision === "approve" ? "approved by operator" : "denied by operator");
      await refreshSelected(selected);
    } catch (e) {
      if (!onAuthError(e)) setErr(String(e));
    }
  }

  async function control(fn: (id: string) => Promise<unknown>) {
    try {
      await fn(selected);
      await refreshSelected(selected);
    } catch (e) {
      if (!onAuthError(e)) setErr(String(e));
    }
  }

  return (
    <div className="container">
      <header className="app">
        <h1>ORTEX</h1>
        <span className="badge">authorized lab use only</span>
        <div style={{ marginLeft: "auto" }}>
          <button className="secondary" onClick={() => api.logout().then(() => (window.location.href = "/login"))}>
            Sign out
          </button>
        </div>
      </header>

      {err && <p className="err">{err}</p>}

      <div className="grid two">
        <div className="card">
          <h2>New task</h2>
          <form onSubmit={createTask}>
            <label htmlFor="obj">Objective</label>
            <input id="obj" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. Assess lab web host 10.10.0.5" />
            <label htmlFor="scope">Authorized scope (rules of engagement)</label>
            <textarea id="scope" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Explicitly list systems you are permitted to test" />
            <div style={{ marginTop: 12 }}>
              <button type="submit">Create task</button>
            </div>
          </form>
        </div>

        <div className="card">
          <h2>Tasks</h2>
          <ul className="list">
            {tasks.length === 0 && <li className="muted">No tasks yet.</li>}
            {tasks.map((t) => (
              <li key={t.id}>
                <div className="row">
                  <a href="#" onClick={(e) => { e.preventDefault(); setSelected(t.id); }}>
                    {t.objective}
                  </a>
                  <span className="pill" style={{ marginLeft: "auto" }}>{t.status}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{t.id}</div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {task && (
        <div style={{ marginTop: 16 }} className="grid two">
          <div className="card">
            <h2>Task status</h2>
            <p style={{ marginTop: 0 }}>{task.objective}</p>
            <p className="muted" style={{ fontSize: 12 }}>Scope: {task.authorized_scope}</p>
            <div className="statline" style={{ margin: "12px 0" }}>
              <div><div className="stat">{task.status}</div><div className="muted">state</div></div>
              <div><div className="stat">{task.paused ? "yes" : "no"}</div><div className="muted">paused</div></div>
            </div>
            <div className="row">
              <button onClick={() => control(api.startTask)}>Start</button>
              <button className="secondary" onClick={() => control(api.pauseTask)}>Pause</button>
              <button className="secondary" onClick={() => control(api.resumeTask)}>Resume</button>
            </div>
          </div>

          <div className="card">
            <h2>Graph state</h2>
            {graph && (
              <div className="statline">
                <div><div className="stat">{graph.assets}</div><div className="muted">assets</div></div>
                <div><div className="stat">{graph.assetEdges}</div><div className="muted">asset edges</div></div>
                <div><div className="stat">{graph.exNodes}</div><div className="muted">exploration nodes</div></div>
                <div><div className="stat">{graph.exEdges}</div><div className="muted">exploration edges</div></div>
              </div>
            )}
          </div>

          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>Pending approvals (human-in-the-loop gate)</h2>
            <ul className="list">
              {approvals.length === 0 && <li className="muted">No actions awaiting approval.</li>}
              {approvals.map((a) => (
                <li key={a.id}>
                  <div className="row">
                    <span className="pill" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>{a.classification}</span>
                    <span>{a.reason}</span>
                    <span className="row" style={{ marginLeft: "auto", gap: 8 }}>
                      <button className="ok" onClick={() => decide(a.id, "approve")}>Approve</button>
                      <button className="danger" onClick={() => decide(a.id, "deny")}>Deny</button>
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>intent {a.intent_id}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
