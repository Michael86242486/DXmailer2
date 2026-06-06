import { Router, type IRouter } from "express";
import healthRouter from "./health";
import oraplexRouter from "./oraclex";

const router: IRouter = Router();

router.use(healthRouter);
router.use(oraplexRouter);

export default router;
