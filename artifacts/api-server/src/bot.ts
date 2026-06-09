import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  telegramUsersTable, usersTable, apiKeysTable, oraplexEmailsTable, smtpPoolTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, verifyPassword, generateOtp, generateApiKey } from "./lib/auth.js";
import { logger } from "./lib/logger.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHANNEL = process.env.TELEGRAM_CHANNEL_ID ?? "";

// ─── Per-user AI conversation history (in-memory, last 12 messages) ──────────
const conversations = new Map<string, Array<{ role: "user" | "assistant" | "system"; content: string }>>();
const MAX_HISTORY = 12;

const AI_SYSTEM_PROMPT = `You are ORACLEX AI — the intelligent assistant for ORACLEX Mail Engine, a powerful developer-friendly transactional email service.

Your role:
• Help developers integrate ORACLEX into their applications (Node.js, Python, PHP, cURL)
• Guide users through creating their first API key and sending emails
• Explain the 4 email templates: verification, otp, password-reset, magic-link
• Help troubleshoot integration problems
• Answer questions about the platform, free tier limits, and features

About ORACLEX:
• Free tier: 100 emails/day per account (upgradeable)
• API: POST /api/v1/email/send with Bearer key auth
• Fast, reliable transactional delivery
• Works like Resend — simple REST API, any backend language

Key API example:
POST /api/v1/email/send
Authorization: Bearer oraclex_live_...
{"to":"user@email.com","template":"verification","data":{"code":"882941","company":"MyApp"}}

When you want to send a test email on behalf of the user, add this EXACT trigger at the END of your reply:
[SEND_TEST:email@example.com:verification]

Replace with the user's actual email and their chosen template. Only add the trigger if the user explicitly asks to send a test email and gives you their email address.

Keep responses concise, friendly, and focused on ORACLEX integration. Format code in markdown code blocks. Do not discuss internal infrastructure or backend architecture.`;

async function callAI(telegramId: string, userMessage: string): Promise<string> {
  const apiKey = process.env.AIMODELAPI_KEY ?? "";
  const baseUrl = process.env.AIMODELAPI_BASE ?? "https://aimodelapi.onrender.com/v1";
  if (!apiKey) return "AI assistant is not configured yet.";

  // Get or create conversation history
  if (!conversations.has(telegramId)) {
    conversations.set(telegramId, [{ role: "system", content: AI_SYSTEM_PROMPT }]);
  }
  const history = conversations.get(telegramId)!;
  history.push({ role: "user", content: userMessage });

  // Keep history bounded
  const bounded = [history[0], ...history.slice(-MAX_HISTORY)];
  conversations.set(telegramId, bounded);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "dev-x", messages: bounded, max_tokens: 800, temperature: 0.7 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => resp.status.toString());
      logger.warn({ status: resp.status, body: txt }, "AI API error");
      return "I'm having trouble connecting right now. Please try again in a moment.";
    }
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    const reply = data.choices?.[0]?.message?.content?.trim() ?? "Sorry, I didn't get a response. Try again.";

    // Add assistant reply to history
    bounded.push({ role: "assistant", content: reply });
    conversations.set(telegramId, bounded);
    return reply;
  } catch (err) {
    logger.warn({ err }, "AI API fetch error");
    return "AI assistant is temporarily unavailable. Try again in a moment.";
  }
}

function now() { return Math.floor(Date.now() / 1000); }
function today() { return new Date().toISOString().slice(0, 10); }

