import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import {
  smtpPoolTable, oraplexEmailsTable, execStepsTable,
  webhooksTable, subscribersTable, apiKeysTable, usersTable,
} from "@workspace/db";
import { eq, and, lt, asc, desc, ilike, sql } from "drizzle-orm";
import { hashApiKey } from "../lib/auth.js";

// ─── SSE broadcast (in-memory is fine for real-time) ─────────────────────────
const sseClients = new Map<string, Response>();
function broadcast(event: string, data: object) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients.values()) {
    try { res.write(payload); } catch { /* ignore */ }
  }
}

const TEMPLATES = ["verification", "otp", "password-reset", "magic-link"];

function now() { return Math.floor(Date.now() / 1000); }

// ─── DB auth middleware — checks API key against api_keys table ───────────────
async function authMiddleware(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization || "";
  const qk = req.query.apiKey as string | undefined;
  const rawKey = header.startsWith("Bearer ") ? header.slice(7).trim() : qk?.trim();
  if (!rawKey) { res.status(401).json({ error: "Unauthorized" }); return; }

  const keyHash = hashApiKey(rawKey);
  const keys = await db.select().from(apiKeysTable)
    .where(and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.isActive, true)))
    .limit(1);

  if (!keys.length) { res.status(401).json({ error: "Invalid API key" }); return; }

  // Update last_used_at async (don't block)
  void db.update(apiKeysTable).set({ lastUsedAt: now() }).where(eq(apiKeysTable.id, keys[0].id));

  (req as Request & { userId: number }).userId = keys[0].userId;
  next();
}

// ─── Flexible auth: API key OR internal X-Internal-User-Id header (Telegram bot) ──
async function authMiddlewareFlexible(req: Request, res: Response, next: () => void) {
  // Internal bypass from Telegram bot's /send playground
  const internalUserId = req.headers["x-internal-user-id"] as string | undefined;
  if (internalUserId) {
    const uid = parseInt(internalUserId, 10);
    if (!isNaN(uid) && uid > 0) {
      // Verify the user exists and is verified
      const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, uid)).limit(1);
      if (users.length) { (req as Request & { userId: number }).userId = uid; next(); return; }
    }
    res.status(401).json({ error: "Invalid internal user" }); return;
  }
  // Fall back to standard API key auth
  await authMiddleware(req, res, next);
}

// ─── LRU smtp node selection ──────────────────────────────────────────────────
async function selectLRU() {
  const nodes = await db.select().from(smtpPoolTable)
    .where(and(eq(smtpPoolTable.status, "active"), lt(smtpPoolTable.dailySentCount, smtpPoolTable.maxDailyLimit)))
    .orderBy(asc(smtpPoolTable.lastUsedTimestamp))
    .limit(1);
  return nodes[0] ?? null;
}

async function addExec(emailId: number, status: string, detail: string) {
  await db.insert(execStepsTable).values({ emailId, status, detail, channel: "email", createdAt: now() });
}

async function fireWebhooks(userId: number, event: string, payload: object) {
  const hooks = await db.select().from(webhooksTable)
    .where(and(eq(webhooksTable.userId, userId), eq(webhooksTable.status, "active")));
  for (const hook of hooks) {
    if (!hook.events.includes(event)) continue;
    fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-ORACLEX-Event": event },
      body: JSON.stringify({ event, timestamp: Date.now(), ...payload }),
    }).catch(() => {});
  }
}

