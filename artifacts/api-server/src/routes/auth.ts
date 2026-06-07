import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { usersTable, apiKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { hashPassword, verifyPassword, signJwt, verifyJwt, generateOtp, generateApiKey, hashApiKey } from "../lib/auth.js";
import nodemailer from "nodemailer";
import { smtpPoolTable } from "@workspace/db";
import { asc, lt } from "drizzle-orm";

const router = Router();

function now() { return Math.floor(Date.now() / 1000); }

// ─── Send OTP via the first available Gmail relay node ────────────────────────
async function sendOtpEmail(toEmail: string, code: string) {
  const nodes = await db.select().from(smtpPoolTable)
    .where(and(eq(smtpPoolTable.status, "active"), lt(smtpPoolTable.dailySentCount, smtpPoolTable.maxDailyLimit)))
    .orderBy(asc(smtpPoolTable.lastUsedTimestamp))
    .limit(1);

  if (!nodes.length) throw new Error("No relay nodes available");
  const node = nodes[0];

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: node.email, pass: node.appPassword },
    tls: { rejectUnauthorized: true },
    connectionTimeout: 15000,
  });

  const digits = code.split("").map((d) =>
    `<span style="display:inline-block;font-family:monospace;font-size:38px;font-weight:900;color:#4a9eff;min-width:32px;text-align:center;">${d}</span>`
  ).join("");

  await transporter.sendMail({
    from: `"ORACLEX" <${node.email}>`,
    to: toEmail,
    subject: `Verify your ORACLEX account — ${code}`,
    html: `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#0d0d0d;color:#e8e8e8;margin:0;padding:0;">
<div style="max-width:520px;margin:48px auto;background:#141414;border:1px solid #252525;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e,#0f3460);padding:40px;text-align:center;border-bottom:1px solid #1e3a5f;">
    <div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#4a9eff;margin-bottom:12px;">ORACLEX</div>
    <h1 style="font-size:22px;font-weight:700;color:#fff;margin:0;">Verify your email</h1>
  </div>
  <div style="padding:40px;">
    <p style="color:#aaa;margin:0 0 24px;font-size:15px;">Enter this code to activate your ORACLEX account. Expires in <strong style="color:#fff;">10 minutes</strong>.</p>
    <div style="background:#111;border:1px solid #222;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px;">${digits}</div>
    <p style="color:#555;font-size:13px;margin:0;">If you didn't create an ORACLEX account, ignore this email.</p>
  </div>
  <div style="padding:20px 40px;border-top:1px solid #1c1c1c;text-align:center;font-size:11px;color:#444;">
    &copy; ${new Date().getFullYear()} ORACLEX Mail Engine
  </div>
</div></body></html>`,
  });

  // Update node usage
  await db.update(smtpPoolTable)
    .set({ dailySentCount: node.dailySentCount + 1, lastUsedTimestamp: now() })
    .where(eq(smtpPoolTable.id, node.id));
}

// ─── JWT middleware for auth routes ─────────────────────────────────────────
export function requireJwt(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const payload = verifyJwt(token);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  (req as Request & { jwtUser: { userId: number; email: string } }).jwtUser = payload;
  next();
}

// POST /api/auth/signup
router.post("/signup", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: "email and password are required" }); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: "Invalid email" }); return; }
  if (String(password).length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }

  try {
    const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (existing.length) { res.status(409).json({ error: "Email already in use" }); return; }

    const otp = generateOtp();
    const otpExpiresAt = now() + 600; // 10 min
    const passwordHash = await hashPassword(password);

    await db.insert(usersTable).values({
      email: email.toLowerCase(),
      passwordHash,
      verified: false,
      otpCode: otp,
      otpExpiresAt,
      createdAt: now(),
    });

    await sendOtpEmail(email, otp).catch((err: Error) => {
      req.log?.error({ err }, "Failed to send OTP email");
    });

    res.status(201).json({ message: "Account created. Check your email for the verification code.", email: email.toLowerCase() });
  } catch (err) {
    req.log?.error({ err }, "Signup error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/verify
router.post("/verify", async (req: Request, res: Response) => {
  const { email, code } = req.body ?? {};
  if (!email || !code) { res.status(400).json({ error: "email and code are required" }); return; }

  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!users.length) { res.status(400).json({ error: "Invalid code" }); return; }
    const user = users[0];

    if (user.verified) {
      const token = signJwt({ userId: user.id, email: user.email });
      res.json({ token, message: "Already verified" });
      return;
    }

    if (!user.otpCode || user.otpCode !== String(code)) { res.status(400).json({ error: "Invalid verification code" }); return; }
    if (user.otpExpiresAt && user.otpExpiresAt < now()) { res.status(400).json({ error: "Verification code has expired. Please sign up again." }); return; }

    await db.update(usersTable).set({ verified: true, otpCode: null, otpExpiresAt: null }).where(eq(usersTable.id, user.id));

    const token = signJwt({ userId: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    req.log?.error({ err }, "Verify error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ error: "email and password are required" }); return; }

  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!users.length) { res.status(401).json({ error: "Invalid email or password" }); return; }
    const user = users[0];

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Invalid email or password" }); return; }

    if (!user.verified) {
      // Resend OTP
      const otp = generateOtp();
      await db.update(usersTable).set({ otpCode: otp, otpExpiresAt: now() + 600 }).where(eq(usersTable.id, user.id));
      await sendOtpEmail(email, otp).catch(() => {});
      res.status(403).json({ error: "Email not verified", needsVerification: true, email: user.email });
      return;
    }

    const token = signJwt({ userId: user.id, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    req.log?.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/auth/resend-otp
router.post("/resend-otp", async (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  if (!email) { res.status(400).json({ error: "email is required" }); return; }
  try {
    const users = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase())).limit(1);
    if (!users.length) { res.status(404).json({ error: "User not found" }); return; }
    const user = users[0];
    if (user.verified) { res.json({ message: "Already verified" }); return; }
    const otp = generateOtp();
    await db.update(usersTable).set({ otpCode: otp, otpExpiresAt: now() + 600 }).where(eq(usersTable.id, user.id));
    await sendOtpEmail(email, otp).catch(() => {});
    res.json({ message: "OTP resent" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/auth/me  (requires JWT Bearer)
router.get("/me", requireJwt, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { jwtUser: { userId: number; email: string } }).jwtUser;
  try {
    const users = await db.select({ id: usersTable.id, email: usersTable.email, verified: usersTable.verified, createdAt: usersTable.createdAt }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (!users.length) { res.status(404).json({ error: "User not found" }); return; }
    res.json(users[0]);
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
