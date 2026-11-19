// Minimal same-origin API client for the Ortex backend. All requests include
// credentials so the session cookie is sent.

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || res.statusText);
  }
  return data as T;
}

export interface Task {
  id: string;
  objective: string;
  authorized_scope: string;
  status: string;
  paused: boolean;
  created_at: string;
}

export interface Approval {
  id: string;
  intent_id: string;
  classification: string;
  status: string;
  reason: string;
  requested_at: string;
}

export const api = {
  login: (user: string, password: string) =>
    req<{ status: string }>("POST", "/api/login", { user, password }),
  logout: () => req<{ status: string }>("POST", "/api/logout"),
  listTasks: () => req<{ tasks: Task[] }>("GET", "/api/tasks"),
  createTask: (objective: string, authorized_scope: string) =>
    req<Task>("POST", "/api/tasks", { objective, authorized_scope }),
  getTask: (id: string) =>
    req<{ task: Task; intents: unknown[] }>("GET", `/api/tasks/${id}`),
  getGraph: (id: string) =>
    req<{
      asset_graph: { nodes: unknown[]; edges: unknown[] };
      exploration_graph: { nodes: unknown[]; edges: unknown[] };
    }>("GET", `/api/tasks/${id}/graph`),
  listApprovals: (id: string) =>
    req<{ approvals: Approval[] }>("GET", `/api/tasks/${id}/approvals`),
  startTask: (id: string) => req("POST", `/api/tasks/${id}/start`),
  pauseTask: (id: string) => req("POST", `/api/tasks/${id}/pause`),
  resumeTask: (id: string) => req("POST", `/api/tasks/${id}/resume`),
  decide: (approvalId: string, decision: "approve" | "deny", reason: string) =>
    req("POST", `/api/approvals/${approvalId}`, { decision, reason }),
};
