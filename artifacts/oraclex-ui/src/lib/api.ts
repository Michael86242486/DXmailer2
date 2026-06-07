const API_KEY = "oraclex_live_test_key_xyz123";
const BASE = "/api/v1";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(err.error ?? res.statusText), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export interface Stats {
  sent: number;
  failed: number;
  queue: number;
  success_rate: number;
}

export interface Email {
  id: number;
  message_id: string;
  transaction_id?: string;
  to_address: string;
  template: string;
  sender_name?: string;
  status: "queued" | "processing" | "sent" | "failed";
  error_message?: string;
  queued_at: number;
  sent_at?: number;
  relay_node_email?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface PagedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface SmtpNode {
  id: number;
  email: string;
  sender_name: string;
  status: string;
  daily_sent_count: number;
  max_daily_limit: number;
  last_used_timestamp: number;
  utilization_pct: number;
  remaining_today: number;
}

export interface Subscriber {
  id: number;
  subscriber_id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  created_at: number;
}

export interface Webhook {
  id: number;
  url: string;
  events: string;
  status: string;
  created_at: number;
}

export interface Workflow {
  workflowId: string;
  name: string;
  channel: string;
  active: boolean;
  description: string;
}

export interface SendEmailParams {
  to: string;
  template: string;
  senderName?: string;
  data?: Record<string, string>;
}

export interface Usage {
  emails_today: number;
  email_quota: number;
  remaining: number;
  pct_used: number;
  resets_at: string;
  tier: string;
}

export const api = {
  getStats: () => req<Stats>("/stats"),
  getUsage: () => req<Usage>("/usage"),
  getEmails: (params?: { status?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.limit) q.set("limit", String(params.limit));
    return req<PagedResponse<Email>>(`/email/logs?${q}`);
  },
  sendEmail: (body: SendEmailParams) =>
    req<{ messageId: string; status: string }>("/email/send", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSmtpPool: () => req<SmtpNode[]>("/smtp/pool"),
  getSubscribers: (params?: { page?: number; email?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.email) q.set("email", params.email);
    return req<PagedResponse<Subscriber>>(`/subscribers?${q}`);
  },
  getWebhooks: () => req<Webhook[]>("/webhooks"),
  createWebhook: (body: { url: string; events?: string }) =>
    req<Webhook>("/webhooks", { method: "POST", body: JSON.stringify(body) }),
  deleteWebhook: (id: number) =>
    req<{ deleted: boolean }>(`/webhooks/${id}`, { method: "DELETE" }),
  getWorkflows: () => req<{ data: Workflow[]; total: number }>("/workflows"),
  getActivity: (params?: { status?: string; templateId?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.templateId) q.set("templateId", params.templateId);
    if (params?.page) q.set("page", String(params.page));
    return req<PagedResponse<Email>>(`/activity?${q}`);
  },
  getExecution: (messageId: string) =>
    req<{ message: Email; steps: Array<{ status: string; detail: string; created_at: number }> }>(
      `/activity/${messageId}/execution-details`
    ),
};