// ─── Direct SMTP send (bypasses HTTP, used by bot internally) ─────────────────
async function sendEmailDirect(userId: number, to: string, template: string, data: Record<string, string> = {}): Promise<string> {
  const nodemailer = await import("nodemailer");
  const { randomUUID } = await import("crypto");

  const nodes = await db.select().from(smtpPoolTable)
    .where(and(eq(smtpPoolTable.status, "active"), sql`daily_sent_count < max_daily_limit`))
    .orderBy(smtpPoolTable.lastUsedTimestamp)
    .limit(1);

  if (!nodes.length) throw new Error("No active relay nodes available");
  const node = nodes[0];

  const messageId = randomUUID();
  const company = data.company ?? "ORACLEX";
  const code = data.code ?? Math.floor(100000 + Math.random() * 900000).toString();

  const subjects: Record<string, string> = {
    verification: `Verify your ${company} account — ${code}`,
    otp: `Your one-time password — ${code}`,
    "password-reset": `Reset your ${company} password`,
    "magic-link": `Sign in to ${company}`,
  };
  const subject = subjects[template] ?? `Message from ${company}`;

  const digits = code.split("").map(d =>
    `<span style="display:inline-block;font-family:monospace;font-size:38px;font-weight:900;color:#4a9eff;min-width:32px;text-align:center;">${d}</span>`
  ).join("");

  const htmlBodies: Record<string, string> = {
    verification: `<p style="color:#aaa;margin:0 0 20px">Enter this code to verify your <strong style="color:#fff">${company}</strong> account. Expires in <strong style="color:#fff">10 minutes</strong>.</p><div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px">${digits}</div>`,
    otp: `<p style="color:#aaa;margin:0 0 20px">Your one-time password. Expires in <strong style="color:#fff">5 minutes</strong>.</p><div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px"><span style="font-family:monospace;font-size:42px;font-weight:900;color:#4aff7a;letter-spacing:14px">${code}</span></div>`,
    "password-reset": `<p style="color:#aaa;margin:0 0 20px">Click below to reset your <strong style="color:#fff">${company}</strong> password.</p>${data.resetUrl ? `<div style="text-align:center;margin-bottom:24px"><a href="${data.resetUrl}" style="display:inline-block;background:#ff7a4a;color:#fff;text-decoration:none;font-weight:700;padding:14px 40px;border-radius:10px">Reset Password</a></div>` : ""}`,
    "magic-link": `<p style="color:#aaa;margin:0 0 20px">Click below to sign in to <strong style="color:#fff">${company}</strong>.</p>${data.magicUrl ? `<div style="text-align:center;margin-bottom:24px"><a href="${data.magicUrl}" style="display:inline-block;background:linear-gradient(135deg,#7928ca,#a04aff);color:#fff;text-decoration:none;font-weight:700;padding:14px 40px;border-radius:10px">Sign In Securely</a></div>` : ""}`,
  };
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head><body style="font-family:-apple-system,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;padding:0"><div style="max-width:560px;margin:48px auto;background:#141414;border:1px solid #252525;border-radius:18px;overflow:hidden"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:44px 40px;text-align:center"><div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#4a9eff;margin-bottom:14px">${company}</div><h1 style="font-size:22px;font-weight:700;color:#fff;margin:0">${subject}</h1></div><div style="padding:44px 40px">${htmlBodies[template] ?? "<p>Message from ORACLEX</p>"}<div style="background:#111;border:1px solid #1e1e1e;border-left:3px solid #e85555;border-radius:10px;padding:16px;font-size:13px;color:#777">🔒 Automated message. Do not reply.</div></div><div style="padding:24px 40px;border-top:1px solid #1c1c1c;text-align:center;font-size:11px;color:#444">&copy; ${new Date().getFullYear()} ${company} · Sent via ORACLEX</div></div></body></html>`;

  const textBodies: Record<string, string> = {
    verification: `Verify your ${company} account\n\nCode: ${code}\n\nExpires in 10 minutes.`,
    otp: `One-time password: ${code}\n\nExpires in 5 minutes.`,
    "password-reset": `Reset your ${company} password\n\nLink: ${data.resetUrl ?? "(not provided)"}`,
    "magic-link": `Sign in to ${company}\n\nLink: ${data.magicUrl ?? "(not provided)"}`,
  };

  const domain = node.email.split("@")[1] ?? "gmail.com";
  const t = nodemailer.default.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: node.email, pass: node.appPassword },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 20000, greetingTimeout: 15000,
  });

  await t.sendMail({
    from: `"${node.senderName}" <${node.email}>`,
    replyTo: `"ORACLEX" <noreply@${domain}>`,
    to,
    subject,
    html,
    text: textBodies[template] ?? "Message from ORACLEX",
    messageId: `<${messageId}@${domain}>`,
    headers: {
      "Precedence": "transactional",
      "X-Mailer": "ORACLEX Mail Engine v2",
      "X-Entity-Ref-ID": messageId,
      "List-Unsubscribe": `<mailto:unsubscribe@${domain}?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });

  // Update relay stats
  await db.update(smtpPoolTable).set({ dailySentCount: node.dailySentCount + 1, lastUsedTimestamp: now() }).where(eq(smtpPoolTable.id, node.id));

  // Log to DB
  await db.insert(oraplexEmailsTable).values({
    messageId, userId, toAddress: to, template, senderName: node.senderName,
    data: JSON.stringify(data), status: "sent", smtpPoolId: node.id, queuedAt: now(), sentAt: now(),
  }).catch(() => {}); // non-critical

  return messageId;
}

