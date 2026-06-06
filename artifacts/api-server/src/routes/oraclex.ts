import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";

// ─── In-memory store (dev environment) ───────────────────────────────────────
interface Developer { id: number; name: string; api_key: string; status: string; created_at: number; }
interface SmtpNode { id: number; email: string; app_password: string; sender_name: string; status: string; daily_sent_count: number; max_daily_limit: number; last_used_timestamp: number; created_at: number; }
interface Email { id: number; message_id: string; transaction_id?: string; developer_id: number; subscriber_id?: string; to_address: string; template: string; sender_name?: string; data: string; status: string; smtp_pool_id?: number; error_message?: string; queued_at: number; sent_at?: number; }
interface Webhook { id: number; developer_id: number; url: string; events: string; status: string; created_at: number; }
interface Subscriber { id: number; developer_id: number; subscriber_id: string; email?: string; phone?: string; first_name?: string; last_name?: string; avatar?: string; data?: string; created_at: number; updated_at: number; }
interface ExecDetail { id: number; email_id: number; status: string; detail: string; channel: string; raw?: string; created_at: number; }

const store = {
  developers: new Map<number, Developer>([[
    1, { id: 1, name: "ORACLEX Master", api_key: "oraclex_live_test_key_xyz123", status: "active", created_at: Math.floor(Date.now() / 1000) }
  ]]),
  smtpPool: new Map<number, SmtpNode>([
    [1, { id: 1, email: "oraclex.relay01@gmail.com", app_password: "jgffyxztpedbbqxp", sender_name: "ORACLEX Relay Node 01", status: "active", daily_sent_count: 0, max_daily_limit: 500, last_used_timestamp: 0, created_at: Math.floor(Date.now() / 1000) }],
    [2, { id: 2, email: "oraclex.relay02@gmail.com", app_password: "fhlnqzrghwqfwzgb", sender_name: "ORACLEX Relay Node 02", status: "active", daily_sent_count: 0, max_daily_limit: 500, last_used_timestamp: 0, created_at: Math.floor(Date.now() / 1000) }],
  ]),
  emails: new Map<number, Email>(),
  webhooks: new Map<number, Webhook>(),
  subscribers: new Map<string, Subscriber>(),
  execDetails: new Map<number, ExecDetail[]>(),
  // counters
  emailId: 1,
  webhookId: 1,
  subscriberId: 1,
  execId: 1,
};

const TEMPLATES = ["verification", "otp", "password-reset", "magic-link"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function now() { return Math.floor(Date.now() / 1000); }

function authDev(apiKey: string): Developer | undefined {
  for (const dev of store.developers.values()) {
    if (dev.api_key === apiKey && dev.status === "active") return dev;
  }
}

function selectLRU(): SmtpNode | undefined {
  let best: SmtpNode | undefined;
  for (const node of store.smtpPool.values()) {
    if (node.status !== "active" || node.daily_sent_count >= node.max_daily_limit) continue;
    if (!best || node.last_used_timestamp < best.last_used_timestamp) best = node;
  }
  return best;
}

function addExec(emailId: number, status: string, detail: string, channel = "email") {
  const existing = store.execDetails.get(emailId) ?? [];
  existing.push({ id: store.execId++, email_id: emailId, status, detail, channel, created_at: now() });
  store.execDetails.set(emailId, existing);
}

function fireWebhooks(developerId: number, event: string, payload: object) {
  for (const hook of store.webhooks.values()) {
    if (hook.developer_id !== developerId || hook.status !== "active") continue;
    if (!hook.events.includes(event)) continue;
    fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ORACLEX-Event": event },
      body: JSON.stringify({ event, timestamp: Date.now(), ...payload }),
    }).catch(() => {});
  }
}

