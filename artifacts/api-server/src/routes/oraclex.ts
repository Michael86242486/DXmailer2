import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";

// ─── SSE broadcast registry ───────────────────────────────────────────────────
const sseClients = new Map<string, Response>();

function broadcast(event: string, data: object) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.values()) {
    try { res.write(payload); } catch { /* ignore closed */ }
  }
}

// ─── In-memory store ──────────────────────────────────────────────────────────
interface Developer { id: number; name: string; api_key: string; status: string; created_at: number; }
interface SmtpNode { id: number; email: string; app_password: string; sender_name: string; status: string; daily_sent_count: number; max_daily_limit: number; last_used_timestamp: number; created_at: number; }
interface Email { id: number; message_id: string; transaction_id?: string; developer_id: number; subscriber_id?: string; to_address: string; template: string; sender_name?: string; data: string; status: "queued" | "processing" | "sent" | "failed"; smtp_pool_id?: number; error_message?: string; queued_at: number; sent_at?: number; }
interface Webhook { id: number; developer_id: number; url: string; events: string; status: string; created_at: number; }
interface Subscriber { id: number; developer_id: number; subscriber_id: string; email?: string; phone?: string; first_name?: string; last_name?: string; created_at: number; updated_at: number; }
interface ExecStep { id: number; email_id: number; status: string; detail: string; channel: string; created_at: number; }

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
  execDetails: new Map<number, ExecStep[]>(),
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

function addExec(emailId: number, status: string, detail: string) {
  const existing = store.execDetails.get(emailId) ?? [];
  existing.push({ id: store.execId++, email_id: emailId, status, detail, channel: "email", created_at: now() });
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

// ─── Gmail SMTP delivery via Nodemailer ───────────────────────────────────────
async function deliverEmail(
  emailId: number,
  developerId: number,
  to: string,
  template: string,
  senderName: string | undefined,
  data: Record<string, unknown>,
  messageId: string
) {
  const email = store.emails.get(emailId)!;

  // Update to processing
  email.status = "processing";
  broadcast("processing", { messageId, to, template });
  addExec(emailId, "processing", "Selecting relay node via LRU algorithm…");

  const node = selectLRU();
  if (!node) {
    email.status = "failed";
    email.error_message = "No active relay nodes with available quota";
    addExec(emailId, "failed", "No relay nodes available — all quotas exhausted");
    broadcast("failed", { messageId, to, template, reason: "no_smtp_pool", emailId });
    fireWebhooks(developerId, "failed", { messageId, reason: "no_smtp_pool" });
    return;
  }

  addExec(emailId, "processing", `Relay selected: ${node.email} (${node.daily_sent_count}/${node.max_daily_limit} used today)`);
  email.smtp_pool_id = node.id;

  const fromName = senderName || node.sender_name;
  const subject = buildSubject(template, data);
  const html = buildHtml(template, data);

  addExec(emailId, "processing", `Connecting to Gmail SMTP (${node.email}) via TLS:587…`);

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: node.email, pass: node.app_password },
      tls: { rejectUnauthorized: true },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
    });

    await transporter.sendMail({
      from: `"${fromName}" <${node.email}>`,
      to,
      subject,
      html,
      headers: {
        "X-ORACLEX-Message-ID": messageId,
        "X-ORACLEX-Template": template,
      },
    });

    // Success
    node.daily_sent_count += 1;
    node.last_used_timestamp = now();
    email.status = "sent";
    email.sent_at = now();

    addExec(emailId, "sent", `✓ Delivered via ${node.email} · Subject: "${subject}"`);
    broadcast("sent", { messageId, to, template, relay: node.email, emailId });
    fireWebhooks(developerId, "sent", { messageId, to, template, relay: node.email });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    email.status = "failed";
    email.error_message = msg.slice(0, 500);

    addExec(emailId, "failed", `SMTP error: ${msg.slice(0, 300)}`);
    broadcast("failed", { messageId, to, template, reason: msg.slice(0, 200), emailId });
    fireWebhooks(developerId, "failed", { messageId, reason: msg.slice(0, 200) });
  }
}

