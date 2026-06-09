import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  telegramUsersTable, usersTable, oraplexEmailsTable, smtpPoolTable, apiKeysTable,
} from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { logger } from "./lib/logger.js";

const ADMIN_TOKEN = process.env.ADMIN_BOT_TOKEN ?? "";

// Telegram IDs of admins — anyone who runs /auth <password> successfully gets added
const ADMIN_IDS = new Set<string>();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "oraclex_admin_2026";

function now() { return Math.floor(Date.now() / 1000); }

function isAdmin(telegramId: string): boolean {
  return ADMIN_IDS.has(telegramId);
}

function requireAdmin(chatId: number, telegramId: string, bot: TelegramBot): boolean {
  if (!isAdmin(telegramId)) {
    void bot.sendMessage(chatId, "🔒 Admin access required.\n\nAuthenticate with:\n`/auth your_admin_password`", { parse_mode: "Markdown" });
    return false;
  }
  return true;
}

export function startAdminBot() {
  if (!ADMIN_TOKEN) { logger.warn("ADMIN_BOT_TOKEN not set — admin bot disabled"); return; }

  const bot = new TelegramBot(ADMIN_TOKEN, { polling: { interval: 2000, autoStart: true } });
  logger.info("Admin Telegram bot started (polling)");

  bot.on("polling_error", (err) => logger.warn({ err: err.message }, "Admin bot polling error"));

  // ─── /start ─────────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `⚡ *ORACLEX Admin Control Panel*\n\nAuthenticate first:\n\`/auth your_password\`\n\nThen use /help to see all commands.`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /auth ──────────────────────────────────────────────────────────────────
  bot.onText(/\/auth\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    const pass = match?.[1]?.trim();
    if (pass === ADMIN_PASSWORD) {
      ADMIN_IDS.add(telegramId);
      await bot.sendMessage(chatId, `✅ *Admin access granted!*\n\nWelcome to ORACLEX Admin Bot.\nType /help to see all commands.`, { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, "❌ Wrong password.");
    }
  });

  // ─── /help ──────────────────────────────────────────────────────────────────
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
      `⚡ *ORACLEX Admin Commands*\n\n*🔐 Auth*\n/auth <password> — Admin login\n\n*📊 Stats*\n/stats — Global platform stats\n/users — List all registered users\n/pool — SMTP relay pool status\n/logs — Recent delivery logs\n\n*👥 User Management*\n/quota <email> <amount> — Set user's daily quota\n/verify <email> — Force-verify a user account\n/ban <email> — Deactivate all API keys\n\n*📢 Broadcast*\n/broadcast <message> — Send to all Telegram users\n/announce <message> — Send platform announcement\n\n*⚙️ System*\n/reset_pool — Reset all relay daily counts\n/start — Welcome screen\n/help — This menu`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /stats ─────────────────────────────────────────────────────────────────
  bot.onText(/\/stats$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const [userCount] = await db.select({ cnt: sql<number>`count(*)::int` }).from(usersTable);
    const [keyCount] = await db.select({ cnt: sql<number>`count(*)::int` }).from(apiKeysTable).where(eq(apiKeysTable.isActive, true));
    const [tgCount] = await db.select({ cnt: sql<number>`count(*)::int` }).from(telegramUsersTable);

    const statRows = await db.select({ status: oraplexEmailsTable.status, cnt: sql<number>`count(*)::int` })
      .from(oraplexEmailsTable).groupBy(oraplexEmailsTable.status);
    let sent = 0, failed = 0, queue = 0;
    for (const r of statRows) {
      if (r.status === "sent") sent = r.cnt;
      else if (r.status === "failed") failed = r.cnt;
      else queue += r.cnt;
    }

    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const [{ today }] = await db.select({ today: sql<number>`count(*)::int` }).from(oraplexEmailsTable)
      .where(sql`queued_at >= ${startOfDay}`);

    const nodeRows = await db.select().from(smtpPoolTable);
    const activeNodes = nodeRows.filter(n => n.status === "active").length;
    const todayPool = nodeRows.reduce((s, n) => s + n.dailySentCount, 0);

    await bot.sendMessage(chatId,
      `📊 *ORACLEX Platform Stats*\n\n👥 Users: *${userCount.cnt}* total\n🤖 Telegram users: *${tgCount.cnt}*\n🗝️ Active API keys: *${keyCount.cnt}*\n\n📧 All-time emails:\n  ✅ Sent: *${sent}*\n  ❌ Failed: *${failed}*\n  ⏳ Queue: *${queue}*\n\n📅 Today: *${today}* emails\n📡 Relay nodes: *${activeNodes}/${nodeRows.length}* active (${todayPool} sent today)`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /users ─────────────────────────────────────────────────────────────────
  bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const users = await db.select({ id: usersTable.id, email: usersTable.email, verified: usersTable.verified, tier: usersTable.tier, quota: usersTable.emailQuota, createdAt: usersTable.createdAt })
      .from(usersTable).orderBy(desc(usersTable.createdAt)).limit(20);

    if (!users.length) { await bot.sendMessage(chatId, "No users registered yet."); return; }

    const list = users.map(u =>
      `${u.verified ? "✅" : "❌"} \`${u.email}\` [${u.tier}] ${u.quota}/day`
    ).join("\n");

    await bot.sendMessage(chatId,
      `👥 *Recent Users* (showing ${users.length})\n\n${list}`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /pool ──────────────────────────────────────────────────────────────────
  bot.onText(/\/pool/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const nodes = await db.select().from(smtpPoolTable).orderBy(smtpPoolTable.id);
    const total = nodes.reduce((s, n) => s + n.dailySentCount, 0);
    const capacity = nodes.reduce((s, n) => s + n.maxDailyLimit, 0);
    const active = nodes.filter(n => n.status === "active").length;

    const list = nodes.map(n => {
      const pct = Math.round((n.dailySentCount / n.maxDailyLimit) * 100);
      const bar = "█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10));
      return `${n.status === "active" ? "🟢" : "🔴"} *${n.email.split("@")[0]}*\n  [${bar}] ${n.dailySentCount}/${n.maxDailyLimit} (${pct}%)`;
    }).join("\n\n");

    await bot.sendMessage(chatId,
      `📡 *SMTP Relay Pool*\n${active}/${nodes.length} active · ${total}/${capacity} sent today\n\n${list}`,
      { parse_mode: "Markdown" }
    );
  });

  // ─── /logs ──────────────────────────────────────────────────────────────────
  bot.onText(/\/logs/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const rows = await db.select().from(oraplexEmailsTable).orderBy(desc(oraplexEmailsTable.queuedAt)).limit(10);
    if (!rows.length) { await bot.sendMessage(chatId, "No emails logged yet."); return; }
    const list = rows.map(r =>
      `${r.status === "sent" ? "✅" : r.status === "failed" ? "❌" : "⏳"} \`${r.toAddress}\` — ${r.template}`
    ).join("\n");
    await bot.sendMessage(chatId, `📋 *Recent 10 Emails*\n\n${list}`, { parse_mode: "Markdown" });
  });

  // ─── /quota <email> <amount> ─────────────────────────────────────────────────
  bot.onText(/\/quota\s+(\S+)\s+(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const email = match![1].toLowerCase();
    const quota = parseInt(match![2], 10);
    if (quota < 1 || quota > 100000) { await bot.sendMessage(chatId, "❌ Quota must be between 1 and 100000."); return; }

    const [updated] = await db.update(usersTable).set({ emailQuota: quota }).where(eq(usersTable.email, email)).returning({ email: usersTable.email });
    if (!updated) { await bot.sendMessage(chatId, `❌ User \`${email}\` not found.`, { parse_mode: "Markdown" }); return; }
    await bot.sendMessage(chatId, `✅ Quota for \`${email}\` set to *${quota}* emails/day.`, { parse_mode: "Markdown" });
  });

  // ─── /verify <email> ─────────────────────────────────────────────────────────
  bot.onText(/\/verify\s+(\S+@\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const email = match![1].toLowerCase();
    const [updated] = await db.update(usersTable).set({ verified: true, otpCode: null, otpExpiresAt: null }).where(eq(usersTable.email, email)).returning({ email: usersTable.email });
    if (!updated) { await bot.sendMessage(chatId, `❌ User \`${email}\` not found.`, { parse_mode: "Markdown" }); return; }
    await bot.sendMessage(chatId, `✅ \`${email}\` is now force-verified.`, { parse_mode: "Markdown" });
  });

  // ─── /ban <email> ────────────────────────────────────────────────────────────
  bot.onText(/\/ban\s+(\S+@\S+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const email = match![1].toLowerCase();
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!users.length) { await bot.sendMessage(chatId, `❌ User \`${email}\` not found.`, { parse_mode: "Markdown" }); return; }

    await db.update(apiKeysTable).set({ isActive: false }).where(eq(apiKeysTable.userId, users[0].id));
    await bot.sendMessage(chatId, `✅ All API keys for \`${email}\` revoked.`, { parse_mode: "Markdown" });
  });

  // ─── /reset_pool ─────────────────────────────────────────────────────────────
  bot.onText(/\/reset_pool/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    await db.update(smtpPoolTable).set({ dailySentCount: 0 });
    await bot.sendMessage(chatId, "✅ All relay node daily send counts reset to 0.");
  });

  // ─── /broadcast <message> ────────────────────────────────────────────────────
  bot.onText(/\/broadcast\s+([\s\S]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const message = match![1].trim();
    if (!message) { await bot.sendMessage(chatId, "❌ Provide a message: /broadcast Your message here"); return; }

    const tgUsers = await db.select({ telegramId: telegramUsersTable.telegramId, userId: telegramUsersTable.userId })
      .from(telegramUsersTable).where(sql`user_id IS NOT NULL`);

    let sent = 0, failed = 0;
    for (const u of tgUsers) {
      try {
        await bot.sendMessage(parseInt(u.telegramId, 10),
          `📢 *ORACLEX Announcement*\n\n${message}`,
          { parse_mode: "Markdown" }
        );
        sent++;
      } catch { failed++; }
      await new Promise((r) => setTimeout(r, 50)); // rate limit
    }
    await bot.sendMessage(chatId, `✅ Broadcast complete: *${sent}* sent, *${failed}* failed.`, { parse_mode: "Markdown" });
  });

  // ─── /announce <message> — public announcement ────────────────────────────────
  bot.onText(/\/announce\s+([\s\S]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from!.id);
    if (!requireAdmin(chatId, telegramId, bot)) return;

    const message = match![1].trim();
    const allTg = await db.select({ telegramId: telegramUsersTable.telegramId })
      .from(telegramUsersTable);

    let sent = 0;
    for (const u of allTg) {
      try {
        await bot.sendMessage(parseInt(u.telegramId, 10),
          `⚡ *ORACLEX Platform Update*\n\n${message}\n\n_— ORACLEX Team_`,
          { parse_mode: "Markdown" }
        );
        sent++;
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    await bot.sendMessage(chatId, `✅ Announced to *${sent}* users.`, { parse_mode: "Markdown" });
  });

  return bot;
}