async function deliverEmail(emailId: number, developerId: number, to: string, template: string, senderName: string | undefined, data: Record<string, unknown>, messageId: string) {
  const node = selectLRU();
  if (!node) {
    store.emails.get(emailId)!.status = "failed";
    store.emails.get(emailId)!.error_message = "No active relay nodes with available quota";
    addExec(emailId, "failed", "No active relay nodes with available quota");
    fireWebhooks(developerId, "failed", { messageId, reason: "no_smtp_pool" });
    return;
  }

  addExec(emailId, "processing", `Relay selected: ${node.email} (${node.daily_sent_count}/${node.max_daily_limit} today)`);

  const fromName = senderName || node.sender_name || "ORACLEX Mail Engine";
  const subject = buildSubject(template, data);
  const html = buildHtml(template, data);

  try {
    const res = await fetch("https://api.mailchannels.net/tx/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-MailChannels-Spam-Classify": "true" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: node.email, name: `${fromName} via ORACLEX` },
        reply_to: { email: node.email },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });

    node.daily_sent_count += 1;
    node.last_used_timestamp = now();

    const email = store.emails.get(emailId)!;
    email.status = "sent";
    email.smtp_pool_id = node.id;
    email.sent_at = now();

    addExec(emailId, "sent", `Delivered via ${node.email} · Subject: "${subject}" · MailChannels ${res.status}`);
    fireWebhooks(developerId, "sent", { messageId, to, template, relay: node.email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const email = store.emails.get(emailId)!;
    email.status = "failed";
    email.error_message = msg.slice(0, 300);
    addExec(emailId, "failed", msg.slice(0, 300));
    fireWebhooks(developerId, "failed", { messageId, reason: msg.slice(0, 200) });
  }
}

function buildSubject(template: string, data: Record<string, unknown>): string {
  const company = (data.company as string) || "ORACLEX";
  const code = data.code as string | undefined;
  const subjects: Record<string, string> = {
    verification: `Your ${company} verification code${code ? ` — ${code}` : ""}`,
    otp: `Your one-time password${code ? ` — ${code}` : ""}`,
    "password-reset": `Reset your ${company} password`,
    "magic-link": `Sign in to ${company}`,
  };
  return subjects[template] || "Message from ORACLEX";
}

function buildHtml(template: string, data: Record<string, unknown>): string {
  const company = (data.company as string) || "ORACLEX";
  const code = data.code as string || "";
  const date = (data.date as string) || new Date().getFullYear().toString();
  const digits = code.split("").map((d: string) => `<span style="display:inline-block;font-family:monospace;font-size:36px;font-weight:800;color:#4a9eff;min-width:28px;text-align:center;">${d}</span>`).join("");

  const bodies: Record<string, string> = {
    verification: `<p style="margin-bottom:24px;color:#a0a0a0;">Enter this code to verify your ${company} account. Expires in 10 minutes.</p><div style="display:flex;flex-direction:row;flex-wrap:nowrap;background:#1a1a1a;border:1px solid #2e2e2e;border-radius:12px;padding:20px 24px;margin-bottom:24px;justify-content:center;">${digits}</div>`,
    otp: `<p style="margin-bottom:24px;color:#a0a0a0;">Your one-time password. Expires in 5 minutes.</p><div style="background:#1a1a1a;border:1px solid #2e2e2e;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;"><span style="font-family:monospace;font-size:36px;font-weight:800;color:#4aff7a;letter-spacing:12px;">${code}</span></div>`,
    "password-reset": `<p style="margin-bottom:24px;color:#a0a0a0;">We received a password reset request for your ${company} account.</p>${data.resetUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${data.resetUrl}" style="background:#ff7a4a;color:#fff;text-decoration:none;font-weight:700;padding:14px 36px;border-radius:8px;">Reset Password</a></div>` : ""}`,
    "magic-link": `<p style="margin-bottom:24px;color:#a0a0a0;">Click to sign in to ${company} instantly.</p>${data.magicUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${data.magicUrl}" style="background:linear-gradient(135deg,#7928ca,#a04aff);color:#fff;text-decoration:none;font-weight:700;padding:14px 36px;border-radius:8px;">Sign In</a></div>` : ""}`,
  };

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;padding:0;"><div style="max-width:560px;margin:48px auto;background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);padding:40px;text-align:center;border-bottom:1px solid #1e3a5f;"><div style="font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#4a9eff;margin-bottom:12px;">${company}</div><h1 style="font-size:22px;font-weight:700;color:#fff;margin:0;">${buildSubject(template, data)}</h1></div><div style="padding:40px;">${bodies[template] || "<p>Message from ORACLEX</p>"}<div style="background:#1a1a1a;border:1px solid #2a2a2a;border-left:3px solid #e85555;border-radius:8px;padding:16px;font-size:13px;color:#888;">If you did not request this, please ignore this email.</div></div><div style="padding:24px 40px;border-top:1px solid #1e1e1e;text-align:center;font-size:11px;color:#444;">&copy; ${date} ${company} · All rights reserved</div></div></body></html>`;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
function auth(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  const dev = authDev(header.slice(7).trim());
  if (!dev) { res.status(401).json({ error: "Unauthorized" }); return; }
  (req as Request & { dev: Developer }).dev = dev;
  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────
const router = Router();

// POST /api/v1/email/send
router.post("/v1/email/send", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const { to, template, senderName, data } = req.body ?? {};
  if (!to || !template) { res.status(400).json({ error: "Missing required fields: to, template" }); return; }
  if (!TEMPLATES.includes(template)) { res.status(400).json({ error: `Unknown template: ${template}. Available: ${TEMPLATES.join(", ")}` }); return; }

  const messageId = randomUUID();
  const emailId = store.emailId++;
  const email: Email = { id: emailId, message_id: messageId, developer_id: dev.id, to_address: to, template, sender_name: senderName, data: JSON.stringify(data ?? {}), status: "queued", queued_at: now() };
  store.emails.set(emailId, email);
  addExec(emailId, "queued", "Email accepted and queued for delivery");

  // Async delivery — don't await
  void deliverEmail(emailId, dev.id, to, template, senderName, data ?? {}, messageId);

  res.status(202).json({ messageId, status: "queued" });
});

// GET /api/v1/stats
router.get("/v1/stats", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  let sent = 0, failed = 0, queued = 0;
  for (const e of store.emails.values()) {
    if (e.developer_id !== dev.id) continue;
    if (e.status === "sent") sent++;
    else if (e.status === "failed") failed++;
    else if (e.status === "queued" || e.status === "processing") queued++;
  }
  const total = sent + failed;
  res.json({ sent, failed, queue: queued, success_rate: total > 0 ? parseFloat(((sent / total) * 100).toFixed(1)) : 100 });
});

