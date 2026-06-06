# ORACLEX Mail Engine v2 — Deploy Guide

Architecture inspired by Novu (github.com/novuhq/novu):
subscriber management · event/trigger workflows · execution detail tracing
multi-channel provider abstraction · activity feed · webhook delivery

---

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Wrangler CLI: `npm i -g wrangler`
- Authenticated: `wrangler login`

---

## Step 1 — Install

```bash
cd oraclex-mail-engine
npm install
```

---

## Step 2 — Create D1 database

```bash
wrangler d1 create oraclex-db
```

Paste the `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "oraclex-db"
database_id = "PASTE-YOUR-DATABASE-ID-HERE"
```

---

## Step 3 — Create Queues

```bash
wrangler queues create email-queue
wrangler queues create email-dlq
```

---

## Step 4 — Apply schema

```bash
# Local dev
npm run db:init

# Production (after deploy)
npm run db:init:remote
```

---

## Step 5 — Seed the relay pool

`seed-relay.sql` is gitignored. Run it separately:

```bash
# Local dev
wrangler d1 execute oraclex-db --file=seed-relay.sql

# Production
wrangler d1 execute oraclex-db --remote --file=seed-relay.sql
```

**Active Relay Nodes already configured in seed-relay.sql:**
- Relay Node 01: oraclex.relay01@gmail.com (500/day)
- Relay Node 02: oraclex.relay02@gmail.com (500/day)
- Combined daily capacity: **1,000 emails/day**

To add more nodes later:
```bash
wrangler d1 execute oraclex-db --remote --command="
INSERT INTO smtp_pool (email, app_password, sender_name) VALUES ('new@gmail.com', 'apppassword', 'ORACLEX Relay Node 03');"
```

---

## Step 6 — Local dev

```bash
npm run dev
```

Test the original spec curl:

```bash
curl -X POST http://localhost:8787/api/v1/email/send \
  -H "Authorization: Bearer oraclex_live_test_key_xyz123" \
  -H "Content-Type: application/json" \
  -d '{"to":"michaelademola8624@gmail.com","template":"verification","senderName":"ORACLEX Master Control","data":{"code":"882941","company":"ORACLEX Lab Ecosystem","date":"2026"}}'
```

Expected → HTTP 202:
```json
{"messageId":"<uuid>","status":"queued"}
```

---

## Step 7 — Deploy

```bash
npm run deploy
# seed remote DB:
npm run db:init:remote
wrangler d1 execute oraclex-db --remote --file=seed-relay.sql
```

---

## All Routes

### Original Spec
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/email/send` | Bearer | Queue email for delivery |
| GET | `/api/v1/stats` | Bearer | Delivery stats |
| GET | `/api/v1/email/logs` | Bearer | Paginated email log (`?status=queued&page=1&limit=20`) |
| GET | `/api/v1/smtp/pool` | Bearer | SMTP relay pool status + daily counts |
| POST | `/api/v1/webhooks` | Bearer | Register webhook URL |
| DELETE | `/api/v1/webhooks/:id` | Bearer | Remove webhook |

### Novu-Inspired
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | `/api/v1/events/trigger` | Bearer | Trigger workflow for a subscriber |
| GET | `/api/v1/subscribers` | Bearer | List subscribers (`?email=search`) |
| POST | `/api/v1/subscribers` | Bearer | Upsert subscriber profile |
| GET | `/api/v1/subscribers/:subscriberId` | Bearer | Get subscriber + notification history |
| GET | `/api/v1/activity` | Bearer | Full activity feed (`?status=sent&templateId=verification`) |
| GET | `/api/v1/activity/:messageId/execution-details` | Bearer | Per-step execution trace |
| GET | `/api/v1/workflows` | Bearer | List available workflows/templates |
| GET | `/api/v1/health` | None | Health check |

---

## Novu-style trigger example

```bash
curl -X POST http://localhost:8787/api/v1/events/trigger \
  -H "Authorization: Bearer oraclex_live_test_key_xyz123" \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "verification",
    "to": {
      "subscriberId": "user-001",
      "email": "michaelademola8624@gmail.com",
      "firstName": "Michael"
    },
    "payload": {
      "code": "882941",
      "company": "ORACLEX Lab Ecosystem",
      "date": "2026"
    }
  }'
```

Response:
```json
{"transactionId":"<uuid>","acknowledged":true,"status":[{"status":"queued"}]}
```

---

## Check execution trace

```bash
curl http://localhost:8787/api/v1/activity/MESSAGE_ID/execution-details \
  -H "Authorization: Bearer oraclex_live_test_key_xyz123"
```

Returns step-by-step trace: queued → relay selected → sent (or failed with reason).

---

## Cron Reset

Every day 00:00 UTC: `daily_sent_count` resets to 0 for all non-locked nodes.
Handled by Cloudflare Cron Trigger: `0 0 * * *`

---

## MailChannels SPF Note

Add this TXT record on the domain of your sender emails:
```
v=spf1 include:relay.mailchannels.net ~all
```
Gmail addresses already pass SPF through Google's own records — no extra DNS needed for `@gmail.com` senders.
