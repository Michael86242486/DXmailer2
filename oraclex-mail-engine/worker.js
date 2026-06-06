/**
 * ORACLEX Mail Engine v2
 * Cloudflare Workers · Hono.js · D1 · Cloudflare Queues · MailChannels
 *
 * Architecture inspired by Novu (github.com/novuhq/novu):
 *  - Subscriber management (contact store)
 *  - Workflow / event-trigger model
 *  - Per-step execution detail tracking
 *  - Multi-channel provider abstraction (email today, SMS/push ready)
 *  - Activity feed with full audit trail
 *  - Webhook delivery on every state transition
 *
 * Original spec routes are preserved exactly.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Handlebars from 'handlebars';

import verificationTpl from './templates/verification.hbs';
import otpTpl from './templates/otp.hbs';
import passwordResetTpl from './templates/password-reset.hbs';
import magicLinkTpl from './templates/magic-link.hbs';

// ─── Constants (Novu-inspired) ────────────────────────────────────────────────
const CHANNEL = { EMAIL: 'email', SMS: 'sms', PUSH: 'push', IN_APP: 'in_app' };
const JOB_TYPE = { EMAIL_SEND: 'email_send' };
const STATUS = { QUEUED: 'queued', PROCESSING: 'processing', SENT: 'sent', FAILED: 'failed' };

// ─── Template registry ────────────────────────────────────────────────────────
const TEMPLATES = {
  verification: Handlebars.compile(verificationTpl),
  otp: Handlebars.compile(otpTpl),
  'password-reset': Handlebars.compile(passwordResetTpl),
  'magic-link': Handlebars.compile(magicLinkTpl),
};

function renderTemplate(name, data) {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Unknown template: ${name}. Available: ${Object.keys(TEMPLATES).join(', ')}`);
  // Inject per-character digits so verification.hbs can flex-render each digit
  const enriched = { ...data };
  if (data.code) {
    enriched.digits = String(data.code).split('').map((d) => ({ this: d }));
  }
  return fn(enriched);
}

function templateSubject(name, data) {
  const map = {
    verification: `Your ${data.company || 'ORACLEX'} verification code${data.code ? ` — ${data.code}` : ''}`,
    otp: `Your one-time password${data.code ? ` — ${data.code}` : ''}`,
    'password-reset': `Reset your ${data.company || 'ORACLEX'} password`,
    'magic-link': `Sign in to ${data.company || 'ORACLEX'}`,
  };
  return map[name] || 'Message from ORACLEX';
}

// ─── Auth middleware ───────────────────────────────────────────────────────────
async function authMiddleware(c, next) {
  const header = c.req.header('Authorization') || '';
  if (!header.startsWith('Bearer ')) return c.json({ error: 'Unauthorized' }, 401);
  const token = header.slice(7).trim();
  const dev = await c.env.DB.prepare(
    `SELECT * FROM developers WHERE api_key = ? AND status = 'active'`
  ).bind(token).first();
  if (!dev) return c.json({ error: 'Unauthorized' }, 401);
  c.set('developer', dev);
  await next();
}

// ─── SMTP pool — LRU selector ─────────────────────────────────────────────────
async function selectSmtpNode(db) {
  return db.prepare(
    `SELECT * FROM smtp_pool
     WHERE status = 'active' AND daily_sent_count < max_daily_limit
     ORDER BY last_used_timestamp ASC LIMIT 1`
  ).first();
}

async function markSmtpUsed(db, id) {
  return db.prepare(
    `UPDATE smtp_pool
     SET daily_sent_count = daily_sent_count + 1,
         last_used_timestamp = unixepoch('now')
     WHERE id = ?`
  ).bind(id).run();
}

// ─── MailChannels delivery ────────────────────────────────────────────────────
async function sendViaMailChannels(smtpNode, toAddress, senderName, subject, html) {
  const fromName = senderName || smtpNode.sender_name || 'ORACLEX Mail Engine';
  const payload = {
    personalizations: [{ to: [{ email: toAddress }] }],
    from: { email: smtpNode.email, name: `${fromName} via ORACLEX` },
    reply_to: { email: smtpNode.email },
    subject,
    content: [{ type: 'text/html', value: html }],
  };

  const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MailChannels-Spam-Classify': 'true',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`MailChannels ${res.status}: ${body.slice(0, 300)}`);
  }
}

// ─── Execution detail log (Novu ExecutionDetails pattern) ─────────────────────
async function addExecution(db, emailId, status, detail, channel = CHANNEL.EMAIL, raw = null) {
  await db.prepare(
    `INSERT INTO execution_details (email_id, status, detail, channel, raw, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch('now'))`
  ).bind(emailId, status, detail, channel, raw ? JSON.stringify(raw).slice(0, 1000) : null).run();
}

// ─── Webhook delivery (fire-and-forget) ──────────────────────────────────────
async function fireWebhooks(db, developerId, event, payload) {
  try {
    const { results } = await db.prepare(
      `SELECT id, url FROM webhooks
       WHERE developer_id = ? AND status = 'active' AND events LIKE ?`
    ).bind(developerId, `%${event}%`).all();
    for (const row of results) {
      fetch(row.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ORACLEX-Event': event },
        body: JSON.stringify({ event, timestamp: Date.now(), ...payload }),
      }).catch(() => {});
    }
  } catch (_) {}
}

// ─── Upsert subscriber (Novu subscriber model) ────────────────────────────────
async function upsertSubscriber(db, developerId, { subscriberId, email, phone, firstName, lastName, avatar, data }) {
  const meta = data ? JSON.stringify(data) : null;
  await db.prepare(
    `INSERT INTO subscribers (developer_id, subscriber_id, email, phone, first_name, last_name, avatar, data, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch('now'))
     ON CONFLICT(developer_id, subscriber_id) DO UPDATE SET
       email      = excluded.email,
       phone      = excluded.phone,
       first_name = excluded.first_name,
       last_name  = excluded.last_name,
       avatar     = excluded.avatar,
       data       = excluded.data,
       updated_at = unixepoch('now')`
  ).bind(developerId, subscriberId, email || null, phone || null,
         firstName || null, lastName || null, avatar || null, meta).run();
  return db.prepare(
    `SELECT * FROM subscribers WHERE developer_id = ? AND subscriber_id = ?`
  ).bind(developerId, subscriberId).first();
}

// ─── Hono app ─────────────────────────────────────────────────────────────────
const app = new Hono();
app.use('*', cors());

// ════════════════════════════════════════════════════════════════════════════════
// ORIGINAL SPEC ROUTES — preserved exactly
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/email/send
 * Validate auth → insert email row → enqueue → 202
 */
