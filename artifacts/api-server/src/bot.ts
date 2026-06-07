import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  telegramUsersTable, usersTable, apiKeysTable, oraplexEmailsTable, smtpPoolTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, signJwt, generateOtp, generateApiKey } from "./lib/auth.js";
import { logger } from "./lib/logger.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHANNEL = process.env.TELEGRAM_CHANNEL_ID ?? "@ORALEXOfficial";

function now() { return Math.floor(Date.now() / 1000); }
function today() { return new Date().toISOString().slice(0, 10); }

// ─── Deliverability: send OTP via internal API ────────────────────────────────
async function sendOtpViaPool(toEmail: string, code: string) {
  const nodemailer = await import("nodemailer");
  const nodes = await db.select().from(smtpPoolTable)
    .where(and(eq(smtpPoolTable.status, "active")))
    .orderBy(smtpPoolTable.lastUsedTimestamp)
    .limit(1);
  if (!nodes.length) throw new Error("No relay nodes");
  const node = nodes[0];
  const t = nodemailer.default.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: node.email, pass: node.appPassword },
    tls: { rejectUnauthorized: true },
  });
  const digits = code.split("").map((d) =>
    `<span style="font-family:monospace;font-size:36px;font-weight:900;color:#4a9eff;padding:0 4px;">${d}</span>`
  ).join("");
  await t.sendMail({
    from: `"ORACLEX" <${node.email}>`,
    to: toEmail,
    subject: `ORACLEX verification code: ${code}`,
    html: `<body style="font-family:sans-serif;background:#0d0d0d;color:#e8e8e8;padding:32px"><div style="max-width:480px;margin:0 auto;background:#141414;border:1px solid #252525;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center"><div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#4a9eff;margin-bottom:10px">ORACLEX</div><h2 style="color:#fff;margin:0">Verify your account</h2></div><div style="padding:32px"><p style="color:#aaa;margin:0 0 20px">Your verification code (expires in 10 min):</p><div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;text-align:center">${digits}</div><p style="color:#555;font-size:13px;margin-top:20px">Sent via ORACLEX Telegram Bot</p></div></div></body>`,
  });
  await db.update(smtpPoolTable).set({ dailySentCount: node.dailySentCount + 1, lastUsedTimestamp: now() }).where(eq(smtpPoolTable.id, node.id));
}

