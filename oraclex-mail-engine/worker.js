import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Handlebars from 'handlebars';

import verificationTpl from './templates/verification.hbs';
import otpTpl from './templates/otp.hbs';
import passwordResetTpl from './templates/password-reset.hbs';
import magicLinkTpl from './templates/magic-link.hbs';

// ─── Template registry ────────────────────────────────────────────────────────
const TEMPLATES = {
  verification: Handlebars.compile(verificationTpl),
  otp: Handlebars.compile(otpTpl),
  'password-reset': Handlebars.compile(passwordResetTpl),
  'magic-link': Handlebars.compile(magicLinkTpl),
};

// ─── Crypto helpers ───────────────────────────────────────────────────────────
function generateUUID() {
  return crypto.randomUUID();
}

// ─── Auth middleware ───────────────────────────────────────────────────────────
async function authMiddleware(c, next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7).trim();
  const dev = await c.env.DB.prepare(
    'SELECT * FROM developers WHERE api_key = ? AND status = ?'
  ).bind(token, 'active').first();

  if (!dev) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('developer', dev);
  await next();
}

// ─── LRU SMTP pool selector ───────────────────────────────────────────────────
async function selectSmtpNode(db) {
  return db.prepare(
    `SELECT * FROM smtp_pool
     WHERE status = 'active' AND daily_sent_count < max_daily_limit
     ORDER BY last_used_timestamp ASC
     LIMIT 1`
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

// ─── MailChannels sender ───────────────────────────────────────────────────────
async function sendViaMailChannels(smtpNode, toAddress, senderName, subject, html) {
  const fromName = senderName || smtpNode.sender_name || 'ORACLEX Mail Engine';
  const body = {
    personalizations: [{ to: [{ email: toAddress }] }],
    from: { email: smtpNode.email, name: fromName },
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
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    throw new Error(`MailChannels error ${res.status}: ${text}`);
  }
  return true;
}

// ─── Template renderer ────────────────────────────────────────────────────────
function renderTemplate(templateName, data) {
  const fn = TEMPLATES[templateName];
  if (!fn) throw new Error(`Unknown template: ${templateName}`);
  return fn(data || {});
}

function templateSubject(templateName, data) {
  const subjects = {
    verification: `Your verification code — ${data.code || ''}`,
    otp: `Your OTP code — ${data.code || ''}`,
    'password-reset': 'Reset your password',
    'magic-link': 'Your magic sign-in link',
  };
  return subjects[templateName] || 'Message from ORACLEX';
}

// ─── Webhook fire-and-forget ──────────────────────────────────────────────────
async function fireWebhooks(db, developerId, event, payload) {
  try {
    const { results } = await db.prepare(
      `SELECT url FROM webhooks WHERE developer_id = ? AND status = 'active' AND events LIKE ?`
    ).bind(developerId, `%${event}%`).all();

    for (const row of results) {
      fetch(row.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ...payload }),
      }).catch(() => {});
    }
  } catch (_) {}
}

// ─── Hono app ─────────────────────────────────────────────────────────────────
const app = new Hono();