app.post('/api/v1/email/send', authMiddleware, async (c) => {
  const dev = c.get('developer');
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { to, template, senderName, data } = body;
  if (!to || !template) return c.json({ error: 'Missing required fields: to, template' }, 400);
  if (!TEMPLATES[template]) {
    return c.json({ error: `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(', ')}` }, 400);
  }

  const messageId = crypto.randomUUID();
  const dataStr = JSON.stringify(data || {});

  const ins = await c.env.DB.prepare(
    `INSERT INTO emails (message_id, developer_id, to_address, template, sender_name, data, status, queued_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', unixepoch('now'))`
  ).bind(messageId, dev.id, to, template, senderName || null, dataStr).run();

  const emailId = ins.meta.last_row_id;
  await addExecution(c.env.DB, emailId, STATUS.QUEUED, 'Email accepted and enqueued');

  await c.env.EMAIL_QUEUE.send({
    type: JOB_TYPE.EMAIL_SEND,
    messageId,
    emailId,
    developerId: dev.id,
    to,
    template,
    senderName: senderName || null,
    data: data || {},
  });

  return c.json({ messageId, status: STATUS.QUEUED }, 202);
});

/**
 * GET /api/v1/stats
 */
app.get('/api/v1/stats', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const [s, f, q] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = 'sent'`).bind(dev.id).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = 'failed'`).bind(dev.id).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = 'queued'`).bind(dev.id).first(),
  ]);
  const sent = s?.cnt ?? 0, failed = f?.cnt ?? 0, queue = q?.cnt ?? 0;
  const total = sent + failed;
  return c.json({ sent, failed, queue, success_rate: total > 0 ? parseFloat(((sent / total) * 100).toFixed(1)) : 100 });
});

/**
 * GET /api/v1/email/logs?status=queued&page=1&limit=20
 */
app.get('/api/v1/email/logs', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const status = c.req.query('status') || null;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  const base = `FROM emails WHERE developer_id = ?${status ? ` AND status = ?` : ''}`;
  const binds = status ? [dev.id, status] : [dev.id];

  const [logs, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, message_id, to_address, template, sender_name, status, error_message, queued_at, sent_at
       ${base} ORDER BY queued_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt ${base}`).bind(...binds).first(),
  ]);

  const total = cnt?.cnt ?? 0;
  return c.json({ data: logs.results, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/**
 * GET /api/v1/smtp/pool
 */
app.get('/api/v1/smtp/pool', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, sender_name, status, daily_sent_count, max_daily_limit, last_used_timestamp, created_at
     FROM smtp_pool ORDER BY id ASC`
  ).all();
  return c.json(results.map((r) => ({
    ...r,
    utilization_pct: parseFloat(((r.daily_sent_count / r.max_daily_limit) * 100).toFixed(1)),
    remaining_today: r.max_daily_limit - r.daily_sent_count,
  })));
});

/**
 * POST /api/v1/webhooks
 */
app.post('/api/v1/webhooks', authMiddleware, async (c) => {
  const dev = c.get('developer');
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { url, events } = body;
  if (!url) return c.json({ error: 'Missing required field: url' }, 400);
  try { new URL(url); } catch { return c.json({ error: 'Invalid URL' }, 400); }

  const eventsStr = Array.isArray(events) ? events.join(',') : (events || 'sent,failed');
  const res = await c.env.DB.prepare(
    `INSERT INTO webhooks (developer_id, url, events) VALUES (?, ?, ?)`
  ).bind(dev.id, url, eventsStr).run();
  const hook = await c.env.DB.prepare(`SELECT * FROM webhooks WHERE id = ?`).bind(res.meta.last_row_id).first();
  return c.json(hook, 201);
});

/**
 * DELETE /api/v1/webhooks/:id
 */
app.delete('/api/v1/webhooks/:id', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid webhook id' }, 400);
  const existing = await c.env.DB.prepare(
    `SELECT id FROM webhooks WHERE id = ? AND developer_id = ?`
  ).bind(id, dev.id).first();
  if (!existing) return c.json({ error: 'Webhook not found' }, 404);
  await c.env.DB.prepare(`DELETE FROM webhooks WHERE id = ?`).bind(id).run();
  return c.json({ deleted: true, id });
});

// ════════════════════════════════════════════════════════════════════════════════
// NOVU-INSPIRED ROUTES
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/events/trigger
 * Novu-style workflow trigger: workflowId + subscriberId + payload
 *
 * Body: { workflowId, to: { subscriberId, email, firstName }, payload }
 * Supports both simple email and subscriber-profile-aware delivery.
 */
app.post('/api/v1/events/trigger', authMiddleware, async (c) => {
  const dev = c.get('developer');
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { workflowId, to, payload } = body;
  if (!workflowId || !to) return c.json({ error: 'Missing required fields: workflowId, to' }, 400);

  // workflowId maps to a template name
  const template = workflowId;
  if (!TEMPLATES[template]) {
    return c.json({
      error: `Unknown workflowId: ${workflowId}. Available: ${Object.keys(TEMPLATES).join(', ')}`
    }, 400);
  }

  // Resolve subscriber
  const subscriberId = to.subscriberId || to.email || crypto.randomUUID();
  const toEmail = to.email;
  if (!toEmail) return c.json({ error: 'to.email is required' }, 400);

  // Upsert subscriber (Novu pattern)
  await upsertSubscriber(c.env.DB, dev.id, {
    subscriberId,
    email: toEmail,
    firstName: to.firstName || null,
    lastName: to.lastName || null,
    phone: to.phone || null,
    data: to.data || null,
  });

  const messageId = crypto.randomUUID();
  const transactionId = crypto.randomUUID();
  const dataStr = JSON.stringify(payload || {});

  const ins = await c.env.DB.prepare(
    `INSERT INTO emails
       (message_id, transaction_id, developer_id, subscriber_id, to_address, template, sender_name, data, status, queued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', unixepoch('now'))`
  ).bind(messageId, transactionId, dev.id, subscriberId, toEmail, template,
         to.firstName ? `${to.firstName}` : null, dataStr).run();

  const emailId = ins.meta.last_row_id;
  await addExecution(c.env.DB, emailId, STATUS.QUEUED, `Workflow "${workflowId}" triggered for ${toEmail}`);

  await c.env.EMAIL_QUEUE.send({
    type: JOB_TYPE.EMAIL_SEND,
    messageId,
    emailId,
    developerId: dev.id,
    to: toEmail,
    template,
    senderName: null,
    data: payload || {},
  });

  return c.json({ transactionId, acknowledged: true, status: [{ status: STATUS.QUEUED }] }, 201);
});

/**
 * GET /api/v1/subscribers
 * List all subscribers for this developer account.
 * ?page=1&limit=20&email=search
 */
app.get('/api/v1/subscribers', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const offset = (page - 1) * limit;
  const emailSearch = c.req.query('email') || null;

  let where = 'WHERE developer_id = ?';
  const binds = [dev.id];
  if (emailSearch) { where += ' AND email LIKE ?'; binds.push(`%${emailSearch}%`); }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, subscriber_id, email, phone, first_name, last_name, avatar, created_at, updated_at
       FROM subscribers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM subscribers ${where}`).bind(...binds).first(),
  ]);

  const total = cnt?.cnt ?? 0;
  return c.json({ data: rows.results, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/**
 * POST /api/v1/subscribers
 * Upsert a subscriber profile.
 * Body: { subscriberId, email, firstName, lastName, phone, avatar, data }
 */
app.post('/api/v1/subscribers', authMiddleware, async (c) => {
  const dev = c.get('developer');
  let body;
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  if (!body.subscriberId) return c.json({ error: 'Missing required field: subscriberId' }, 400);
  if (!body.email) return c.json({ error: 'Missing required field: email' }, 400);

  const sub = await upsertSubscriber(c.env.DB, dev.id, body);
  return c.json(sub, 200);
});

/**
 * GET /api/v1/subscribers/:subscriberId
 * Get a single subscriber profile + recent notification history.
 */
app.get('/api/v1/subscribers/:subscriberId', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const sid = c.req.param('subscriberId');
  const sub = await c.env.DB.prepare(
    `SELECT * FROM subscribers WHERE developer_id = ? AND subscriber_id = ?`
  ).bind(dev.id, sid).first();
  if (!sub) return c.json({ error: 'Subscriber not found' }, 404);

  const { results: history } = await c.env.DB.prepare(
    `SELECT message_id, template, status, queued_at, sent_at FROM emails
     WHERE developer_id = ? AND subscriber_id = ? ORDER BY queued_at DESC LIMIT 20`
  ).bind(dev.id, sid).all();

  return c.json({ ...sub, notification_history: history });
});

/**
 * GET /api/v1/activity
 * Full notification activity feed (Novu activity feed pattern).
 * ?page=1&limit=20&status=sent&channel=email&templateId=verification
 */
app.get('/api/v1/activity', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  const statusFilter = c.req.query('status') || null;
  const templateFilter = c.req.query('templateId') || null;

  let where = 'WHERE e.developer_id = ?';
  const binds = [dev.id];
  if (statusFilter) { where += ' AND e.status = ?'; binds.push(statusFilter); }
  if (templateFilter) { where += ' AND e.template = ?'; binds.push(templateFilter); }

  const [rows, cnt] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.id, e.message_id, e.transaction_id, e.to_address, e.template,
              e.sender_name, e.status, e.error_message, e.queued_at, e.sent_at,
              s.first_name, s.last_name, s.subscriber_id,
              sp.email as relay_node_email
       FROM emails e
       LEFT JOIN subscribers s ON s.developer_id = e.developer_id AND s.subscriber_id = e.subscriber_id
       LEFT JOIN smtp_pool sp ON sp.id = e.smtp_pool_id
       ${where}
       ORDER BY e.queued_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails e ${where}`).bind(...binds).first(),
  ]);

  const total = cnt?.cnt ?? 0;
  return c.json({ data: rows.results, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
});

