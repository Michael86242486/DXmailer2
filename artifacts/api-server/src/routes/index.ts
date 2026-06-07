import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import oraplexRouter, { seedRelayNodes } from "./oraclex.js";
import authRouter from "./auth.js";
import apiKeysRouter from "./apiKeys.js";
import swaggerRouter from "./swagger.js";
import { startBot } from "../bot.js";

const router: IRouter = Router();

// Seed relay nodes on startup (idempotent — uses ON CONFLICT DO NOTHING)
seedRelayNodes().catch((err: Error) => {
  console.error("Failed to seed relay nodes:", err.message);
});

// Start Telegram bot (background polling — no-op if token not set)
startBot();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/v1/api-keys", apiKeysRouter);
router.use(oraplexRouter);
router.use(swaggerRouter);

export default router;