// ─── HTML builder ─────────────────────────────────────────────────────────────
function buildSubject(template: string, data: Record<string, unknown>): string {
  const company = (data.company as string) || "ORACLEX";
  const code = data.code as string | undefined;
  return ({
    verification: `Verify your ${company} account${code ? ` — ${code}` : ""}`,
    otp: `Your one-time password${code ? ` — ${code}` : ""}`,
    "password-reset": `Reset your ${company} password`,
    "magic-link": `Sign in to ${company}`,
  } as Record<string, string>)[template] || "Message from ORACLEX";
}

function buildHtml(template: string, data: Record<string, unknown>): string {
  const company = (data.company as string) || "ORACLEX";
  const code = data.code as string || "";
  const year = (data.date as string) || new Date().getFullYear().toString();

  const digits = code.split("").map((d: string) =>
    `<span style="display:inline-block;font-family:monospace;font-size:38px;font-weight:900;color:#4a9eff;min-width:32px;text-align:center;letter-spacing:2px;">${d}</span>`
  ).join("");

  const bodies: Record<string, string> = {
    verification: `
      <p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">Enter this code to verify your <strong style="color:#fff;">${company}</strong> account. Expires in <strong style="color:#fff;">10 minutes</strong>.</p>
      <div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;">${digits}</div>
      <p style="margin:0 0 24px;color:#666;font-size:13px;">If you didn't request this, safely ignore this email.</p>`,

    otp: `
      <p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">Your one-time password. Expires in <strong style="color:#fff;">5 minutes</strong>.</p>
      <div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;">
        <span style="font-family:monospace;font-size:42px;font-weight:900;color:#4aff7a;letter-spacing:14px;">${code}</span>
      </div>`,

    "password-reset": `
      <p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">We received a request to reset your <strong style="color:#fff;">${company}</strong> password. This link expires in <strong style="color:#fff;">30 minutes</strong>.</p>
      ${data.resetUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${String(data.resetUrl)}" style="display:inline-block;background:#ff7a4a;color:#fff;text-decoration:none;font-weight:700;padding:14px 40px;border-radius:10px;font-size:15px;">Reset Password</a></div>` : ""}
      <p style="margin:0 0 24px;color:#666;font-size:13px;">If you didn't request this, please ignore this email — your account is safe.</p>`,

    "magic-link": `
      <p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">Click the button below to sign in to <strong style="color:#fff;">${company}</strong> instantly. Link expires in <strong style="color:#fff;">15 minutes</strong>.</p>
      ${data.magicUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${String(data.magicUrl)}" style="display:inline-block;background:linear-gradient(135deg,#7928ca,#a04aff);color:#fff;text-decoration:none;font-weight:700;padding:14px 40px;border-radius:10px;font-size:15px;">Sign In Securely</a></div>` : ""}
      <p style="margin:0 0 24px;color:#666;font-size:13px;">If you didn't request this sign-in, you can safely ignore this.</p>`,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${buildSubject(template, data)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;padding:0;">
<div style="max-width:560px;margin:48px auto;background:#141414;border:1px solid #252525;border-radius:18px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:44px 40px;text-align:center;border-bottom:1px solid #1e3a5f;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#4a9eff;margin-bottom:14px;">${company}</div>
    <h1 style="font-size:24px;font-weight:700;color:#fff;margin:0;line-height:1.3;">${buildSubject(template, data)}</h1>
  </div>
  <div style="padding:44px 40px;">
    ${bodies[template] || "<p style='color:#aaa;'>Message from ORACLEX</p>"}
    <div style="background:#111;border:1px solid #1e1e1e;border-left:3px solid #e85555;border-radius:10px;padding:16px 18px;font-size:13px;color:#777;line-height:1.5;">
      🔒 This is an automated message. Please do not reply.
    </div>
  </div>
  <div style="padding:24px 40px;border-top:1px solid #1c1c1c;text-align:center;font-size:11px;color:#444;">
    &copy; ${year} ${company} · Sent via ORACLEX Mail Engine
  </div>