/**
 * GET /api/v1/activity/:messageId/execution-details
 * Per-step execution trace (Novu ExecutionDetails pattern).
 */
app.get('/api/v1/activity/:messageId/execution-details', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const messageId = c.req.param('messageId');

  const email = await c.env.DB.prepare(
    `SELECT id, message_id, to_address, template, status FROM emails
     WHERE developer_id = ? AND message_id = ?`
  ).bind(dev.id, messageId).first();
  if (!email) return c.json({ error: 'Message not found' }, 404);

  const { results: steps } = await c.env.DB.prepare(
    `SELECT id, status, detail, channel, raw, created_at FROM execution_details
     WHERE email_id = ? ORDER BY created_at ASC`
  ).bind(email.id).all();

  return c.json({ message: email, steps });
});

/**
 * GET /api/v1/workflows
 * List all available notification workflows (templates).
 */
app.get('/api/v1/workflows', authMiddleware, async (c) => {
  const workflows = Object.keys(TEMPLATES).map((name) => ({
    workflowId: name,
    name: name.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
    channel: CHANNEL.EMAIL,
    active: true,
    description: {
      verification: 'Email with 6-digit verification code (mobile-safe wide container)',
      otp: 'Email with one-time password',
      'password-reset': 'Password reset link or code email',
      'magic-link': 'Passwordless magic sign-in link email',
    }[name] || '',
  }));
  return c.json({ data: workflows, total: workflows.length });
});

