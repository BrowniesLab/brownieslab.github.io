import express from "express";
import { startSession, finishSession } from "../controllers/sessionController.js";
import { authMiddleware } from "../middlewares/authMiddleware.js";

const router = express.Router();
router.post("/start", authMiddleware, startSession);
router.post("/finish", authMiddleware, finishSession);
export default router;