// GET /api/v1/email/logs
router.get("/v1/email/logs", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const status = req.query.status as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || "20", 10)));

  let all = [...store.emails.values()].filter((e) => e.developer_id === dev.id);
  if (status) all = all.filter((e) => e.status === status);
  all.sort((a, b) => b.queued_at - a.queued_at);

  const total = all.length;
  const data = all.slice((page - 1) * limit, page * limit).map(({ data: _d, ...e }) => e);
  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// GET /api/v1/smtp/pool
router.get("/v1/smtp/pool", auth, (_req: Request, res: Response) => {
  const nodes = [...store.smtpPool.values()].map(({ app_password: _p, ...n }) => ({
    ...n,
    utilization_pct: parseFloat(((n.daily_sent_count / n.max_daily_limit) * 100).toFixed(1)),
    remaining_today: n.max_daily_limit - n.daily_sent_count,
  }));
  res.json(nodes);
});

// POST /api/v1/webhooks
router.post("/v1/webhooks", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const { url, events } = req.body ?? {};
  if (!url) { res.status(400).json({ error: "Missing required field: url" }); return; }
  try { new URL(url); } catch { res.status(400).json({ error: "Invalid URL" }); return; }
  const id = store.webhookId++;
  const hook: Webhook = { id, developer_id: dev.id, url, events: Array.isArray(events) ? events.join(",") : (events || "sent,failed"), status: "active", created_at: now() };
  store.webhooks.set(id, hook);
  res.status(201).json(hook);
});

// DELETE /api/v1/webhooks/:id
router.delete("/v1/webhooks/:id", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const id = parseInt(req.params.id, 10);
  const hook = store.webhooks.get(id);
  if (!hook || hook.developer_id !== dev.id) { res.status(404).json({ error: "Webhook not found" }); return; }
  store.webhooks.delete(id);
  res.json({ deleted: true, id });
});