app.use('*', cors());

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/v1/email/send
// Validate auth → insert email row → enqueue job → 202
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/v1/email/send', authMiddleware, async (c) => {
  const dev = c.get('developer');
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { to, template, senderName, data } = body;
  if (!to || !template) {
    return c.json({ error: 'Missing required fields: to, template' }, 400);
  }
  if (!TEMPLATES[template]) {
    return c.json({ error: `Unknown template: ${template}. Available: ${Object.keys(TEMPLATES).join(', ')}` }, 400);
  }

  const messageId = generateUUID();
  const dataStr = JSON.stringify(data || {});

  await c.env.DB.prepare(
    `INSERT INTO emails (message_id, developer_id, to_address, template, sender_name, data, status, queued_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', unixepoch('now'))`
  ).bind(messageId, dev.id, to, template, senderName || null, dataStr).run();

  await c.env.EMAIL_QUEUE.send({
    messageId,
    developerId: dev.id,
    to,
    template,
    senderName: senderName || null,
    data: data || {},
  });

  return c.json({ messageId, status: 'queued' }, 202);
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/stats
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/stats', authMiddleware, async (c) => {
  const dev = c.get('developer');

  const [sentRow, failedRow, queuedRow] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = 'sent'`).bind(dev.id).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = 'failed'`).bind(dev.id).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = 'queued'`).bind(dev.id).first(),
  ]);

  const sent = sentRow?.cnt ?? 0;
  const failed = failedRow?.cnt ?? 0;
  const queue = queuedRow?.cnt ?? 0;
  const total = sent + failed;
  const successRate = total > 0 ? parseFloat(((sent / total) * 100).toFixed(1)) : 100;

  return c.json({ sent, failed, queue, success_rate: successRate });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/email/logs?status=queued&page=1&limit=20
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/email/logs', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const status = c.req.query('status') || null;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  let query, countQuery;
  let params, countParams;

  if (status) {
    query = `SELECT id, message_id, to_address, template, sender_name, status, error_message, queued_at, sent_at
             FROM emails WHERE developer_id = ? AND status = ?
             ORDER BY queued_at DESC LIMIT ? OFFSET ?`;
    params = [dev.id, status, limit, offset];
    countQuery = `SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ? AND status = ?`;
    countParams = [dev.id, status];
  } else {
    query = `SELECT id, message_id, to_address, template, sender_name, status, error_message, queued_at, sent_at
             FROM emails WHERE developer_id = ?
             ORDER BY queued_at DESC LIMIT ? OFFSET ?`;
    params = [dev.id, limit, offset];
    countQuery = `SELECT COUNT(*) as cnt FROM emails WHERE developer_id = ?`;
    countParams = [dev.id];
  }

  const [logsResult, countResult] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare(countQuery).bind(...countParams).first(),
  ]);

  const total = countResult?.cnt ?? 0;

  return c.json({
    data: logsResult.results,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/v1/smtp/pool
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/smtp/pool', authMiddleware, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, email, sender_name, status, daily_sent_count, max_daily_limit, last_used_timestamp, created_at
     FROM smtp_pool
     ORDER BY id ASC`
  ).all();

  return c.json(results.map((r) => ({
    ...r,
    utilization_pct: parseFloat(((r.daily_sent_count / r.max_daily_limit) * 100).toFixed(1)),
    remaining_today: r.max_daily_limit - r.daily_sent_count,
  })));
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/v1/webhooks
// ──────────────────────────────────────────────────────────────────────────────
app.post('/api/v1/webhooks', authMiddleware, async (c) => {
  const dev = c.get('developer');
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { url, events } = body;
  if (!url) {
    return c.json({ error: 'Missing required field: url' }, 400);
  }

  try {
    new URL(url);
  } catch {
    return c.json({ error: 'Invalid URL' }, 400);
  }

  const eventsStr = Array.isArray(events) ? events.join(',') : (events || 'sent,failed');

  const result = await c.env.DB.prepare(
    `INSERT INTO webhooks (developer_id, url, events) VALUES (?, ?, ?)`
  ).bind(dev.id, url, eventsStr).run();

  const webhook = await c.env.DB.prepare(
    `SELECT * FROM webhooks WHERE id = ?`
  ).bind(result.meta.last_row_id).first();

  return c.json(webhook, 201);
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/webhooks/:id
// ──────────────────────────────────────────────────────────────────────────────
app.delete('/api/v1/webhooks/:id', authMiddleware, async (c) => {
  const dev = c.get('developer');
  const id = parseInt(c.req.param('id'), 10);
  if (isNaN(id)) return c.json({ error: 'Invalid webhook id' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id FROM webhooks WHERE id = ? AND developer_id = ?`
  ).bind(id, dev.id).first();

  if (!existing) {
    return c.json({ error: 'Webhook not found' }, 404);
  }

  await c.env.DB.prepare(`DELETE FROM webhooks WHERE id = ?`).bind(id).run();
  return c.json({ deleted: true, id });
});

// ──────────────────────────────────────────────────────────────────────────────
// Health check (no auth)
// ──────────────────────────────────────────────────────────────────────────────
app.get('/api/v1/health', (c) => c.json({ status: 'ok', engine: 'ORACLEX Mail Engine v1' }));

// ─── Queue consumer ───────────────────────────────────────────────────────────
async function queueHandler(batch, env) {
  for (const message of batch.messages) {
    const job = message.body;
    const { messageId, developerId, to, template, senderName, data } = job;

    try {
      const smtpNode = await selectSmtpNode(env.DB);
      if (!smtpNode) {
        await env.DB.prepare(
          `UPDATE emails SET status = 'failed', error_message = ? WHERE message_id = ?`
        ).bind('No active SMTP nodes with available quota', messageId).run();
        await fireWebhooks(env.DB, developerId, 'failed', { messageId, reason: 'no_smtp_pool' });
        message.ack();
        continue;
      }

      const html = renderTemplate(template, data);
      const subject = templateSubject(template, data);

      await sendViaMailChannels(smtpNode, to, senderName, subject, html);
      await markSmtpUsed(env.DB, smtpNode.id);

      await env.DB.prepare(
        `UPDATE emails SET status = 'sent', smtp_pool_id = ?, sent_at = unixepoch('now') WHERE message_id = ?`
      ).bind(smtpNode.id, messageId).run();

      await fireWebhooks(env.DB, developerId, 'sent', { messageId, to, template });
      message.ack();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await env.DB.prepare(
        `UPDATE emails SET status = 'failed', error_message = ? WHERE message_id = ?`
      ).bind(errMsg.slice(0, 500), messageId).run();
      await fireWebhooks(env.DB, developerId, 'failed', { messageId, reason: errMsg.slice(0, 200) });
      message.ack();
    }
  }
}

// ─── Cron handler — reset daily_sent_count at 00:00 UTC ──────────────────────
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
