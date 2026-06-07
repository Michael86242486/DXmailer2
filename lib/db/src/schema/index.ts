import { pgTable, serial, text, integer, boolean } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  verified: boolean("verified").default(false).notNull(),
  otpCode: text("otp_code"),
  otpExpiresAt: integer("otp_expires_at"),
  createdAt: integer("created_at").notNull(),
});

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
});

export const smtpPoolTable = pgTable("smtp_pool", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  appPassword: text("app_password").notNull(),
  senderName: text("sender_name").notNull(),
  status: text("status").default("active").notNull(),
  dailySentCount: integer("daily_sent_count").default(0).notNull(),
  maxDailyLimit: integer("max_daily_limit").default(500).notNull(),
  lastUsedTimestamp: integer("last_used_timestamp").default(0).notNull(),
  createdAt: integer("created_at").notNull(),
});

export const oraplexEmailsTable = pgTable("oraclex_emails", {
  id: serial("id").primaryKey(),
  messageId: text("message_id").notNull().unique(),
  transactionId: text("transaction_id"),
  userId: integer("user_id").notNull(),
  subscriberId: text("subscriber_id"),
  toAddress: text("to_address").notNull(),
  template: text("template").notNull(),
  senderName: text("sender_name"),
  data: text("data").default("{}"),
  status: text("status").default("queued").notNull(),
  smtpPoolId: integer("smtp_pool_id"),
  errorMessage: text("error_message"),
  queuedAt: integer("queued_at").notNull(),
  sentAt: integer("sent_at"),
});

export const execStepsTable = pgTable("exec_steps", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").notNull(),
  status: text("status").notNull(),
  detail: text("detail").notNull(),
  channel: text("channel").default("email").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const webhooksTable = pgTable("webhooks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  url: text("url").notNull(),
  events: text("events").default("sent,failed").notNull(),
  status: text("status").default("active").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const subscribersTable = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subscriberId: text("subscriber_id").notNull(),
  email: text("email"),
  phone: text("phone"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  data: text("data").default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type User = typeof usersTable.$inferSelect;
export type ApiKey = typeof apiKeysTable.$inferSelect;
export type SmtpNode = typeof smtpPoolTable.$inferSelect;
export type OraplexEmail = typeof oraplexEmailsTable.$inferSelect;
export type ExecStep = typeof execStepsTable.$inferSelect;
export type Webhook = typeof webhooksTable.$inferSelect;
export type Subscriber = typeof subscribersTable.$inferSelect;