// ─── Gmail SMTP delivery ──────────────────────────────────────────────────────
async function deliverEmail(
  emailId: number, userId: number, to: string, template: string,
  senderName: string | undefined, data: Record<string, unknown>, messageId: string
) {
  await db.update(oraplexEmailsTable).set({ status: "processing" }).where(eq(oraplexEmailsTable.id, emailId));
  broadcast("processing", { messageId, to, template });
  await addExec(emailId, "processing", "Selecting relay node via LRU algorithm…");

  const node = await selectLRU();
  if (!node) {
    await db.update(oraplexEmailsTable).set({ status: "failed", errorMessage: "No relay nodes available" }).where(eq(oraplexEmailsTable.id, emailId));
    await addExec(emailId, "failed", "No active relay nodes with available quota");
    broadcast("failed", { messageId, to, template, reason: "no_smtp_pool", emailId });
    fireWebhooks(userId, "failed", { messageId, reason: "no_smtp_pool" });
    return;
  }

  await addExec(emailId, "processing", `Relay selected: ${node.email} (${node.dailySentCount}/${node.maxDailyLimit} used today)`);
  await db.update(oraplexEmailsTable).set({ smtpPoolId: node.id }).where(eq(oraplexEmailsTable.id, emailId));

  const fromName = senderName || node.senderName;
  const subject = buildSubject(template, data);
  const html = buildHtml(template, data);

  await addExec(emailId, "processing", `Connecting to Gmail SMTP (${node.email}) via TLS:587…`);

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: node.email, pass: node.appPassword },
      tls: { rejectUnauthorized: true },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
    });

    const domain = node.email.split("@")[1] ?? "gmail.com";
    const rfcMessageId = `<${messageId}@${domain}>`;
    const textBody = buildText(template, data);
    await transporter.sendMail({
      from: `"${fromName}" <${node.email}>`,
      replyTo: `"${fromName}" <noreply@${domain}>`,
      to,
      subject,
      html,
      text: textBody,
      messageId: rfcMessageId,
      headers: {
        "Precedence": "transactional",
        "X-Mailer": "ORACLEX Mail Engine v2",
        "X-Entity-Ref-ID": messageId,
        "X-ORACLEX-Template": template,
        "List-Unsubscribe": `<mailto:unsubscribe@${domain}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });

    await db.update(smtpPoolTable).set({ dailySentCount: node.dailySentCount + 1, lastUsedTimestamp: now() }).where(eq(smtpPoolTable.id, node.id));
    await db.update(oraplexEmailsTable).set({ status: "sent", sentAt: now() }).where(eq(oraplexEmailsTable.id, emailId));
    await addExec(emailId, "sent", `✓ Delivered via ${node.email} · Subject: "${subject}"`);
    broadcast("sent", { messageId, to, template, relay: node.email, emailId });
    fireWebhooks(userId, "sent", { messageId, to, template, relay: node.email });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(oraplexEmailsTable).set({ status: "failed", errorMessage: msg.slice(0, 500) }).where(eq(oraplexEmailsTable.id, emailId));
    await addExec(emailId, "failed", `SMTP error: ${msg.slice(0, 300)}`);
    broadcast("failed", { messageId, to, template, reason: msg.slice(0, 200), emailId });
    fireWebhooks(userId, "failed", { messageId, reason: msg.slice(0, 200) });
  }
}

// ─── Plain-text builder (critical for deliverability / spam avoidance) ────────
function buildText(template: string, data: Record<string, unknown>): string {
  const company = (data.company as string) || "ORACLEX";
  const code = data.code as string | undefined;
  const texts: Record<string, string> = {
    verification: `Verify your ${company} account\n\nYour verification code: ${code ?? ""}\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.\n\n--\nSent by ORACLEX Mail Engine`,
    otp: `Your one-time password\n\n${code ?? ""}\n\nThis code expires in 5 minutes.\n\n--\nSent by ORACLEX Mail Engine`,
    "password-reset": `Reset your ${company} password\n\nReset link: ${data.resetUrl ?? "(see HTML version)"}\n\n--\nSent by ORACLEX Mail Engine`,
    "magic-link": `Sign in to ${company}\n\nSign-in link: ${data.magicUrl ?? "(see HTML version)"}\n\nThis link expires in 15 minutes.\n\n--\nSent by ORACLEX Mail Engine`,
  };
  return texts[template] ?? "Message from ORACLEX";
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
    `<span style="display:inline-block;font-family:monospace;font-size:38px;font-weight:900;color:#4a9eff;min-width:32px;text-align:center;">${d}</span>`
  ).join("");

  const bodies: Record<string, string> = {
    verification: `<p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">Enter this code to verify your <strong style="color:#fff;">${company}</strong> account. Expires in <strong style="color:#fff;">10 minutes</strong>.</p><div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;">${digits}</div>`,
    otp: `<p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">Your one-time password. Expires in <strong style="color:#fff;">5 minutes</strong>.</p><div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;"><span style="font-family:monospace;font-size:42px;font-weight:900;color:#4aff7a;letter-spacing:14px;">${code}</span></div>`,
    "password-reset": `<p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">We received a request to reset your <strong style="color:#fff;">${company}</strong> password.</p>${data.resetUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${String(data.resetUrl)}" style="display:inline-block;background:#ff7a4a;color:#fff;text-decoration:none;font-weight:700;padding:14px 40px;border-radius:10px;font-size:15px;">Reset Password</a></div>` : ""}`,
    "magic-link": `<p style="margin:0 0 20px;color:#aaa;font-size:15px;line-height:1.6;">Click below to sign in to <strong style="color:#fff;">${company}</strong> instantly.</p>${data.magicUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${String(data.magicUrl)}" style="display:inline-block;background:linear-gradient(135deg,#7928ca,#a04aff);color:#fff;text-decoration:none;font-weight:700;padding:14px 40px;border-radius:10px;font-size:15px;">Sign In Securely</a></div>` : ""}`,
  };

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;padding:0;"><div style="max-width:560px;margin:48px auto;background:#141414;border:1px solid #252525;border-radius:18px;overflow:hidden;"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);padding:44px 40px;text-align:center;border-bottom:1px solid #1e3a5f;"><div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#4a9eff;margin-bottom:14px;">${company}</div><h1 style="font-size:24px;font-weight:700;color:#fff;margin:0;">${buildSubject(template, data)}</h1></div><div style="padding:44px 40px;">${bodies[template] || "<p>Message from ORACLEX</p>"}<div style="background:#111;border:1px solid #1e1e1e;border-left:3px solid #e85555;border-radius:10px;padding:16px;font-size:13px;color:#777;">🔒 Automated message. Do not reply.</div></div><div style="padding:24px 40px;border-top:1px solid #1c1c1c;text-align:center;font-size:11px;color:#444;">&copy; ${year} ${company} · Sent via ORACLEX Mail Engine</div></div></body></html>`;
}

// ─── Seed relay nodes on startup ──────────────────────────────────────────────
export async function seedRelayNodes() {
  const nodes = [
    { email: "oraclex.relay01@gmail.com", appPassword: "jgffyxztpedbbqxp", senderName: "ORACLEX Relay Node 01" },
    { email: "oraclex.relay02@gmail.com", appPassword: "fhlnqzrghwqfwzgb", senderName: "ORACLEX Relay Node 02" },
  ];
  for (const n of nodes) {
    await db.insert(smtpPoolTable).values({
      email: n.email, appPassword: n.appPassword, senderName: n.senderName,
      status: "active", dailySentCount: 0, maxDailyLimit: 500, lastUsedTimestamp: 0, createdAt: now(),
    }).onConflictDoNothing();
  }
}

// ─── Router ───────────────────────────────────────────────────────────────────
const router = Router();

// GET /api/v1/stream — SSE
function authSse(req: Request, res: Response, next: () => void) {
  void (async () => {
    const header = req.headers.authorization || "";
    const qk = req.query.apiKey as string | undefined;
    const rawKey = header.startsWith("Bearer ") ? header.slice(7).trim() : qk?.trim();
    if (!rawKey) { res.status(401).json({ error: "Unauthorized" }); return; }
    const keyHash = hashApiKey(rawKey);
    const keys = await db.select().from(apiKeysTable)
      .where(and(eq(apiKeysTable.keyHash, keyHash), eq(apiKeysTable.isActive, true))).limit(1);
    if (!keys.length) { res.status(401).json({ error: "Unauthorized" }); return; }
    (req as Request & { userId: number }).userId = keys[0].userId;
    next();
  })();
}

router.get("/v1/stream", authSse, (req: Request, res: Response) => {
  const clientId = randomUUID();
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, ts: Date.now() })}\n\n`);
  const ping = setInterval(() => { try { res.write(`:ping\n\n`); } catch { clearInterval(ping); } }, 20000);
  sseClients.set(clientId, res);
  req.on("close", () => { clearInterval(ping); sseClients.delete(clientId); });
});

// POST /api/v1/email/send
router.post("/v1/email/send", (req, res, next) => { void authMiddlewareFlexible(req, res, next); }, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const { to, template, senderName, data } = req.body ?? {};
  if (!to || !template) { res.status(400).json({ error: "Missing required fields: to, template" }); return; }
  if (!TEMPLATES.includes(template)) { res.status(400).json({ error: `Unknown template. Available: ${TEMPLATES.join(", ")}` }); return; }

  const messageId = randomUUID();
  void (async () => {
    // ── Rate limiting: check daily quota ─────────────────────────────────────
    const users = await db.select({ emailQuota: usersTable.emailQuota }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const quota = users[0]?.emailQuota ?? 100;
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(oraplexEmailsTable)
      .where(and(eq(oraplexEmailsTable.userId, userId), sql`queued_at >= ${startOfDay}`));
    if ((cnt ?? 0) >= quota) {
      res.status(429).json({ error: "Daily email quota exceeded", quota, used: cnt, resets_at: "midnight UTC" });
      return;
    }

    const [inserted] = await db.insert(oraplexEmailsTable).values({
      messageId, userId, toAddress: to, template, senderName, data: JSON.stringify(data ?? {}),
      status: "queued", queuedAt: now(),
    }).returning();
    await addExec(inserted.id, "queued", `Email accepted (${to}) · template: ${template}`);
    broadcast("queued", { messageId, to, template, emailId: inserted.id });
    void deliverEmail(inserted.id, userId, to, template, senderName, data ?? {}, messageId);

    res.status(202).json({ messageId, status: "queued" });
  })();
});

// GET /api/v1/usage
router.get("/v1/usage", (req, res, next) => { void authMiddlewareFlexible(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const users = await db.select({ emailQuota: usersTable.emailQuota, tier: usersTable.tier }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const quota = users[0]?.emailQuota ?? 100;
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(oraplexEmailsTable)
    .where(and(eq(oraplexEmailsTable.userId, userId), sql`queued_at >= ${startOfDay}`));
  const used = cnt ?? 0;
  const remaining = Math.max(0, quota - used);
  const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
  res.json({ emails_today: used, email_quota: quota, remaining, pct_used: parseFloat(((used / quota) * 100).toFixed(1)), resets_at: tomorrow.toISOString(), tier: users[0]?.tier ?? "free" });
});

// GET /api/v1/stats
router.get("/v1/stats", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const rows = await db.select({ status: oraplexEmailsTable.status, cnt: sql<number>`count(*)::int` })
    .from(oraplexEmailsTable).where(eq(oraplexEmailsTable.userId, userId))
    .groupBy(oraplexEmailsTable.status);
  let sent = 0, failed = 0, queue = 0;
  for (const r of rows) {
    if (r.status === "sent") sent = r.cnt;
    else if (r.status === "failed") failed = r.cnt;
    else if (r.status === "queued" || r.status === "processing") queue += r.cnt;
  }
  const total = sent + failed;
  res.json({ sent, failed, queue, success_rate: total > 0 ? parseFloat(((sent / total) * 100).toFixed(1)) : 100 });
});

// GET /api/v1/email/logs
router.get("/v1/email/logs", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const status = req.query.status as string | undefined;
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query.limit as string || "20", 10));
  const offset = (page - 1) * limit;

  let q = db.select().from(oraplexEmailsTable).where(
    status ? and(eq(oraplexEmailsTable.userId, userId), eq(oraplexEmailsTable.status, status)) : eq(oraplexEmailsTable.userId, userId)
  );

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(oraplexEmailsTable).where(
    status ? and(eq(oraplexEmailsTable.userId, userId), eq(oraplexEmailsTable.status, status)) : eq(oraplexEmailsTable.userId, userId)
  );

  const rows = await db.select().from(oraplexEmailsTable).where(
    status ? and(eq(oraplexEmailsTable.userId, userId), eq(oraplexEmailsTable.status, status)) : eq(oraplexEmailsTable.userId, userId)
  ).orderBy(desc(oraplexEmailsTable.queuedAt)).limit(limit).offset(offset);

  // Get relay emails for pool nodes referenced
  const poolIds = [...new Set(rows.filter((r) => r.smtpPoolId).map((r) => r.smtpPoolId!))];
  const relayMap = new Map<number, string>();
  if (poolIds.length) {
    const nodes = await db.select({ id: smtpPoolTable.id, email: smtpPoolTable.email }).from(smtpPoolTable);
    for (const n of nodes) relayMap.set(n.id, n.email);
  }

  const data = rows.map(({ data: _d, ...e }) => ({
    id: e.id, message_id: e.messageId, to_address: e.toAddress, template: e.template,
    status: e.status, smtp_pool_id: e.smtpPoolId, error_message: e.errorMessage,
    queued_at: e.queuedAt, sent_at: e.sentAt,
    relay_node_email: e.smtpPoolId ? (relayMap.get(e.smtpPoolId) ?? null) : null,
  }));

  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// GET /api/v1/smtp/pool
router.get("/v1/smtp/pool", (req, res, next) => { void authMiddleware(req, res, next); }, async (_req: Request, res: Response) => {
  const nodes = await db.select().from(smtpPoolTable);
  res.json(nodes.map(({ appPassword: _p, ...n }) => ({
    id: n.id, email: n.email, sender_name: n.senderName, status: n.status,
    daily_sent_count: n.dailySentCount, max_daily_limit: n.maxDailyLimit,
    last_used_timestamp: n.lastUsedTimestamp,
    utilization_pct: parseFloat(((n.dailySentCount / n.maxDailyLimit) * 100).toFixed(1)),
    remaining_today: n.maxDailyLimit - n.dailySentCount,
  })));
});

// GET /api/v1/webhooks
router.get("/v1/webhooks", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const hooks = await db.select().from(webhooksTable).where(eq(webhooksTable.userId, userId));
  res.json(hooks.map((h) => ({ id: h.id, url: h.url, events: h.events, status: h.status, created_at: h.createdAt })));
});

// POST /api/v1/webhooks
router.post("/v1/webhooks", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const { url, events } = req.body ?? {};
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  try { new URL(url); } catch { res.status(400).json({ error: "Invalid URL" }); return; }
  const [hook] = await db.insert(webhooksTable).values({
    userId, url, events: Array.isArray(events) ? events.join(",") : (events || "sent,failed"), status: "active", createdAt: now(),
  }).returning();
  res.status(201).json({ id: hook.id, url: hook.url, events: hook.events, status: hook.status, created_at: hook.createdAt });
});

// DELETE /api/v1/webhooks/:id
router.delete("/v1/webhooks/:id", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const id = parseInt(req.params.id as string, 10);
  const [deleted] = await db.delete(webhooksTable).where(and(eq(webhooksTable.id, id), eq(webhooksTable.userId, userId))).returning();
  if (!deleted) { res.status(404).json({ error: "Webhook not found" }); return; }
  res.json({ deleted: true, id });
});

// GET /api/v1/subscribers
router.get("/v1/subscribers", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query.limit as string || "20", 10));
  const emailQ = req.query.email as string | undefined;

  const where = emailQ
    ? and(eq(subscribersTable.userId, userId), ilike(subscribersTable.email, `%${emailQ}%`))
    : eq(subscribersTable.userId, userId);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(subscribersTable).where(where);
  const rows = await db.select().from(subscribersTable).where(where).orderBy(desc(subscribersTable.createdAt)).limit(limit).offset((page - 1) * limit);

  res.json({ data: rows.map((s) => ({ id: s.id, subscriber_id: s.subscriberId, email: s.email, first_name: s.firstName, last_name: s.lastName, phone: s.phone, created_at: s.createdAt })), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// POST /api/v1/subscribers
router.post("/v1/subscribers", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const { subscriberId, email, firstName, lastName, phone } = req.body ?? {};
  if (!subscriberId || !email) { res.status(400).json({ error: "subscriberId and email are required" }); return; }
  const [sub] = await db.insert(subscribersTable).values({
    userId, subscriberId, email, firstName, lastName, phone, data: "{}", createdAt: now(), updatedAt: now(),
  }).onConflictDoNothing().returning();
  res.status(200).json(sub ?? { subscriberId, email });
});

// POST /api/v1/events/trigger
router.post("/v1/events/trigger", (req, res, next) => { void authMiddleware(req, res, next); }, (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const { workflowId, to, payload } = req.body ?? {};
  if (!workflowId || !to?.email) { res.status(400).json({ error: "workflowId and to.email are required" }); return; }
  if (!TEMPLATES.includes(workflowId)) { res.status(400).json({ error: `Unknown workflowId: ${workflowId}` }); return; }

  const messageId = randomUUID();
  const transactionId = randomUUID();

  void (async () => {
    // Upsert subscriber
    await db.insert(subscribersTable).values({
      userId, subscriberId: to.subscriberId || to.email, email: to.email,
      firstName: to.firstName, lastName: to.lastName, data: "{}", createdAt: now(), updatedAt: now(),
    }).onConflictDoNothing();

    const [inserted] = await db.insert(oraplexEmailsTable).values({
      messageId, transactionId, userId, subscriberId: to.subscriberId || to.email,
      toAddress: to.email, template: workflowId, data: JSON.stringify(payload ?? {}), status: "queued", queuedAt: now(),
    }).returning();

    await addExec(inserted.id, "queued", `Workflow "${workflowId}" triggered for ${to.email}`);
    broadcast("queued", { messageId, to: to.email, template: workflowId, emailId: inserted.id });
    void deliverEmail(inserted.id, userId, to.email, workflowId, undefined, payload ?? {}, messageId);
  })();

  res.status(201).json({ transactionId, acknowledged: true, status: [{ status: "queued" }] });
});

// GET /api/v1/activity
router.get("/v1/activity", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const page = Math.max(1, parseInt(req.query.page as string || "1", 10));
  const limit = Math.min(100, parseInt(req.query.limit as string || "20", 10));
  const statusQ = req.query.status as string | undefined;
  const templateQ = req.query.templateId as string | undefined;

  const conditions = [eq(oraplexEmailsTable.userId, userId), ...(statusQ ? [eq(oraplexEmailsTable.status, statusQ)] : []), ...(templateQ ? [eq(oraplexEmailsTable.template, templateQ)] : [])];
  const where = conditions.length === 1 ? conditions[0] : and(...conditions as [typeof conditions[0], typeof conditions[0]]);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(oraplexEmailsTable).where(where);
  const rows = await db.select().from(oraplexEmailsTable).where(where).orderBy(desc(oraplexEmailsTable.queuedAt)).limit(limit).offset((page - 1) * limit);

  const poolIds = [...new Set(rows.filter((r) => r.smtpPoolId).map((r) => r.smtpPoolId!))];
  const relayMap = new Map<number, string>();
  if (poolIds.length) {
    const nodes = await db.select({ id: smtpPoolTable.id, email: smtpPoolTable.email }).from(smtpPoolTable);
    for (const n of nodes) relayMap.set(n.id, n.email);
  }

  const data = rows.map(({ data: _d, ...e }) => ({
    id: e.id, message_id: e.messageId, to_address: e.toAddress, template: e.template,
    status: e.status, queued_at: e.queuedAt, sent_at: e.sentAt, error_message: e.errorMessage,
    relay_node_email: e.smtpPoolId ? (relayMap.get(e.smtpPoolId) ?? null) : null,
  }));

  res.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

// GET /api/v1/activity/:messageId/execution-details
router.get("/v1/activity/:messageId/execution-details", (req, res, next) => { void authMiddleware(req, res, next); }, async (req: Request, res: Response) => {
  const userId = (req as Request & { userId: number }).userId;
  const emails = await db.select().from(oraplexEmailsTable)
    .where(and(eq(oraplexEmailsTable.messageId, req.params.messageId as string), eq(oraplexEmailsTable.userId, userId))).limit(1);
  if (!emails.length) { res.status(404).json({ error: "Message not found" }); return; }
  const email = emails[0];
  const steps = await db.select().from(execStepsTable).where(eq(execStepsTable.emailId, email.id)).orderBy(asc(execStepsTable.createdAt));
  res.json({ message: { id: email.id, message_id: email.messageId, to_address: email.toAddress, template: email.template, status: email.status, queued_at: email.queuedAt, sent_at: email.sentAt, error_message: email.errorMessage }, steps: steps.map((s) => ({ status: s.status, detail: s.detail, created_at: s.createdAt })) });
});

// GET /api/v1/workflows
router.get("/v1/workflows", (req, res, next) => { void authMiddleware(req, res, next); }, (_req: Request, res: Response) => {
  res.json({ data: TEMPLATES.map((name) => ({ workflowId: name, name: name.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()), channel: "email", active: true })), total: TEMPLATES.length });
});

// GET /api/v1/health
router.get("/v1/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", engine: "ORACLEX Mail Engine v2", version: "2.0.0", timestamp: Date.now() });
});

export default router;