// ─── Channel membership check ─────────────────────────────────────────────────
async function isMemberOfChannel(bot: TelegramBot, userId: number): Promise<boolean> {
  if (!CHANNEL || CHANNEL === "@ORALEXOfficial") return true; // skip if not configured
  try {
    const member = await bot.getChatMember(CHANNEL, userId);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch {
    return false; // if we can't check, let them through
  }
}

// ─── Get or create telegram user record ──────────────────────────────────────
async function getTgUser(telegramId: string, username?: string, firstName?: string) {
  const existing = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
  if (existing.length) return existing[0];
  const [created] = await db.insert(telegramUsersTable).values({
    telegramId, username, firstName, state: "idle", createdAt: now(),
  }).returning();
  return created;
}

// ─── Format large code block ──────────────────────────────────────────────────
function code(text: string) { return `\`\`\`\n${text}\n\`\`\``; }
function inline(text: string) { return `\`${text}\``; }

export function startBot() {
  if (!TOKEN) { logger.warn("TELEGRAM_BOT_TOKEN not set — bot disabled"); return; }

  const bot = new TelegramBot(TOKEN, { polling: { interval: 1500, autoStart: true } });
  logger.info("Telegram bot started (polling)");

  bot.on("polling_error", (err) => logger.warn({ err: err.message }, "Telegram polling error"));

  // ─── /start ────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const firstName = msg.from?.first_name ?? "there";

    const isMember = await isMemberOfChannel(bot, msg.from!.id);
    if (!isMember) {
      await bot.sendMessage(chatId, `🔒 *Access Required*\n\nYou must join our channel to use ORACLEX Bot.\n\n👉 Join: ${CHANNEL}\n\nThen send /start again.`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "📢 Join Channel", url: `https://t.me/${CHANNEL.replace("@", "")}` }]] },
      });
      return;
    }

    const tgUser = await getTgUser(telegramId, msg.from?.username, firstName);

    if (tgUser.userId) {
      const users = await db.select({ email: usersTable.email, tier: usersTable.tier }).from(usersTable).where(eq(usersTable.id, tgUser.userId)).limit(1);
      const email = users[0]?.email ?? "unknown";
      await bot.sendMessage(chatId, `⚡ *Welcome back, ${firstName}!*\n\n📧 Account: ${inline(email)}\n🏷️ Tier: ${users[0]?.tier ?? "free"}\n\nType /help to see all commands.`, { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId,
        `⚡ *Welcome to ORACLEX Mail Engine!*\n\nThe fastest way to send transactional emails via Gmail rotation matrix.\n\n*To get started:*\n• New user? → /signup\n• Existing user? → /login\n\nType /help to see all commands.`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // ─── /help ─────────────────────────────────────────────────────────────────
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, `⚡ *ORACLEX Bot Commands*\n\n*🔐 Account*\n/signup — Create a new ORACLEX account\n/login — Sign in to your account\n/me — View your account info\n/logout — Sign out\n\n*🗝️ API Keys*\n/keys — List your API keys\n/newkey <name> — Create a new API key\n/revokekey <id> — Revoke an API key\n\n*📊 Stats & Usage*\n/usage — Today's email usage vs quota\n/stats — Delivery statistics\n/pool — SMTP relay pool status\n\n*📚 Docs & Playground*\n/docs — API documentation link\n/playground — Interactive send test\n/send <to> <template> — Send a test email\n\n*ℹ️ General*\n/start — Welcome screen\n/help — This help message\n\n📖 Full docs: /docs`, { parse_mode: "Markdown" });
  });

  // ─── /signup ────────────────────────────────────────────────────────────────
  bot.onText(/\/signup(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const email = match?.[1]?.toLowerCase();
    const password = match?.[2];

    if (!email || !password) {
      await bot.sendMessage(chatId, `📝 *Create Account*\n\nUsage:\n${code("/signup your@email.com yourpassword")}\n\nPassword must be at least 8 characters.`, { parse_mode: "Markdown" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await bot.sendMessage(chatId, "❌ Invalid email address."); return;
    }
    if (password.length < 8) {
      await bot.sendMessage(chatId, "❌ Password must be at least 8 characters."); return;
    }
    try {
      const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
      if (existing.length) { await bot.sendMessage(chatId, "❌ Email already registered. Use /login to sign in."); return; }

      const otp = generateOtp();
      const [user] = await db.insert(usersTable).values({
        email, passwordHash: await hashPassword(password), verified: false,
        otpCode: otp, otpExpiresAt: now() + 600, tier: "free", emailQuota: 100, createdAt: now(),
      }).returning();

      // Link telegram → pending
      const tgUser = await getTgUser(telegramId, msg.from?.username, msg.from?.first_name);
      await db.update(telegramUsersTable).set({ pendingEmail: email, state: "awaiting_otp", userId: user.id }).where(eq(telegramUsersTable.id, tgUser.id));

      await sendOtpViaPool(email, otp).catch(() => {});

      await bot.sendMessage(chatId, `✅ Account created!\n\n📧 Verification code sent to: ${inline(email)}\n\nEnter the 6-digit code:\n${code("/verify 882941")}`, { parse_mode: "Markdown" });
    } catch (err) {
      await bot.sendMessage(chatId, "❌ Signup failed. Please try again.");
      logger.error({ err }, "Bot signup error");
    }
  });

  // ─── /verify ────────────────────────────────────────────────────────────────
  bot.onText(/\/verify\s+(\d{6})/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const code_input = match?.[1];

    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.pendingEmail) { await bot.sendMessage(chatId, "❌ No pending verification. Use /signup first."); return; }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, tgUser.pendingEmail)).limit(1);
    const user = users[0];
    if (!user || user.otpCode !== code_input) { await bot.sendMessage(chatId, "❌ Invalid code. Try again or /signup again."); return; }
    if (user.otpExpiresAt && user.otpExpiresAt < now()) { await bot.sendMessage(chatId, "❌ Code expired. Use /signup to resend."); return; }

    await db.update(usersTable).set({ verified: true, otpCode: null, otpExpiresAt: null }).where(eq(usersTable.id, user.id));
    await db.update(telegramUsersTable).set({ state: "idle", pendingEmail: null, userId: user.id }).where(eq(telegramUsersTable.id, tgUser.id));

    await bot.sendMessage(chatId, `🎉 *Email verified!*\n\nWelcome to ORACLEX, ${inline(user.email)}!\n\n*Next steps:*\n1. Create your first API key → /newkey MyApp\n2. Send an email → /docs\n3. Check your usage → /usage`, { parse_mode: "Markdown" });
  });

  // ─── /login ─────────────────────────────────────────────────────────────────
  bot.onText(/\/login(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const email = match?.[1]?.toLowerCase();
    const password = match?.[2];

    if (!email || !password) {
      await bot.sendMessage(chatId, `🔐 *Sign In*\n\nUsage:\n${code("/login your@email.com yourpassword")}`, { parse_mode: "Markdown" });
      return;
    }
    try {
      const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
      if (!users.length || !(await verifyPassword(password, users[0].passwordHash))) {
        await bot.sendMessage(chatId, "❌ Invalid email or password."); return;
      }
      const user = users[0];
      if (!user.verified) { await bot.sendMessage(chatId, "❌ Account not verified. Check your email or /signup again."); return; }

      const tgUser = await getTgUser(telegramId, msg.from?.username, msg.from?.first_name);
      await db.update(telegramUsersTable).set({ userId: user.id, state: "idle" }).where(eq(telegramUsersTable.id, tgUser.id));

      await bot.sendMessage(chatId, `✅ *Logged in!*\n\n📧 ${inline(user.email)}\n🏷️ Tier: ${user.tier} (${user.emailQuota} emails/day)\n\nType /help to see all commands.`, { parse_mode: "Markdown" });
    } catch (err) {
      await bot.sendMessage(chatId, "❌ Login failed."); logger.error({ err }, "Bot login error");
    }
  });

  // ─── /me ────────────────────────────────────────────────────────────────────
  bot.onText(/\/me/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login or /signup."); return; }
    const users = await db.select().from(usersTable).where(eq(usersTable.id, tgUser.userId)).limit(1);
    const user = users[0];
    await bot.sendMessage(chatId, `👤 *Your Account*\n\n📧 Email: ${inline(user.email)}\n🏷️ Tier: ${user.tier}\n📊 Daily quota: ${user.emailQuota} emails\n🔐 Verified: ${user.verified ? "✅" : "❌"}`, { parse_mode: "Markdown" });
  });

  // ─── /logout ────────────────────────────────────────────────────────────────
  bot.onText(/\/logout/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    await db.update(telegramUsersTable).set({ userId: null, state: "idle" }).where(eq(telegramUsersTable.telegramId, telegramId));
    await bot.sendMessage(chatId, "✅ Logged out. Use /login to sign back in.");
  });

  // ─── /keys ──────────────────────────────────────────────────────────────────
  bot.onText(/\/keys/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login first."); return; }

    const keys = await db.select().from(apiKeysTable).where(and(eq(apiKeysTable.userId, tgUser.userId), eq(apiKeysTable.isActive, true)));
    if (!keys.length) {
      await bot.sendMessage(chatId, `🗝️ *No API keys yet*\n\nCreate one with:\n${code("/newkey MyAppName")}`, { parse_mode: "Markdown" }); return;
    }
    const list = keys.map((k) => `• ${inline(k.keyPrefix + "…")} — *${k.name}* (id: ${k.id})`).join("\n");
    await bot.sendMessage(chatId, `🗝️ *Your API Keys*\n\n${list}\n\nTo revoke: /revokekey <id>`, { parse_mode: "Markdown" });
  });

  // ─── /newkey ────────────────────────────────────────────────────────────────
  bot.onText(/\/newkey(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login first."); return; }
    const name = match?.[1]?.trim();
    if (!name) { await bot.sendMessage(chatId, `🗝️ Usage:\n${code("/newkey MyApp")}`, { parse_mode: "Markdown" }); return; }

    const { full, prefix, hash } = generateApiKey();
    await db.insert(apiKeysTable).values({ userId: tgUser.userId, name, keyPrefix: prefix, keyHash: hash, isActive: true, emailsToday: 0, quotaDate: today(), createdAt: now() });

    await bot.sendMessage(chatId, `✅ *API Key Created!*\n\nName: *${name}*\n\n⚠️ *Copy this key now — shown only once:*\n${code(full)}\n\nUse it as:\n${code(`Authorization: Bearer ${full}`)}`, { parse_mode: "Markdown" });
  });

  // ─── /revokekey ─────────────────────────────────────────────────────────────
  bot.onText(/\/revokekey\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in."); return; }
    const id = parseInt(match![1], 10);
    const [updated] = await db.update(apiKeysTable).set({ isActive: false }).where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, tgUser.userId))).returning();
    if (!updated) { await bot.sendMessage(chatId, "❌ Key not found."); return; }
    await bot.sendMessage(chatId, `✅ API key #${id} revoked.`);
  });

  // ─── /usage ─────────────────────────────────────────────────────────────────
  bot.onText(/\/usage/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in."); return; }

    const users = await db.select().from(usersTable).where(eq(usersTable.id, tgUser.userId)).limit(1);
    const quota = users[0]?.emailQuota ?? 100;

    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(oraplexEmailsTable)
      .where(and(eq(oraplexEmailsTable.userId, tgUser.userId), sql`queued_at >= ${startOfDay}`));

    const used = cnt ?? 0;
    const remaining = Math.max(0, quota - used);
    const pct = Math.round((used / quota) * 100);
    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));

    await bot.sendMessage(chatId,
      `📊 *Today's Usage*\n\n[${bar}] ${pct}%\n\n📧 Sent: *${used}* / ${quota}\n✅ Remaining: *${remaining}*\n\nResets at midnight UTC.`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /stats ─────────────────────────────────────────────────────────────────
  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in."); return; }

    const rows = await db.select({ status: oraplexEmailsTable.status, cnt: sql<number>`count(*)::int` })
      .from(oraplexEmailsTable).where(eq(oraplexEmailsTable.userId, tgUser.userId)).groupBy(oraplexEmailsTable.status);

    let sent = 0, failed = 0, queue = 0;
    for (const r of rows) {
      if (r.status === "sent") sent = r.cnt;
      else if (r.status === "failed") failed = r.cnt;
      else queue += r.cnt;
    }
    const total = sent + failed;
    const rate = total > 0 ? ((sent / total) * 100).toFixed(1) : "100.0";
    await bot.sendMessage(chatId, `📊 *Delivery Stats*\n\n✅ Sent: *${sent}*\n❌ Failed: *${failed}*\n⏳ Queue: *${queue}*\n📈 Success rate: *${rate}%*`, { parse_mode: "Markdown" });
  });

  // ─── /pool ──────────────────────────────────────────────────────────────────
  bot.onText(/\/pool/, async (msg) => {
    const chatId = msg.chat.id;
    const nodes = await db.select().from(smtpPoolTable);
    const list = nodes.map((n) => {
      const pct = Math.round((n.dailySentCount / n.maxDailyLimit) * 100);
      const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
      return `*${n.email.replace("oraclex.", "").replace("@gmail.com", "")}* ${n.status === "active" ? "🟢" : "🔴"}\n[${bar}] ${n.dailySentCount}/${n.maxDailyLimit}`;
    }).join("\n\n");
    await bot.sendMessage(chatId, `📡 *Relay Pool (${nodes.length} nodes)*\n\n${list}`, { parse_mode: "Markdown" });
  });

  // ─── /docs ──────────────────────────────────────────────────────────────────
  bot.onText(/\/docs/, async (msg) => {
    const chatId = msg.chat.id;
    const docsUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/docs` : "http://localhost:80/api/docs";
    const uiUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/docs` : "http://localhost:80/docs";
    await bot.sendMessage(chatId,
      `📚 *ORACLEX Documentation*\n\n• 🔵 Swagger UI: [Open API Explorer](${docsUrl})\n• 📖 Developer Docs: [Full Guide](${uiUrl})\n\n*Quick reference:*\n${code(`POST /api/v1/email/send\n  -H "Authorization: Bearer YOUR_KEY"\n  -d '{"to":"user@example.com","template":"verification","data":{"code":"882941"}}'`)}`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );
  });

  // ─── /playground / /send ────────────────────────────────────────────────────
  bot.onText(/\/(?:playground|send)(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login first."); return; }

    const to = match?.[1];
    const template = match?.[2] ?? "verification";

    if (!to) {
      await bot.sendMessage(chatId, `🎮 *Playground*\n\nSend a test email:\n${code("/send target@email.com verification")}\n\nTemplates: verification, otp, password-reset, magic-link`, { parse_mode: "Markdown" }); return;
    }

    // Get an active API key for this user
    const keys = await db.select().from(apiKeysTable).where(and(eq(apiKeysTable.userId, tgUser.userId), eq(apiKeysTable.isActive, true))).limit(1);
    if (!keys.length) {
      await bot.sendMessage(chatId, `❌ No API key found.\n\nCreate one first: /newkey MyTest`); return;
    }

    const apiUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/api/v1/email/send` : "http://localhost:80/api/v1/email/send";
    try {
      // Call our own API internally
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-User-Id": String(tgUser.userId) },
        body: JSON.stringify({ to, template, data: { code: "882941", company: "ORACLEX Test" } }),
      });
      const data = await resp.json() as { messageId?: string; status?: string; error?: string };
      if (!resp.ok) {
        await bot.sendMessage(chatId, `❌ Send failed: ${data.error ?? resp.status}`); return;
      }
      await bot.sendMessage(chatId, `✅ *Email queued!*\n\n📧 To: ${inline(to)}\n📝 Template: ${template}\n🔑 ID: ${inline(data.messageId ?? "?")}`
        , { parse_mode: "Markdown" });
    } catch (err) {
      await bot.sendMessage(chatId, "❌ Failed to send email. Check /pool for relay status.");
    }
  });

  // ─── Fallback ─────────────────────────────────────────────────────────────
  bot.on("message", async (msg) => {
    if (msg.text?.startsWith("/") && ![
      "/start", "/help", "/signup", "/verify", "/login", "/logout", "/me",
      "/keys", "/newkey", "/revokekey", "/usage", "/stats", "/pool", "/docs",
      "/playground", "/send",
    ].some((cmd) => msg.text?.startsWith(cmd))) {
      await bot.sendMessage(msg.chat.id, "❓ Unknown command. Type /help to see all available commands.");
    }
  });

  return bot;
}
