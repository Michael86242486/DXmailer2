import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import oraplexRouter, { seedRelayNodes } from "./oraclex.js";
import authRouter from "./auth.js";
import apiKeysRouter from "./apiKeys.js";
import swaggerRouter from "./swagger.js";
import { startBot } from "../bot.js";
import { startAdminBot } from "../admin-bot.js";

const router: IRouter = Router();

// Seed relay nodes on startup (idempotent)
seedRelayNodes().catch((err: Error) => {
  console.error("Failed to seed relay nodes:", err.message);
});

// Start Telegram bots (background polling)
startBot();
startAdminBot();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/v1/api-keys", apiKeysRouter);
router.use(oraplexRouter);
router.use(swaggerRouter);

export default router;
