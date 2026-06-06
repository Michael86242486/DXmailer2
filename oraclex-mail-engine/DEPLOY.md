# ORACLEX Mail Engine — Deploy Guide

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Wrangler CLI installed: `npm i -g wrangler`
- Authenticated: `wrangler login`

---

## Step 1 — Install dependencies

```bash
cd oraclex-mail-engine
npm install
```

---

## Step 2 — Create the D1 database

```bash
wrangler d1 create oraclex-db
```

Copy the `database_id` from the output and paste it into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "oraclex-db"
database_id = "PASTE-YOUR-DATABASE-ID-HERE"
```

---

## Step 3 — Create the Queue

```bash
wrangler queues create email-queue
wrangler queues create email-dlq
```

---

## Step 4 — Apply the database schema

```bash
# Local dev DB
npm run db:init

# Production DB (once you're ready to deploy)
npm run db:init:remote
```

The schema already seeds the test API key `oraclex_live_test_key_xyz123`.

---

## Step 5 — Add SMTP pool entries

Connect real Gmail accounts with App Passwords.

```bash
wrangler d1 execute oraclex-db --remote --command="
INSERT INTO smtp_pool (email, app_password, sender_name)
VALUES ('your-gmail@gmail.com', 'xxxx xxxx xxxx xxxx', 'ORACLEX Master Control');
"
```

**How to generate a Gmail App Password:**
1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. App name: `ORACLEX Mail Engine`
3. Copy the 16-character password (with spaces is fine)

You can add multiple Gmail accounts — the LRU rotation will balance load automatically,
up to 500 emails/day per account.

---

## Step 6 — Local development

```bash
npm run dev
```

Then test with the exact curl:

```bash
curl -X POST http://localhost:8787/api/v1/email/send \
  -H "Authorization: Bearer oraclex_live_test_key_xyz123" \
  -H "Content-Type: application/json" \
  -d '{"to":"michaelademola8624@gmail.com","template":"verification","senderName":"ORACLEX Master Control","data":{"code":"882941","company":"ORACLEX Lab Ecosystem","date":"2026"}}'
```

Expected response (HTTP 202):
```json
{"messageId":"<uuid>","status":"queued"}
```

---

## Step 7 — Deploy to Cloudflare Workers

```bash
npm run deploy
```

Your Worker URL will be:
```
https://oraclex-api.<YOUR_SUBDOMAIN>.workers.dev
```

Seed the production DB:
```bash
npm run db:seed:remote
```

---

## Step 8 — Test production

```bash
curl -X POST https://oraclex-api.YOUR_SUBDOMAIN.workers.dev/api/v1/email/send \
  -H "Authorization: Bearer oraclex_live_test_key_xyz123" \
  -H "Content-Type: application/json" \
  -d '{"to":"michaelademola8624@gmail.com","template":"verification","senderName":"ORACLEX Master Control","data":{"code":"882941","company":"ORACLEX Lab Ecosystem","date":"2026"}}'
```

---

## All Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/email/send` | Bearer | Queue an email for delivery |
| GET | `/api/v1/stats` | Bearer | Delivery stats for your account |
| GET | `/api/v1/email/logs` | Bearer | Paginated email log (`?status=queued&page=1&limit=20`) |
| GET | `/api/v1/smtp/pool` | Bearer | SMTP node status + daily counts |
| POST | `/api/v1/webhooks` | Bearer | Register a webhook URL |
| DELETE | `/api/v1/webhooks/:id` | Bearer | Remove a webhook |
| GET | `/api/v1/health` | None | Health check |

---

## Verify email row in D1

```bash
wrangler d1 execute oraclex-db --remote \
  --command="SELECT * FROM emails ORDER BY id DESC LIMIT 5;"
```

---

## Cron Reset

Every day at 00:00 UTC, all SMTP accounts have their `daily_sent_count` reset to 0.
This is handled automatically by the Cron Trigger in `wrangler.toml`.

---

## MailChannels Note

MailChannels free API (`api.mailchannels.net`) requires that your **sender domain is
SPF-authorized for Cloudflare Workers**. Add this DNS TXT record on the domain matching
your Gmail accounts, OR use MailChannels' domain lockdown feature:

```
v=spf1 include:relay.mailchannels.net ~all
```

If you are sending FROM `@gmail.com` addresses, MailChannels will relay through Gmail's
own SPF/DKIM, which is already configured. This is the simplest setup.