// POST /api/v1/events/trigger (Novu-style)
router.post("/v1/events/trigger", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const { workflowId, to, payload } = req.body ?? {};
  if (!workflowId || !to?.email) { res.status(400).json({ error: "Missing required fields: workflowId, to.email" }); return; }
  if (!TEMPLATES.includes(workflowId)) { res.status(400).json({ error: `Unknown workflowId: ${workflowId}` }); return; }

  const subscriberKey = `${dev.id}:${to.subscriberId || to.email}`;
  if (!store.subscribers.has(subscriberKey)) {
    store.subscribers.set(subscriberKey, {
      id: store.subscriberId++, developer_id: dev.id,
      subscriber_id: to.subscriberId || to.email,
      email: to.email, first_name: to.firstName, last_name: to.lastName,
      created_at: now(), updated_at: now(),
    });
  }

  const messageId = randomUUID();
  const transactionId = randomUUID();
  const emailId = store.emailId++;
  store.emails.set(emailId, { id: emailId, message_id: messageId, transaction_id: transactionId, developer_id: dev.id, subscriber_id: to.subscriberId || to.email, to_address: to.email, template: workflowId, data: JSON.stringify(payload ?? {}), status: "queued", queued_at: now() });
  addExec(emailId, "queued", `Workflow "${workflowId}" triggered for ${to.email}`);
  void deliverEmail(emailId, dev.id, to.email, workflowId, undefined, payload ?? {}, messageId);

  res.status(201).json({ transactionId, acknowledged: true, status: [{ status: "queued" }] });
});

// GET /api/v1/subscribers
router.get("/v1/subscribers", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || "20", 10)));
  const emailQ = (req.query.email as string || "").toLowerCase();
  let all = [...store.subscribers.values()].filter((s) => s.developer_id === dev.id);
  if (emailQ) all = all.filter((s) => s.email?.toLowerCase().includes(emailQ));
  const total = all.length;
  res.json({ data: all.slice((page - 1) * limit, page * limit), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// POST /api/v1/subscribers
router.post("/v1/subscribers", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const { subscriberId, email, firstName, lastName, phone } = req.body ?? {};
  if (!subscriberId || !email) { res.status(400).json({ error: "Missing required fields: subscriberId, email" }); return; }
  const key = `${dev.id}:${subscriberId}`;
  const existing = store.subscribers.get(key);
  const sub: Subscriber = { id: existing?.id ?? store.subscriberId++, developer_id: dev.id, subscriber_id: subscriberId, email, first_name: firstName, last_name: lastName, phone, created_at: existing?.created_at ?? now(), updated_at: now() };
  store.subscribers.set(key, sub);
  res.status(200).json(sub);
});

// GET /api/v1/activity
router.get("/v1/activity", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || "20", 10)));
  const statusQ = req.query.status as string | undefined;
  const templateQ = req.query.templateId as string | undefined;
  let all = [...store.emails.values()].filter((e) => e.developer_id === dev.id);
  if (statusQ) all = all.filter((e) => e.status === statusQ);
  if (templateQ) all = all.filter((e) => e.template === templateQ);
  all.sort((a, b) => b.queued_at - a.queued_at);
  const total = all.length;
  const data = all.slice((page - 1) * limit, page * limit).map(({ data: _d, ...e }) => ({
    ...e,
    relay_node_email: e.smtp_pool_id ? store.smtpPool.get(e.smtp_pool_id)?.email : null,
  }));
  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// GET /api/v1/activity/:messageId/execution-details
router.get("/v1/activity/:messageId/execution-details", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const email = [...store.emails.values()].find((e) => e.message_id === req.params.messageId && e.developer_id === dev.id);
  if (!email) { res.status(404).json({ error: "Message not found" }); return; }
  res.json({ message: { ...email }, steps: store.execDetails.get(email.id) ?? [] });
});

// GET /api/v1/workflows
router.get("/v1/workflows", auth, (_req: Request, res: Response) => {
  const data = TEMPLATES.map((name) => ({
    workflowId: name,
    name: name.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    channel: "email",
    active: true,
    description: { verification: "6-digit verification code (mobile-safe)", otp: "One-time password", "password-reset": "Password reset link/code", "magic-link": "Passwordless magic sign-in link" }[name] || "",
  }));
  res.json({ data, total: data.length });
});

// GET /api/v1/health
router.get("/v1/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", engine: "ORACLEX Mail Engine v2", version: "2.0.0", relay_nodes: store.smtpPool.size, timestamp: Date.now() });
});

export default router;
