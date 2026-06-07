import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { apiKeysTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateApiKey, hashApiKey, verifyJwt } from "../lib/auth.js";

const router = Router();

function now() { return Math.floor(Date.now() / 1000); }

// JWT auth middleware (for API-key management — uses JWT, not API key)
export function requireJwtForKeys(req: Request, res: Response, next: () => void) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const payload = verifyJwt(token);
  if (!payload) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  (req as Request & { jwtUser: { userId: number; email: string } }).jwtUser = payload;
  next();
}

// GET /api/v1/api-keys
router.get("/", requireJwtForKeys, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { jwtUser: { userId: number; email: string } }).jwtUser;
  const keys = await db.select({
    id: apiKeysTable.id, name: apiKeysTable.name, keyPrefix: apiKeysTable.keyPrefix,
    isActive: apiKeysTable.isActive, lastUsedAt: apiKeysTable.lastUsedAt, createdAt: apiKeysTable.createdAt,
  }).from(apiKeysTable).where(and(eq(apiKeysTable.userId, userId), eq(apiKeysTable.isActive, true)));
  res.json(keys.map((k) => ({ ...k, key_prefix: k.keyPrefix, last_used_at: k.lastUsedAt, created_at: k.createdAt, is_active: k.isActive })));
});

// POST /api/v1/api-keys
router.post("/", requireJwtForKeys, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { jwtUser: { userId: number; email: string } }).jwtUser;
  const { name } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const { full, prefix, hash } = generateApiKey();
  const [inserted] = await db.insert(apiKeysTable).values({
    userId, name, keyPrefix: prefix, keyHash: hash, isActive: true, createdAt: now(),
  }).returning();

  res.status(201).json({ id: inserted.id, name: inserted.name, key: full, key_prefix: prefix, created_at: inserted.createdAt });
});

// DELETE /api/v1/api-keys/:id  (revoke)
router.delete("/:id", requireJwtForKeys, async (req: Request, res: Response) => {
  const { userId } = (req as Request & { jwtUser: { userId: number; email: string } }).jwtUser;
  const id = parseInt(req.params.id as string, 10);
  const [updated] = await db.update(apiKeysTable)
    .set({ isActive: false })
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, userId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "API key not found" }); return; }
  res.json({ revoked: true, id });
});

export default router;