/**
 * GET /api/v1/health
 */
app.get('/api/v1/health', (c) =>
  c.json({ status: 'ok', engine: 'ORACLEX Mail Engine v2', version: '2.0.0', timestamp: Date.now() })
);

// ─── Queue consumer ───────────────────────────────────────────────────────────
async function queueHandler(batch, env) {
  for (const message of batch.messages) {
    const job = message.body;
    if (job.type !== JOB_TYPE.EMAIL_SEND) { message.ack(); continue; }

    const { messageId, emailId, developerId, to, template, senderName, data } = job;

    try {
      const smtpNode = await selectSmtpNode(env.DB);
      if (!smtpNode) {
        const err = 'No active relay nodes with available quota';
        await env.DB.prepare(
          `UPDATE emails SET status = 'failed', error_message = ? WHERE message_id = ?`
        ).bind(err, messageId).run();
        await addExecution(env.DB, emailId, STATUS.FAILED, err);
        await fireWebhooks(env.DB, developerId, 'failed', { messageId, reason: 'no_smtp_pool' });
        message.ack();
        continue;
      }

      await addExecution(env.DB, emailId, STATUS.PROCESSING,
        `Relay node selected: ${smtpNode.email} (${smtpNode.daily_sent_count}/${smtpNode.max_daily_limit} today)`);

      const html = renderTemplate(template, data);
      const subject = templateSubject(template, data);

      await sendViaMailChannels(smtpNode, to, senderName, subject, html);
      await markSmtpUsed(env.DB, smtpNode.id);

      await env.DB.prepare(
        `UPDATE emails SET status = 'sent', smtp_pool_id = ?, sent_at = unixepoch('now') WHERE message_id = ?`
      ).bind(smtpNode.id, messageId).run();

      await addExecution(env.DB, emailId, STATUS.SENT,
        `Delivered via ${smtpNode.email} through MailChannels. Subject: "${subject}"`);
      await fireWebhooks(env.DB, developerId, 'sent', { messageId, to, template, relay: smtpNode.email });
      message.ack();
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await env.DB.prepare(
        `UPDATE emails SET status = 'failed', error_message = ? WHERE message_id = ?`
      ).bind(msg, messageId).run();
      await addExecution(env.DB, emailId, STATUS.FAILED, msg);
      await fireWebhooks(env.DB, developerId, 'failed', { messageId, reason: msg.slice(0, 200) });
      message.ack();
    }
  }
}

// ─── Cron — reset daily quota at 00:00 UTC ───────────────────────────────────
async function cronHandler(event, env) {
  if (event.cron === '0 0 * * *') {
    await env.DB.prepare(
      `UPDATE smtp_pool SET daily_sent_count = 0 WHERE status != 'locked'`
    ).run();
  }
}

// ─── Worker export ────────────────────────────────────────────────────────────
export default {
  fetch: app.fetch,
  queue: queueHandler,
  scheduled: cronHandler,
};