</div>
</body>
</html>`;
}

// ─── Auth middleware ───────────────────────────────────────────────────────────
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

// GET /api/v1/stream  — SSE real-time delivery events
// EventSource cannot send headers, so we also accept ?apiKey=
function authSse(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    const dev = authDev(header.slice(7).trim());
    if (dev) { (req as Request & { dev: Developer }).dev = dev; next(); return; }
  }
  const qk = req.query.apiKey as string | undefined;
  if (qk) {
    const dev = authDev(qk);
    if (dev) { (req as Request & { dev: Developer }).dev = dev; next(); return; }
  }
  res.status(401).json({ error: "Unauthorized" });
}

router.get("/v1/stream", authSse, (req: Request, res: Response) => {
  const clientId = randomUUID();
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, ts: Date.now() })}\n\n`);

  // Keep-alive every 20s
  const ping = setInterval(() => {
    try { res.write(`:ping\n\n`); } catch { clearInterval(ping); }
  }, 20000);

  sseClients.set(clientId, res);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(clientId);
  });
});

// POST /api/v1/email/send
router.post("/v1/email/send", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const { to, template, senderName, data } = req.body ?? {};
  if (!to || !template) { res.status(400).json({ error: "Missing required fields: to, template" }); return; }
  if (!TEMPLATES.includes(template)) {
    res.status(400).json({ error: `Unknown template: ${template}. Available: ${TEMPLATES.join(", ")}` });
    return;
  }

  const messageId = randomUUID();
  const emailId = store.emailId++;
  const email: Email = {
    id: emailId, message_id: messageId, developer_id: dev.id,
    to_address: to, template, sender_name: senderName,
    data: JSON.stringify(data ?? {}), status: "queued", queued_at: now(),
  };
  store.emails.set(emailId, email);
  addExec(emailId, "queued", `Email accepted (${to}) · template: ${template}`);
  broadcast("queued", { messageId, to, template, emailId });

  // Fire delivery async — don't block the response
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
  const data = all.slice((page - 1) * limit, page * limit).map(({ data: _d, ...e }) => ({
    ...e,
    relay_node_email: e.smtp_pool_id ? store.smtpPool.get(e.smtp_pool_id)?.email : null,
  }));
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

// GET /api/v1/webhooks
router.get("/v1/webhooks", auth, (req: Request, res: Response) => {
  const dev = (req as Request & { dev: Developer }).dev;
  const hooks = [...store.webhooks.values()].filter((h) => h.developer_id === dev.id);
  res.json(hooks);
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

// POST /api/v1/events/trigger  (Novu-style)
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
  const email: Email = {
    id: emailId, message_id: messageId, transaction_id: transactionId,
    developer_id: dev.id, subscriber_id: to.subscriberId || to.email,
    to_address: to.email, template: workflowId, data: JSON.stringify(payload ?? {}),
    status: "queued", queued_at: now(),
  };
  store.emails.set(emailId, email);
  addExec(emailId, "queued", `Workflow "${workflowId}" triggered for ${to.email}`);
  broadcast("queued", { messageId, to: to.email, template: workflowId, emailId });
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
  const sub: Subscriber = {
    id: existing?.id ?? store.subscriberId++, developer_id: dev.id,
    subscriber_id: subscriberId, email, first_name: firstName, last_name: lastName, phone,
    created_at: existing?.created_at ?? now(), updated_at: now(),
  };
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
    name: name.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
    channel: "email",
    active: true,
    description: ({
      verification: "6-digit verification code (animated digits)", otp: "One-time password (bold digits)",
      "password-reset": "Password reset link with CTA button", "magic-link": "Passwordless sign-in button",
    } as Record<string, string>)[name] || "",
  }));
  res.json({ data, total: data.length });
});

// GET /api/v1/health
router.get("/v1/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", engine: "ORACLEX Mail Engine v2", version: "2.0.0", relay_nodes: store.smtpPool.size, timestamp: Date.now() });
});

export default router;