// ─── Send OTP via pool ────────────────────────────────────────────────────────
async function sendOtpViaPool(toEmail: string, code: string) {
  const digits = code.split("").map(d =>
    `<span style="font-family:monospace;font-size:36px;font-weight:900;color:#4a9eff;padding:0 4px">${d}</span>`
  ).join("");

  const nodes = await db.select().from(smtpPoolTable)
    .where(and(eq(smtpPoolTable.status, "active"), sql`daily_sent_count < max_daily_limit`))
    .orderBy(smtpPoolTable.lastUsedTimestamp).limit(1);

  if (!nodes.length) throw new Error("No relay nodes");
  const node = nodes[0];
  const nodemailer = await import("nodemailer");
  const t = nodemailer.default.createTransport({
    host: "smtp.gmail.com", port: 587, secure: false,
    auth: { user: node.email, pass: node.appPassword },
    tls: { rejectUnauthorized: true }, connectionTimeout: 20000, greetingTimeout: 15000,
  });
  await t.sendMail({
    from: `"ORACLEX" <${node.email}>`,
    to: toEmail,
    subject: `ORACLEX verification code: ${code}`,
    html: `<body style="font-family:sans-serif;background:#0d0d0d;color:#e8e8e8;padding:32px"><div style="max-width:480px;margin:0 auto;background:#141414;border:1px solid #252525;border-radius:16px;overflow:hidden"><div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center"><div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#4a9eff;margin-bottom:10px">ORACLEX</div><h2 style="color:#fff;margin:0">Verify your account</h2></div><div style="padding:32px"><p style="color:#aaa;margin:0 0 20px">Your verification code (expires in 10 min):</p><div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;text-align:center">${digits}</div><p style="color:#555;font-size:13px;margin-top:20px">Sent via ORACLEX Bot</p></div></div></body>`,
    text: `ORACLEX verification code: ${code}\n\nExpires in 10 minutes.`,
  });
  await db.update(smtpPoolTable).set({ dailySentCount: node.dailySentCount + 1, lastUsedTimestamp: now() }).where(eq(smtpPoolTable.id, node.id));
}

// ─── Channel membership check ─────────────────────────────────────────────────
async function isMemberOfChannel(bot: TelegramBot, userId: number): Promise<boolean> {
  if (!CHANNEL) return true;
  try {
    const member = await bot.getChatMember(CHANNEL, userId);
    return ["creator", "administrator", "member"].includes(member.status);
  } catch {
    return true; // if check fails, let them through
  }
}

// ─── Get or create telegram user record ──────────────────────────────────────
async function getTgUser(telegramId: string, username?: string, firstName?: string) {
  const existing = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
  if (existing.length) return existing[0];
  const [created] = await db.insert(telegramUsersTable).values({ telegramId, username, firstName, state: "idle", createdAt: now() }).returning();
  return created;
}

