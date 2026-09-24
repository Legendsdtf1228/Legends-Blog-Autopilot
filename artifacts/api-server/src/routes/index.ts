import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ownerConsoleRouter from "./owner-console";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ownerConsoleRouter);

export default router;