function codeBlock(text: string) { return `\`\`\`\n${text}\n\`\`\``; }
function inlineCode(text: string) { return `\`${text}\``; }

// ─── Extract and execute AI-triggered test email ──────────────────────────────
async function handleAITrigger(bot: TelegramBot, chatId: number, userId: number, reply: string): Promise<string> {
  const match = reply.match(/\[SEND_TEST:([^\]]+):([^\]]+)\]/);
  if (!match) return reply;

  const triggerRemoved = reply.replace(/\[SEND_TEST:[^\]]+\]/, "").trim();
  const to = match[1].trim();
  const template = match[2].trim();

  void bot.sendMessage(chatId, `📨 Sending test email to ${inlineCode(to)}...`, { parse_mode: "Markdown" });

  try {
    const msgId = await sendEmailDirect(userId, to, template, { code: Math.floor(100000 + Math.random() * 900000).toString(), company: "ORACLEX" });
    await bot.sendMessage(chatId,
      `✅ *Test email sent!*\n\n📧 To: ${inlineCode(to)}\n📝 Template: ${template}\n🔑 ID: ${inlineCode(msgId.slice(0, 8) + "...")}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await bot.sendMessage(chatId, `❌ Failed to send: ${msg}`);
  }

  return triggerRemoved;
}

export function startBot() {
  if (!TOKEN) { logger.warn("TELEGRAM_BOT_TOKEN not set — user bot disabled"); return; }

  const bot = new TelegramBot(TOKEN, { polling: { interval: 1500, autoStart: true } });
  logger.info("Telegram user bot started (polling)");
  bot.on("polling_error", (err) => logger.warn({ err: err.message }, "User bot polling error"));

  // Known command prefixes (to avoid routing to AI)
  const COMMANDS = ["/start", "/help", "/signup", "/verify", "/login", "/logout", "/me",
    "/keys", "/newkey", "/revokekey", "/usage", "/stats", "/pool", "/docs", "/playground", "/send", "/reset_ai", "/ai"];

  // ─── /start ──────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const firstName = msg.from?.first_name ?? "there";

    const isMember = await isMemberOfChannel(bot, msg.from!.id);
    if (!isMember) {
      await bot.sendMessage(chatId, `🔒 *Access Required*\n\nJoin our channel to use ORACLEX Bot:\n\n👉 ${CHANNEL}\n\nThen send /start again.`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "📢 Join Channel", url: `https://t.me/${CHANNEL.replace("@", "")}` }]] },
      });
      return;
    }

    const tgUser = await getTgUser(telegramId, msg.from?.username, firstName);
    if (tgUser.userId) {
      const users = await db.select({ email: usersTable.email, tier: usersTable.tier }).from(usersTable).where(eq(usersTable.id, tgUser.userId)).limit(1);
      await bot.sendMessage(chatId,
        `⚡ *Welcome back, ${firstName}!*\n\n📧 ${inlineCode(users[0]?.email ?? "")}\n🏷️ Tier: ${users[0]?.tier ?? "free"}\n\n💡 Just type anything to chat with ORACLEX AI!\nType /help for all commands.`,
        { parse_mode: "Markdown" }
      );
    } else {
      await bot.sendMessage(chatId,
        `⚡ *Welcome to ORACLEX Mail Engine!*\n\nSend transactional emails via REST API.\n\n*Get started:*\n• New user → /signup\n• Existing user → /login\n\n💡 *Tip:* Just type a question and our AI will guide you!\nType /help to see all commands.`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // ─── /help ────────────────────────────────────────────────────────────────────
  bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
      `⚡ *ORACLEX Bot Commands*\n\n*🔐 Account*\n/signup <email> <password> — Create account\n/login <email> <password> — Sign in\n/verify <code> — Verify your email OTP\n/me — View account info\n/logout — Sign out\n\n*🗝️ API Keys*\n/keys — List your API keys\n/newkey <name> — Create new API key\n/revokekey <id> — Revoke a key\n\n*📊 Stats*\n/usage — Today's email quota bar\n/stats — Delivery statistics\n/pool — SMTP relay pool status\n\n*🚀 Playground*\n/send <to> <template> — Send test email\n/docs — API docs & developer guide\n\n*🤖 AI Assistant*\n/ai <question> — Ask ORACLEX AI anything\n/reset_ai — Clear AI conversation history\n💬 Or just type freely — AI always responds!\n\nTemplates: verification · otp · password-reset · magic-link`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /signup ──────────────────────────────────────────────────────────────────
  bot.onText(/\/signup(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const email = match?.[1]?.toLowerCase();
    const password = match?.[2];

    if (!email || !password) {
      await bot.sendMessage(chatId, `📝 *Create Account*\n\n${codeBlock("/signup your@email.com yourpassword")}\n\nPassword must be at least 8 characters.`, { parse_mode: "Markdown" }); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { await bot.sendMessage(chatId, "❌ Invalid email address."); return; }
    if (password.length < 8) { await bot.sendMessage(chatId, "❌ Password must be at least 8 characters."); return; }

    try {
      const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
      if (existing.length) { await bot.sendMessage(chatId, "❌ Email already registered. Use /login to sign in."); return; }

      const otp = generateOtp();
      const [user] = await db.insert(usersTable).values({
        email, passwordHash: await hashPassword(password), verified: false,
        otpCode: otp, otpExpiresAt: now() + 600, tier: "free", emailQuota: 100, createdAt: now(),
      }).returning();

      const tgUser = await getTgUser(telegramId, msg.from?.username, msg.from?.first_name);
      await db.update(telegramUsersTable).set({ pendingEmail: email, state: "awaiting_otp", userId: user.id }).where(eq(telegramUsersTable.id, tgUser.id));

      await sendOtpViaPool(email, otp).catch((err) => logger.warn({ err }, "OTP send failed"));

      await bot.sendMessage(chatId, `✅ Account created!\n\n📧 Check your inbox at: ${inlineCode(email)}\n\nThen enter your 6-digit code:\n${codeBlock("/verify 882941")}`, { parse_mode: "Markdown" });
    } catch (err) {
      await bot.sendMessage(chatId, "❌ Signup failed. Please try again.");
      logger.error({ err }, "Bot signup error");
    }
  });

  // ─── /verify ──────────────────────────────────────────────────────────────────
  bot.onText(/\/verify\s+(\d{6})/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const codeInput = match?.[1];

    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
    const tgUser = tgUsers[0];
    if (!tgUser?.pendingEmail) { await bot.sendMessage(chatId, "❌ No pending verification. Use /signup first."); return; }

    const users = await db.select().from(usersTable).where(eq(usersTable.email, tgUser.pendingEmail)).limit(1);
    const user = users[0];
    if (!user || user.otpCode !== codeInput) { await bot.sendMessage(chatId, "❌ Invalid code. Check your email or /signup again."); return; }
    if (user.otpExpiresAt && user.otpExpiresAt < now()) { await bot.sendMessage(chatId, "❌ Code expired. Use /signup to get a new code."); return; }

    await db.update(usersTable).set({ verified: true, otpCode: null, otpExpiresAt: null }).where(eq(usersTable.id, user.id));
    await db.update(telegramUsersTable).set({ state: "idle", pendingEmail: null, userId: user.id }).where(eq(telegramUsersTable.id, tgUser.id));

    await bot.sendMessage(chatId,
      `🎉 *Email verified! Welcome to ORACLEX!*\n\n*Next steps:*\n1️⃣ Create API key → /newkey MyApp\n2️⃣ Integrate → /docs\n3️⃣ Send first email → /send test@email.com verification\n\n💡 Ask our AI anything — just type freely!`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /login ───────────────────────────────────────────────────────────────────
  bot.onText(/\/login(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const email = match?.[1]?.toLowerCase();
    const password = match?.[2];

    if (!email || !password) {
      await bot.sendMessage(chatId, `🔐 *Sign In*\n\n${codeBlock("/login your@email.com yourpassword")}`, { parse_mode: "Markdown" }); return;
    }
    try {
      const users = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
      if (!users.length || !(await verifyPassword(password, users[0].passwordHash))) {
        await bot.sendMessage(chatId, "❌ Invalid email or password."); return;
      }
      if (!users[0].verified) { await bot.sendMessage(chatId, "❌ Account not verified. Check your email for the code."); return; }

      const tgUser = await getTgUser(telegramId, msg.from?.username, msg.from?.first_name);
      await db.update(telegramUsersTable).set({ userId: users[0].id, state: "idle" }).where(eq(telegramUsersTable.id, tgUser.id));

      await bot.sendMessage(chatId,
        `✅ *Logged in!*\n\n📧 ${inlineCode(users[0].email)}\n🏷️ Tier: ${users[0].tier} (${users[0].emailQuota}/day)\n\n💡 Just type any question to chat with ORACLEX AI!`,
        { parse_mode: "Markdown" }
      );
    } catch (err) { await bot.sendMessage(chatId, "❌ Login failed."); logger.error({ err }, "Bot login error"); }
  });

  // ─── /me ──────────────────────────────────────────────────────────────────────
  bot.onText(/\/me/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login or /signup."); return; }
    const user = (await db.select().from(usersTable).where(eq(usersTable.id, tgUsers[0].userId)).limit(1))[0];
    await bot.sendMessage(chatId, `👤 *Your Account*\n\n📧 ${inlineCode(user.email)}\n🏷️ Tier: ${user.tier}\n📊 Daily quota: ${user.emailQuota} emails\n🔐 Verified: ${user.verified ? "✅" : "❌"}`, { parse_mode: "Markdown" });
  });

  // ─── /logout ──────────────────────────────────────────────────────────────────
  bot.onText(/\/logout/, async (msg) => {
    await db.update(telegramUsersTable).set({ userId: null, state: "idle" }).where(eq(telegramUsersTable.telegramId, String(msg.from!.id)));
    await bot.sendMessage(msg.chat.id, "✅ Logged out. Use /login to sign back in.");
  });

  // ─── /keys ────────────────────────────────────────────────────────────────────
  bot.onText(/\/keys/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login first."); return; }
    const keys = await db.select().from(apiKeysTable).where(and(eq(apiKeysTable.userId, tgUsers[0].userId), eq(apiKeysTable.isActive, true)));
    if (!keys.length) {
      await bot.sendMessage(chatId, `🗝️ *No API keys yet*\n\nCreate one:\n${codeBlock("/newkey MyAppName")}`, { parse_mode: "Markdown" }); return;
    }
    const list = keys.map(k => `• ${inlineCode(k.keyPrefix + "…")} — *${k.name}* (id: ${k.id})`).join("\n");
    await bot.sendMessage(chatId, `🗝️ *Your API Keys*\n\n${list}\n\nRevoke: /revokekey <id>`, { parse_mode: "Markdown" });
  });

  // ─── /newkey ──────────────────────────────────────────────────────────────────
  bot.onText(/\/newkey(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login first."); return; }
    const name = match?.[1]?.trim();
    if (!name) { await bot.sendMessage(chatId, `🗝️ Usage:\n${codeBlock("/newkey MyApp")}`, { parse_mode: "Markdown" }); return; }
    const { full, prefix, hash } = generateApiKey();
    await db.insert(apiKeysTable).values({ userId: tgUsers[0].userId, name, keyPrefix: prefix, keyHash: hash, isActive: true, emailsToday: 0, quotaDate: today(), createdAt: now() });
    await bot.sendMessage(chatId,
      `✅ *API Key Created!*\n\nName: *${name}*\n\n⚠️ *Copy now — shown ONCE:*\n${codeBlock(full)}\n\nUsage:\n${codeBlock(`Authorization: Bearer ${full}`)}`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /revokekey ───────────────────────────────────────────────────────────────
  bot.onText(/\/revokekey\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in."); return; }
    const [updated] = await db.update(apiKeysTable).set({ isActive: false }).where(and(eq(apiKeysTable.id, parseInt(match![1], 10)), eq(apiKeysTable.userId, tgUsers[0].userId))).returning();
    await bot.sendMessage(chatId, updated ? `✅ API key #${match![1]} revoked.` : "❌ Key not found.");
  });

  // ─── /usage ───────────────────────────────────────────────────────────────────
  bot.onText(/\/usage/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in."); return; }
    const users = await db.select().from(usersTable).where(eq(usersTable.id, tgUsers[0].userId)).limit(1);
    const quota = users[0]?.emailQuota ?? 100;
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(oraplexEmailsTable)
      .where(and(eq(oraplexEmailsTable.userId, tgUsers[0].userId), sql`queued_at >= ${startOfDay}`));
    const used = cnt ?? 0;
    const pct = Math.min(100, Math.round((used / quota) * 100));
    const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
    await bot.sendMessage(chatId,
      `📊 *Today's Usage*\n\n[${bar}] ${pct}%\n\n📧 Used: *${used}* / ${quota}\n✅ Remaining: *${Math.max(0, quota - used)}*\n\n🕛 Resets at midnight UTC`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /stats ───────────────────────────────────────────────────────────────────
  bot.onText(/\/stats$/, async (msg) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in."); return; }
    const rows = await db.select({ status: oraplexEmailsTable.status, cnt: sql<number>`count(*)::int` })
      .from(oraplexEmailsTable).where(eq(oraplexEmailsTable.userId, tgUsers[0].userId)).groupBy(oraplexEmailsTable.status);
    let sent = 0, failed = 0, queue = 0;
    for (const r of rows) { if (r.status === "sent") sent = r.cnt; else if (r.status === "failed") failed = r.cnt; else queue += r.cnt; }
    const total = sent + failed;
    await bot.sendMessage(chatId,
      `📊 *Delivery Stats*\n\n✅ Sent: *${sent}*\n❌ Failed: *${failed}*\n⏳ Queue: *${queue}*\n📈 Success rate: *${total > 0 ? ((sent / total) * 100).toFixed(1) : "100.0"}%*`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /pool ────────────────────────────────────────────────────────────────────
  bot.onText(/\/pool/, async (msg) => {
    const chatId = msg.chat.id;
    const nodes = await db.select().from(smtpPoolTable);
    const list = nodes.map(n => {
      const pct = Math.round((n.dailySentCount / n.maxDailyLimit) * 100);
      const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
      return `${n.status === "active" ? "🟢" : "🔴"} *${n.email.replace("oraclex.", "").replace("@gmail.com", "")}*\n[${bar}] ${n.dailySentCount}/${n.maxDailyLimit}`;
    }).join("\n\n");
    await bot.sendMessage(chatId, `📡 *Relay Pool (${nodes.length} nodes)*\n\n${list}`, { parse_mode: "Markdown" });
  });

  // ─── /docs ────────────────────────────────────────────────────────────────────
  bot.onText(/\/docs/, async (msg) => {
    const chatId = msg.chat.id;
    const domain = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:80";
    await bot.sendMessage(chatId,
      `📚 *Developer Docs*\n\n• 🔵 [Swagger UI](${domain}/api/docs)\n• 📖 [Full Guide](${domain}/docs)\n\n*Quick send:*\n${codeBlock(`POST /api/v1/email/send\nAuthorization: Bearer YOUR_KEY\n\n{\n  "to": "user@email.com",\n  "template": "verification",\n  "data": { "code": "882941" }\n}`)}\n\n💡 Ask ORACLEX AI for code in your language!`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );
  });

  // ─── /send <to> <template> ────────────────────────────────────────────────────
  bot.onText(/\/send(?:\s+(\S+))?(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, String(msg.from!.id))).limit(1);
    if (!tgUsers[0]?.userId) { await bot.sendMessage(chatId, "❌ Not logged in. Use /login first."); return; }
    const to = match?.[1];
    const template = match?.[2] ?? "verification";
    if (!to) {
      await bot.sendMessage(chatId, `🎮 *Test Send*\n\n${codeBlock("/send target@email.com verification")}\n\nTemplates: verification · otp · password-reset · magic-link`, { parse_mode: "Markdown" }); return;
    }
    await bot.sendMessage(chatId, `📨 Sending *${template}* email to ${inlineCode(to)}...`, { parse_mode: "Markdown" });
    try {
      const msgId = await sendEmailDirect(tgUsers[0].userId, to, template, { code: Math.floor(100000 + Math.random() * 900000).toString(), company: "ORACLEX Test" });
      await bot.sendMessage(chatId, `✅ *Delivered!*\n\n📧 To: ${inlineCode(to)}\n📝 Template: ${template}\n🔑 ID: ${inlineCode(msgId.slice(0, 8) + "...")}`, { parse_mode: "Markdown" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      await bot.sendMessage(chatId, `❌ Send failed: ${errMsg}\n\nCheck /pool for relay status.`);
      logger.warn({ err }, "Bot /send failed");
    }
  });

  // ─── /ai <question> — explicit AI query ────────────────────────────────────────
  bot.onText(/\/ai(?:\s+([\s\S]+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
    const userId = tgUsers[0]?.userId;
    const question = match?.[1]?.trim();
    if (!question) {
      await bot.sendMessage(chatId, `🤖 *ORACLEX AI*\n\nJust type any question! Or use:\n${codeBlock("/ai How do I send a verification email in Python?")}\n\nI can also send test emails for you!`, { parse_mode: "Markdown" }); return;
    }
    await bot.sendChatAction(chatId, "typing");
    const reply = await callAI(telegramId, question);
    const cleaned = userId ? await handleAITrigger(bot, chatId, userId, reply) : reply;
    if (cleaned) await bot.sendMessage(chatId, cleaned, { parse_mode: "Markdown" }).catch(() => bot.sendMessage(chatId, cleaned));
  });

  // ─── /reset_ai — clear conversation history ───────────────────────────────────
  bot.onText(/\/reset_ai/, async (msg) => {
    conversations.delete(String(msg.from!.id));
    await bot.sendMessage(msg.chat.id, "🔄 AI conversation history cleared. Starting fresh!");
  });

  // ─── /playground ─────────────────────────────────────────────────────────────
  bot.onText(/\/playground/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `🎮 *ORACLEX Playground*\n\nSend test emails right here:\n${codeBlock("/send your@email.com verification")}\n\nOr ask ORACLEX AI to send one for you:\n${codeBlock("Send a test verification email to my@email.com")}\n\nTemplates:\n• verification — 6-digit code\n• otp — one-time password\n• password-reset — reset link\n• magic-link — sign-in link`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── Catch-all: free text → AI assistant ─────────────────────────────────────
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const text = msg.text ?? "";

    // Skip commands (they are handled above)
    if (!text || COMMANDS.some(cmd => text.startsWith(cmd))) return;

    // Any free text goes to AI
    const tgUsers = await db.select().from(telegramUsersTable).where(eq(telegramUsersTable.telegramId, telegramId)).limit(1);
    const userId = tgUsers[0]?.userId;

    await bot.sendChatAction(chatId, "typing");
    const reply = await callAI(telegramId, text);
    const cleaned = userId ? await handleAITrigger(bot, chatId, userId, reply) : reply;
    if (cleaned) {
      await bot.sendMessage(chatId, cleaned, { parse_mode: "Markdown" }).catch(() => bot.sendMessage(chatId, cleaned));
    }
  });

  return bot;
}
